"""Detecteert wanneer de coach wakker moet worden.

De worker trekt, niets duwt: geen webhook, geen inkomende poort. Elke trigger
draagt een stabiele `key` die in `coach_runs.trigger_key` uniek is opgeslagen,
zodat dezelfde gebeurtenis nooit twee herplanningen veroorzaakt — ook niet als
de worker vaker draait dan bedoeld of halverwege afbreekt.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from supabase import Client

from tm_sync import compliance

log = logging.getLogger(__name__)

# Zwaarste eerst. Er gaat hoogstens één coach-aanroep per tick de deur uit:
# vier herplanningen achter elkaar kosten geld en leveren niets extra op.
PRIORITY = [
    "alarm",
    "run_completed",
    "activity_completed",
    "session_skipped",
    "weekly_review",
]

HRV_UNBALANCED_DAYS = 3
LOW_READINESS_DAYS = 3
NON_RUNNING_LOAD_TRIGGER = 40
NON_RUNNING_DURATION_TRIGGER_S = 45 * 60


@dataclass
class Trigger:
    kind: str
    key: str
    reason: str
    # Expliciete doelwizard-aanvragen mogen een nog niet actief doel laten
    # doorrekenen. Alle automatische triggers blijven het actieve doel gebruiken.
    goal_id: int | None = None


def _handled_keys(sb: Client) -> set[str]:
    rows = (
        sb.table("coach_runs")
        .select("trigger_key")
        .not_.is_("trigger_key", "null")
        .execute()
        .data
    )
    return {r["trigger_key"] for r in rows}


def _rule_params(sb: Client) -> dict[str, dict[str, Any]]:
    rows = (
        sb.table("coach_rules").select("key, params").eq("status", "active").execute().data
    )
    return {r["key"]: (r["params"] or {}) for r in rows}


def _active_plan(sb: Client) -> dict[str, Any] | None:
    rows = (
        sb.table("plans").select("id, goal_id").eq("status", "active").limit(1).execute().data
    )
    return rows[0] if rows else None


def mark_skipped(sb: Client, plan_id: int, today: date) -> list[int]:
    """Sessies die voorbij zijn en nooit zijn afgevinkt, zijn overgeslagen.

    Dit gebeurt vóór de triggerdetectie, zodat de status klopt ook als er geen
    herplanning volgt.
    """
    # Ook `moved` telt mee: verplaatsen zet een nieuwe datum, dus een verplaatste
    # sessie die inmiddels in het verleden ligt is net zo goed niet gedaan.
    stale = (
        sb.table("plan_sessions")
        .select("id, day, title")
        .eq("plan_id", plan_id)
        .lt("day", today.isoformat())
        .in_("status", ["planned", "moved"])
        .neq("session_type", "rest")
        .execute()
        .data
    )
    for s in stale:
        sb.table("plan_sessions").update({"status": "skipped"}).eq("id", s["id"]).execute()
        log.info("sessie %s (%s) gemarkeerd als overgeslagen", s["id"], s["day"])
    return [s["id"] for s in stale]


def detect(sb: Client, today: date | None = None) -> list[Trigger]:
    today = today or clock.today()
    handled = _handled_keys(sb)
    params = _rule_params(sb)
    found: list[Trigger] = []

    plan = _active_plan(sb)

    # --- alarm: pijn ------------------------------------------------------
    pain_threshold = float(
        (params.get("pain_score_override") or {}).get("pain_threshold", 6)
    )
    recent_feedback = (
        sb.table("session_feedback")
        .select(
            "id, plan_session_id, activity_id, pain_score, endurance_score, "
            "extra, created_at"
        )
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    )
    for fb in recent_feedback:
        if (fb.get("pain_score") or 0) >= pain_threshold:
            found.append(
                Trigger(
                    "alarm",
                    f"alarm:pain:feedback={fb['id']}",
                    f"pijnscore {fb['pain_score']} haalt de drempel van "
                    f"{pain_threshold:.0f}",
                )
            )
            break

    feedback_session_ids = [
        int(feedback["plan_session_id"])
        for feedback in recent_feedback
        if feedback.get("plan_session_id") is not None
    ]
    feedback_sessions: dict[int, dict[str, Any]] = {}
    if feedback_session_ids:
        rows = (
            sb.table("plan_sessions")
            .select("id, day, title, session_type, targets")
            .in_("id", feedback_session_ids)
            .execute()
            .data
        )
        feedback_sessions = {int(row["id"]): row for row in rows}

    repeated_misses = compliance.consecutive_heavy_misses(
        recent_feedback,
        feedback_sessions,
    )
    if repeated_misses:
        newest = repeated_misses[0]
        oldest = repeated_misses[1]
        newest_feedback = newest["feedback"]
        reasons = newest["compliance"].get("reasons") or []
        found.append(
            Trigger(
                "alarm",
                f"alarm:repeated_target_miss:feedback={newest_feedback['id']}",
                "twee opeenvolgende trainingen buiten doel en als zwaar ervaren: "
                f"{oldest['session'].get('day')} en {newest['session'].get('day')}"
                + (f"; laatste afwijking {', '.join(reasons)}" if reasons else ""),
            )
        )

    # --- alarm: herstel ---------------------------------------------------
    window_start = (today - timedelta(days=6)).isoformat()
    wellness = (
        sb.table("wellness_daily")
        .select("day, hrv_status, training_readiness_score")
        .gte("day", window_start)
        .order("day", desc=True)
        .execute()
        .data
    )

    unbalanced = [w["day"] for w in wellness if w.get("hrv_status") == "UNBALANCED"]
    if len(unbalanced) >= HRV_UNBALANCED_DAYS:
        found.append(
            Trigger(
                "alarm",
                f"alarm:hrv:{max(unbalanced)}",
                f"HRV {len(unbalanced)} van de laatste 7 dagen uit balans",
            )
        )

    min_readiness = float(
        (params.get("readiness_gate_quality") or {}).get("min_readiness", 50)
    )
    low = [
        w["day"]
        for w in wellness
        if w.get("training_readiness_score") is not None
        and float(w["training_readiness_score"]) < min_readiness
    ]
    if len(low) >= LOW_READINESS_DAYS:
        found.append(
            Trigger(
                "alarm",
                f"alarm:readiness:{max(low)}",
                f"readiness {len(low)} dagen onder {min_readiness:.0f}",
            )
        )

    # --- run afgerond met feedback ---------------------------------------
    for fb in recent_feedback:
        found.append(
            Trigger(
                "run_completed",
                f"run_completed:feedback={fb['id']}",
                f"feedback ingevuld: pijn {fb.get('pain_score')}, "
                f"uithouding {fb.get('endurance_score')}",
            )
        )

    # --- relevante niet-hardloopactiviteit afgerond ----------------------
    # Een korte wandeling hoeft geen betaalde herplanning te starten. Een
    # stevige zwem-, fiets- of krachtsessie verandert de herstelcontext wel.
    # Maximaal één trigger per kalenderdag voorkomt meerdere coachcalls als
    # Garmin in één sync verschillende activiteiten aanlevert.
    if plan:
        cross_training = (
            sb.table("activities")
            .select("id, sport, sub_sport, name, duration_s, raw")
            .gte("start_time_local", today.isoformat())
            .neq("sport", "running")
            .order("start_time_local", desc=True)
            .execute()
            .data
        )
        relevant = []
        for activity in cross_training:
            raw = activity.get("raw") or {}
            try:
                training_load = float(raw.get("activityTrainingLoad") or 0)
            except (TypeError, ValueError):
                training_load = 0.0
            duration_s = float(activity.get("duration_s") or 0)
            if (
                training_load >= NON_RUNNING_LOAD_TRIGGER
                or duration_s >= NON_RUNNING_DURATION_TRIGGER_S
            ):
                relevant.append((activity, training_load, duration_s))

        if relevant:
            activity, training_load, duration_s = max(
                relevant,
                key=lambda item: (item[1], item[2]),
            )
            label = activity.get("name") or activity.get("sub_sport") or activity["sport"]
            found.append(
                Trigger(
                    "activity_completed",
                    f"activity_completed:{today.isoformat()}",
                    f"{label}: {duration_s / 60:.0f} min, Garmin Training Load "
                    f"{training_load:.0f}",
                )
            )

    # --- geskipte sessies -------------------------------------------------
    if plan:
        skipped = (
            sb.table("plan_sessions")
            .select("id, day")
            .eq("plan_id", plan["id"])
            .eq("status", "skipped")
            .order("day", desc=True)
            .limit(3)
            .execute()
            .data
        )
        for s in skipped:
            found.append(
                Trigger(
                    "session_skipped",
                    f"session_skipped:session={s['id']}",
                    f"sessie van {s['day']} niet uitgevoerd",
                )
            )

    # --- wekelijkse review ------------------------------------------------
    # Zondag, zodat de nieuwe week met een verse beoordeling begint.
    if today.weekday() == 6:
        iso = today.isocalendar()
        found.append(
            Trigger(
                "weekly_review",
                f"weekly_review:{iso.year}-W{iso.week:02d}",
                "wekelijkse review",
            )
        )

    fresh = [t for t in found if t.key not in handled]
    fresh.sort(key=lambda t: PRIORITY.index(t.kind))
    return fresh
