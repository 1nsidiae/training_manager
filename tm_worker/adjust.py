"""Bijstellen zonder model: de gratis, directe helft van de planning.

Een schema heeft twee werkwoorden nodig, niet één. *Bijstellen* is wat er moet
gebeuren als de dag anders loopt dan gepland: een pijnmelding, een lage
readiness, een gemiste sessie. Dat is deterministisch, kost niets, gebeurt
onmiddellijk en raakt hoogstens een paar dagen. *Herplannen* is wat er moet
gebeuren als het schema zelf niet meer klopt: een ander doel, een blok dat afloopt,
structurele afdrijving. Dat kost geld en tijd en hoort zeldzaam te zijn.

Voorheen bestond alleen het tweede werkwoord. Elke gemiste sessie en elke
ingevulde feedback startte een volledige herplanning van vier weken — twee
complete Opus-runs op één nacht, allebei afgekeurd door de guardrails. Dit
bestand is de eerste helft, zodat de tweede zeldzaam kan worden.

Wat hier gebeurt is bewust klein en omkeerbaar: een sessie wordt lichter, nooit
zwaarder, en de oorspronkelijke opzet blijft in `targets.downgraded_from` staan.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

from supabase import Client

log = logging.getLogger(__name__)

QUALITY_TYPES = {"tempo", "interval", "race"}
HARD_TYPES = QUALITY_TYPES | {"long"}

# Hoe ver terug een pijnmelding nog meetelt, en hoe lang ze het schema remt.
PAIN_LOOKBACK_DAYS = 3
PAIN_REST_DAYS = 3

# Een gedwongen lichtere sessie houdt de gewoonte in stand zonder de prikkel.
# Bij pijn strenger dan bij een lage readiness: pijn is een signaal over het
# weefsel, readiness over de dagvorm.
PAIN_DISTANCE_FACTOR = 0.6
READINESS_DISTANCE_FACTOR = 0.75

# Eén gemiste sessie is ruis. Pas als het patroon zich herhaalt, klopt het
# schema zelf niet meer en is een betaalde herplanning het geld waard.
MISSED_WINDOW_DAYS = 14
MISSED_REPLAN_THRESHOLD = 3


@dataclass
class Change:
    """Eén toegepaste bijstelling, met de cijfers die haar rechtvaardigen."""

    rule: str
    severity: str
    session_id: int
    day: str
    from_type: str
    to_type: str
    explanation_nl: str
    explanation_en: str
    evidence: dict[str, Any] = field(default_factory=dict)


def rule_params(sb: Client) -> dict[str, dict[str, Any]]:
    """Drempels komen uit `coach_rules`, nooit uit een constante in de code.

    Anders staat er in de database een regel die iets anders belooft dan het
    systeem doet, en dat is precies het soort verschil dat niemand opmerkt.
    """
    rows = (
        sb.table("coach_rules").select("key, params").eq("status", "active").execute().data
    )
    return {r["key"]: (r["params"] or {}) for r in rows}


def easy_hr_cap(sb: Client) -> int | None:
    rows = sb.table("athlete_profile").select("hr_zones").limit(1).execute().data
    zones = (rows[0].get("hr_zones") or []) if rows else []
    high = next((z.get("high") for z in zones if z.get("zone") == 2), None)
    return int(high) if high else None


def missed_recent(
    sb: Client,
    plan_id: int,
    today: date,
    *,
    window_days: int = MISSED_WINDOW_DAYS,
) -> list[dict[str, Any]]:
    """Overgeslagen sessies binnen het venster, nieuwste eerst."""
    since = (today - timedelta(days=window_days)).isoformat()
    return (
        sb.table("plan_sessions")
        .select("id, day, title, session_type")
        .eq("plan_id", plan_id)
        .eq("status", "skipped")
        .gte("day", since)
        .lt("day", today.isoformat())
        .neq("session_type", "rest")
        .order("day", desc=True)
        .execute()
        .data
    )


def _upcoming(
    sb: Client, plan_id: int, start: date, end: date
) -> list[dict[str, Any]]:
    return (
        sb.table("plan_sessions")
        .select(
            "id, day, session_type, title, description, structure, targets, "
            "hr_cap, planned_distance_m, planned_duration_s, pushed_at, "
            "garmin_workout_id"
        )
        .eq("plan_id", plan_id)
        .in_("status", ["planned", "moved"])
        .gte("day", start.isoformat())
        .lte("day", end.isoformat())
        .order("day")
        .execute()
        .data
    )


def _soften(
    sb: Client,
    session: dict[str, Any],
    *,
    hr_cap: int | None,
    factor: float,
    note_nl: str,
) -> None:
    """Maak van een zware sessie een rustige duurloop onder het HR-plafond.

    De sessie verdwijnt niet: de gewoonte om die dag te lopen is zelf waardevol,
    en een geschrapte dag maakt het schema minder betrouwbaar dan een lichtere.
    """
    cap = hr_cap or session.get("hr_cap") or 0
    distance = session.get("planned_distance_m")
    duration = session.get("planned_duration_s")
    new_distance = round(float(distance) * factor) if distance else None
    new_duration = round(float(duration) * factor) if duration and not distance else None

    targets = dict(session.get("targets") or {})
    # Alleen de éérste verzachting bewaart het origineel; een tweede zou de
    # oorspronkelijke opzet overschrijven met de al verzachte versie.
    targets.setdefault(
        "downgraded_from",
        {
            "session_type": session["session_type"],
            "title": session.get("title"),
            "planned_distance_m": distance,
            "planned_duration_s": duration,
            "target_type": targets.get("target_type"),
            "structure": session.get("structure"),
        },
    )
    targets["target_type"] = "hr"

    steps = [
        {
            "type": "run",
            "repeat": 1,
            "duration_s": int(new_duration or 0),
            "distance_m": int(new_distance or 0),
            "hr_min": 0,
            "hr_max": int(cap),
            "pace_min_s_per_km": 0,
            "pace_max_s_per_km": 0,
            "note": note_nl,
        }
    ]

    sb.table("plan_sessions").update(
        {
            "session_type": "easy",
            "title": f"Rustig (aangepast): {note_nl}",
            "description": note_nl,
            "structure": {"steps": steps},
            "targets": targets,
            "hr_cap": int(cap) or None,
            "planned_distance_m": new_distance,
            "planned_duration_s": new_duration,
        }
    ).eq("id", session["id"]).execute()


def _pain_changes(
    sb: Client,
    plan_id: int,
    today: date,
    params: dict[str, dict[str, Any]],
    hr_cap: int | None,
) -> list[Change]:
    """De pijnregel, eindelijk afgedwongen in plaats van alleen gemeld.

    `pain_score_override` stond al actief in `coach_rules` en werd nergens
    toegepast: een pijnmelding startte hoogstens een herplanning, en tot die
    klaar was stond de intervaltraining van morgen gewoon nog op het horloge.
    """
    threshold = float((params.get("pain_score_override") or {}).get("pain_threshold", 6))
    since = today - timedelta(days=PAIN_LOOKBACK_DAYS)
    rows = (
        sb.table("session_feedback")
        .select("id, pain_score, created_at")
        .gte("created_at", since.isoformat())
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )
    painful = [r for r in rows if float(r.get("pain_score") or 0) >= threshold]
    if not painful:
        return []

    signal = painful[0]
    score = float(signal["pain_score"])
    signal_day = date.fromisoformat(str(signal["created_at"])[:10])
    until = max(today, signal_day + timedelta(days=PAIN_REST_DAYS))

    changes: list[Change] = []
    for session in _upcoming(sb, plan_id, today, until):
        if session["session_type"] not in HARD_TYPES:
            continue
        note_nl = (
            f"pijnscore {score:.0f} op {signal_day} haalt de drempel van "
            f"{threshold:.0f}; geen intensiteit tot en met {until}"
        )
        note_en = (
            f"pain score {score:.0f} on {signal_day} reached the threshold of "
            f"{threshold:.0f}; no intensity through {until}"
        )
        _soften(
            sb,
            session,
            hr_cap=hr_cap,
            factor=PAIN_DISTANCE_FACTOR,
            note_nl=note_nl,
        )
        changes.append(
            Change(
                rule="pain_score_override",
                severity="override",
                session_id=int(session["id"]),
                day=str(session["day"]),
                from_type=session["session_type"],
                to_type="easy",
                explanation_nl=note_nl,
                explanation_en=note_en,
                evidence={
                    "metric": "pain_score",
                    "value": score,
                    "threshold": threshold,
                    "window": str(session["day"]),
                },
            )
        )
    return changes


def _readiness_changes(
    sb: Client,
    plan_id: int,
    today: date,
    params: dict[str, dict[str, Any]],
    hr_cap: int | None,
) -> list[Change]:
    """`readiness_gate_quality`: een kwaliteitssessie vraagt een uitgerust lijf.

    Bewust alleen vandaag. De readiness van morgen bestaat nog niet, en op de
    dagvorm van vandaag vier weken herplannen is precies wat we hier afschaffen.
    """
    minimum = float((params.get("readiness_gate_quality") or {}).get("min_readiness", 50))
    rows = (
        sb.table("wellness_daily")
        .select("day, training_readiness_score")
        .eq("day", today.isoformat())
        .limit(1)
        .execute()
        .data
    )
    if not rows or rows[0].get("training_readiness_score") is None:
        return []
    score = float(rows[0]["training_readiness_score"])
    if score >= minimum:
        return []

    changes: list[Change] = []
    for session in _upcoming(sb, plan_id, today, today):
        if session["session_type"] not in QUALITY_TYPES:
            continue
        note_nl = (
            f"Training Readiness {score:.0f} ligt onder de drempel van "
            f"{minimum:.0f}; kwaliteit vandaag wordt rustig"
        )
        note_en = (
            f"training readiness {score:.0f} is below the threshold of "
            f"{minimum:.0f}; today's quality session becomes easy"
        )
        _soften(
            sb,
            session,
            hr_cap=hr_cap,
            factor=READINESS_DISTANCE_FACTOR,
            note_nl=note_nl,
        )
        changes.append(
            Change(
                rule="readiness_gate_quality",
                severity="limit",
                session_id=int(session["id"]),
                day=str(session["day"]),
                from_type=session["session_type"],
                to_type="easy",
                explanation_nl=note_nl,
                explanation_en=note_en,
                evidence={
                    "metric": "training_readiness_score",
                    "value": score,
                    "threshold": minimum,
                    "window": str(session["day"]),
                },
            )
        )
    return changes


def _record(sb: Client, plan_id: int, change: Change) -> None:
    """Leg de ingreep vast zodat de app hem kan uitleggen met cijfers.

    Dubbele rijen zijn geen ramp maar wel ruis: de worker draait elk half uur en
    dezelfde pijnmelding blijft drie dagen gelden.
    """
    existing = (
        sb.table("plan_adjustments")
        .select("id")
        .eq("plan_session_id", change.session_id)
        .eq("rule", change.rule)
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return
    sb.table("plan_adjustments").insert(
        {
            "plan_id": plan_id,
            "plan_session_id": change.session_id,
            "rule": change.rule,
            "severity": change.severity,
            "explanation": {"nl": change.explanation_nl, "en": change.explanation_en},
            "evidence": change.evidence,
            "applied": True,
        }
    ).execute()


def _request_repush(sb: Client, session_id: int) -> None:
    """Een sessie die al op het horloge staat moet opnieuw worden gestuurd.

    Zonder dit klopt de database wel en het horloge niet, en het horloge is wat
    hij tijdens het lopen ziet.
    """
    sync_type = f"workout_reschedule:{session_id}"
    open_jobs = (
        sb.table("sync_log")
        .select("id")
        .eq("sync_type", sync_type)
        .in_("status", ["requested", "running"])
        .limit(1)
        .execute()
        .data
    )
    if open_jobs:
        return
    sb.table("sync_log").insert({"sync_type": sync_type, "status": "requested"}).execute()


def apply(
    sb: Client,
    plan_id: int,
    today: date,
    *,
    hr_cap: int | None = None,
) -> list[Change]:
    """Stel het actieve plan bij zonder het model. Geeft terug wat er wijzigde."""
    params = rule_params(sb)
    cap = hr_cap if hr_cap is not None else easy_hr_cap(sb)

    changes = _pain_changes(sb, plan_id, today, params, cap)
    # Een sessie die de pijnregel al heeft verzacht, is geen kwaliteitssessie
    # meer en komt hieronder dus niet nog een keer langs.
    changes += _readiness_changes(sb, plan_id, today, params, cap)

    for change in changes:
        _record(sb, plan_id, change)
        _request_repush(sb, change.session_id)
        log.info(
            "bijgesteld: %s op %s van %s naar %s (%s)",
            change.session_id,
            change.day,
            change.from_type,
            change.to_type,
            change.rule,
        )
    return changes
