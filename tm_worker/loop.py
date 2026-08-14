"""Eén tick van de worker: sync, features, triggers, coach.

Adaptief venster: dicht in het ochtendvenster waarin slaap, HRV en readiness
binnenkomen, en dicht na een nieuwe activiteit. De rest van de dag rustig, want
het blijft een unofficiële API.
"""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta
from typing import Any

from supabase import Client

from tm_coach.engine import generate_plan
from tm_sync import activities as activities_mod
from tm_sync import features, profile as profile_mod, wellness as wellness_mod
from tm_sync import clock
from tm_sync import tokens as tokens_mod
from tm_sync import workouts as workouts_mod
from tm_sync.clients import garmin_client, supabase_client
from tm_sync.config import Settings, load_settings

from . import adjust as adjust_mod
from . import reminders as reminders_mod
from . import triggers as triggers_mod

log = logging.getLogger(__name__)

RECENT_DAYS = 14
PLAN_WEEKS = 4

MORNING_WINDOW = range(6, 10)
DENSE_MINUTES = 5
CALM_MINUTES = 30

PREWORKOUT_DECISIONS = {"lighten", "move", "recover"}


def _preworkout_trigger(
    sb: Client,
    sync_type: str,
    request_id: int,
) -> triggers_mod.Trigger | None:
    """Maak van een expliciete app-review een eenmalige coachtrigger.

    De directe pre-workout beslissing blijft deterministisch in de PWA. Alleen
    wanneer de atleet bewust om een planvoorstel vraagt, komt het model erbij.
    """
    if not sync_type.startswith("preworkout_review:"):
        return None
    parts = sync_type.split(":")
    if len(parts) != 3 or parts[2] not in PREWORKOUT_DECISIONS:
        raise ValueError(f"ongeldige pre-workout review: {sync_type}")
    session_id = int(parts[1])
    rows = (
        sb.table("plan_sessions")
        .select("id, day, title, session_type, status")
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"plansessie {session_id} bestaat niet")
    session = rows[0]
    decision_nl = {
        "lighten": "vandaag lichter trainen",
        "move": "de training verplaatsen",
        "recover": "er een hersteldag van maken",
    }[parts[2]]
    return triggers_mod.Trigger(
        "alarm" if parts[2] == "recover" else "manual",
        f"preworkout:{session_id}:request={request_id}",
        (
            f"expliciete pre-workout review voor {session['title']} op {session['day']}; "
            f"deterministische aanbeveling: {decision_nl}"
        ),
    )


def _coach_chat_trigger(
    sb: Client,
    sync_type: str,
    request_id: int,
) -> triggers_mod.Trigger | None:
    """Maak alleen na expliciet akkoord een planreview vanuit de chat."""
    if not sync_type.startswith("coach_chat_review:"):
        return None
    parts = sync_type.split(":")
    if len(parts) != 2:
        raise ValueError(f"ongeldige coachchat-review: {sync_type}")
    message_id = int(parts[1])
    rows = (
        sb.table("coach_messages")
        .select("id, role, content, metadata")
        .eq("id", message_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"coachbericht {message_id} bestaat niet")
    message = rows[0]
    metadata = message.get("metadata") or {}
    if message.get("role") != "assistant" or not metadata.get("needs_plan_review"):
        raise ValueError("dit coachbericht bevat geen planadvies")
    reason = str(metadata.get("review_reason") or message.get("content") or "").strip()
    return triggers_mod.Trigger(
        "manual",
        f"coach_chat:{message_id}:request={request_id}",
        f"expliciete planreview vanuit coachgesprek: {reason[:1200]}",
    )


def _goal_plan_trigger(
    sb: Client,
    sync_type: str,
    request_id: int,
) -> triggers_mod.Trigger | None:
    """Laat de wizard een nieuw doel doorrekenen zonder het al te activeren."""
    if not sync_type.startswith("goal_plan_review:"):
        return None
    parts = sync_type.split(":")
    if len(parts) != 2:
        raise ValueError(f"ongeldige nieuw-planreview: {sync_type}")
    goal_id = int(parts[1])
    rows = (
        sb.table("goals")
        .select("id, goal_type, name, target_date, target_distance_m, target_time_s, params")
        .eq("id", goal_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"trainingsdoel {goal_id} bestaat niet")
    goal = rows[0]
    return triggers_mod.Trigger(
        "goal_changed",
        f"goal_plan:{goal_id}:request={request_id}",
        (
            f"expliciete aanvraag voor een nieuw trainingsdoel: {goal['name']}; "
            f"type {goal['goal_type']}; doelafstand {goal.get('target_distance_m')}; "
            f"doeldatum {goal.get('target_date')}; doeltijd {goal.get('target_time_s')}. "
            "Gebruik alle antwoorden in goal.params en maak een eerste adaptief blok."
        ),
        goal_id=goal_id,
    )


def next_interval_minutes(sb: Client, now: datetime | None = None) -> int:
    """Hoe lang tot de volgende tick.

    Dicht wanneer er iets te halen valt, rustig wanneer niet. Zonder dit zou de
    worker de hele nacht doorpollen voor data die pas 's ochtends bestaat.
    """
    now = now or clock.now()
    if now.hour in MORNING_WINDOW:
        return DENSE_MINUTES

    last = (
        sb.table("activities")
        .select("synced_at")
        .order("synced_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if last:
        synced = datetime.fromisoformat(str(last[0]["synced_at"]).replace("Z", "+00:00"))
        if datetime.now(synced.tzinfo) - synced < timedelta(hours=1):
            return DENSE_MINUTES

    return CALM_MINUTES


def _active_goal(sb: Client) -> dict[str, Any] | None:
    rows = sb.table("goals").select("*").eq("status", "active").limit(1).execute().data
    return rows[0] if rows else None


def check_token_expiry(sb: Client, settings: Settings) -> dict[str, Any] | None:
    """Waarschuw ruim voordat de Garmin-tokens verlopen.

    Zonder dit merk je het pas wanneer de sync op een ochtend stilvalt, en dan
    moet je alsnog lokaal opnieuw inloggen — met een gat in je data ertussen.
    De waarschuwing gaat één keer per dag naar `sync_log`, zodat ze ook buiten
    de containerlogs te zien is.
    """
    warning = tokens_mod.expiry_warning(settings.garmin_tokenstore)
    if not warning:
        return None

    log.warning(
        "Garmin-tokens: %s dagen oud, nog ongeveer %s dagen geldig. %s",
        warning["days_since_login"],
        warning["days_remaining"],
        warning["action"],
    )

    today = clock.today().isoformat()
    sync_type = f"garmin_token_expiry:{today}"
    already = (
        sb.table("sync_log").select("id").eq("sync_type", sync_type).limit(1).execute().data
    )
    if already:
        return warning

    sb.table("sync_log").insert(
        {
            "sync_type": sync_type,
            "status": "error",
            "finished_at": datetime.now().astimezone().isoformat(),
            "error": json.dumps({"kind": "garmin_token_expiry", **warning}),
        }
    ).execute()
    return warning


def pending_request(sb: Client) -> dict[str, Any] | None:
    """Wacht er een handmatige sync-aanvraag uit de app?"""
    rows = (
        sb.table("sync_log")
        .select("id, sync_type, started_at")
        .eq("status", "requested")
        .order("id")
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


def _claim_request(sb: Client) -> dict[str, Any] | None:
    """Aanvraag op 'running' zetten voordat we hem uitvoeren.

    De update filtert nog een keer op 'requested', zodat twee workers dezelfde
    aanvraag niet allebei kunnen oppakken: de tweede krijgt nul rijen terug.
    """
    row = pending_request(sb)
    if not row:
        return None
    claimed = (
        sb.table("sync_log")
        .update({"status": "running", "started_at": datetime.now().astimezone().isoformat()})
        .eq("id", row["id"])
        .eq("status", "requested")
        .execute()
        .data
    )
    return claimed[0] if claimed else None


def _close_request(
    sb: Client,
    request: dict[str, Any] | None,
    today: date,
    start: str | None,
    end: str | None,
    *,
    items: int = 0,
    error: str | None = None,
) -> None:
    """De aanvraagrij afsluiten zodat de app weet dat het klaar is."""
    if not request:
        return
    sb.table("sync_log").update(
        {
            "status": "error" if error else "ok",
            "finished_at": datetime.now().astimezone().isoformat(),
            "items_synced": items,
            "window_start": start,
            "window_end": end,
            "error": error,
        }
    ).eq("id", request["id"]).execute()


def _log_scheduled_sync(
    sb: Client,
    started: datetime,
    start: str,
    end: str,
    *,
    items: int = 0,
    error: str | None = None,
) -> None:
    """Leg een geplande sync vast, net als een sync op verzoek.

    Zonder dit is de worker onzichtbaar: hij synct elk half uur, maar `sync_log`
    kende alleen rijen van een druk op de knop. De app las daardoor een tijdstip
    van uren geleden terwijl de data allang ververst was — je kon niet zien of
    de automatische sync draaide of stilstond.
    """
    try:
        sb.table("sync_log").insert(
            {
                "sync_type": "scheduled",
                "status": "error" if error else "ok",
                "started_at": started.isoformat(),
                "finished_at": clock.utc_now().isoformat(),
                "items_synced": items,
                "window_start": start,
                "window_end": end,
                "error": error,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 - loggen mag de sync niet vellen
        log.warning("kon geplande sync niet vastleggen: %s: %s", type(exc).__name__, exc)


def tick(
    sb: Client,
    settings: Settings,
    *,
    with_sync: bool = True,
    with_coach: bool = True,
) -> dict[str, Any]:
    today = clock.today()
    result: dict[str, Any] = {
        "synced": 0,
        "adjustments": [],
        "notified": [],
        "triggers": [],
        "plan": None,
    }

    try:
        result["token_warning"] = check_token_expiry(sb, settings)
    except Exception as exc:  # noqa: BLE001 - een houdbaarheidscontrole mag niets blokkeren
        log.warning("tokencontrole mislukt: %s: %s", type(exc).__name__, exc)

    # Een druk op de knop in de app weegt zwaarder dan het schema: die voeren we
    # uit ook als deze worker draait met --no-sync.
    request = _claim_request(sb)
    if request:
        log.info("aanvraag %d (%s) opgepakt", request["id"], request["sync_type"])

    # Workoutacties zijn kleine, afgebakende jobs. Ze mogen geen volledige
    # biometrische sync of coach-run veroorzaken.
    workout_request = str(request.get("sync_type") or "") if request else ""
    preworkout_request = bool(request and workout_request.startswith("preworkout_review:"))
    coach_chat_request = bool(request and workout_request.startswith("coach_chat_review:"))
    goal_plan_request = bool(request and workout_request.startswith("goal_plan_review:"))
    plan_review_request = preworkout_request or coach_chat_request or goal_plan_request
    sync_start: str | None = None
    sync_end: str | None = None
    if request and workout_request.startswith(
        (
            "workout_push:",
            "workout_reschedule:",
            "workout_unschedule:",
            "workout_accept_garmin:",
            "plan_apply:",
        )
    ):
        try:
            parts = workout_request.split(":")
            if workout_request.startswith("plan_apply:"):
                plan_id = int(parts[1])
                previous_plan_id = (
                    int(parts[2]) if len(parts) > 2 and int(parts[2]) > 0 else None
                )
                garmin = garmin_client(settings)
                result["plan_garmin"] = workouts_mod.apply_active_plan(
                    garmin,
                    sb,
                    plan_id,
                    previous_plan_id,
                    from_day=today,
                )
            else:
                session_id = int(parts[1])

            if workout_request.startswith("workout_accept_garmin:"):
                garmin_day = None if parts[2] == "removed" else parts[2]
                schedule_id = int(parts[3]) if len(parts) > 3 and parts[3] else None
                result["workout_calendar"] = workouts_mod.accept_garmin_calendar(
                    sb, session_id, garmin_day, schedule_id
                )
            elif not workout_request.startswith("plan_apply:"):
                garmin = garmin_client(settings)
                if workout_request.startswith("workout_unschedule:"):
                    result["workout_calendar"] = workouts_mod.unschedule_plan_session(
                        garmin, sb, session_id
                    )
                else:
                    result["workout_push"] = workouts_mod.push_plan_session(
                        garmin,
                        sb,
                        session_id,
                        force_reschedule=workout_request.startswith("workout_reschedule:"),
                    )
        except Exception as exc:  # noqa: BLE001
            log.error("workout-push mislukt: %s: %s", type(exc).__name__, exc)
            _close_request(sb, request, today, None, None, error=f"{type(exc).__name__}: {exc}")
        else:
            plan_result = result.get("plan_garmin") or {}
            items = int(plan_result.get("pushed", 0)) + int(plan_result.get("removed", 0))
            _close_request(sb, request, today, None, None, items=items or 1)
        return result

    if with_sync or request:
        start = (today - timedelta(days=RECENT_DAYS)).isoformat()
        end = today.isoformat()
        sync_start, sync_end = start, end
        sync_started_at = clock.utc_now()
        try:
            garmin = garmin_client(settings)
            result["synced"] += profile_mod.sync_profile(garmin, sb, settings)
            result["synced"] += activities_mod.sync_activities(
                garmin, sb, settings, start, end
            )
            result["synced"] += wellness_mod.sync_wellness(garmin, sb, settings, start, end)
            result["synced"] += wellness_mod.sync_fitness(garmin, sb, settings, start, end)
            features.compute_all(sb)
        except Exception as exc:  # noqa: BLE001
            log.error("sync mislukt: %s: %s", type(exc).__name__, exc)
            log.error("Bij een loginfout: draai scripts/garmin_login.py opnieuw.")
            if request:
                _close_request(sb, request, today, start, end, error=f"{type(exc).__name__}: {exc}")
            else:
                _log_scheduled_sync(
                    sb, sync_started_at, start, end, error=f"{type(exc).__name__}: {exc}"
                )
            request = None
        else:
            # Een pre-workout job is pas klaar wanneer ook het planvoorstel er
            # staat. Alle gewone syncjobs kunnen hier meteen worden gesloten.
            if request:
                if not plan_review_request:
                    _close_request(sb, request, today, start, end, items=result["synced"])
            else:
                _log_scheduled_sync(
                    sb, sync_started_at, start, end, items=result["synced"]
                )
            try:
                result["workout_calendar"] = workouts_mod.sync_workout_calendar(
                    garmin, sb
                )
            except Exception as exc:  # noqa: BLE001 - kalendercheck mag data-sync niet breken
                log.warning("Garmin-kalendercontrole mislukt: %s: %s", type(exc).__name__, exc)

    # Statussen bijwerken vóór detectie: een gemiste sessie is een feit, ook
    # als er geen herplanning uit volgt.
    plan_rows = (
        sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    )
    if plan_rows:
        triggers_mod.mark_skipped(sb, plan_rows[0]["id"], today)

        # Eerst gratis bijstellen, dan pas kijken of er nog een modelaanroep
        # nodig is. Een pijnmelding moet vandaag effect hebben op het horloge,
        # niet pas wanneer de coach klaar is met vier weken herplannen.
        try:
            result["adjustments"] = [
                {
                    "rule": change.rule,
                    "day": change.day,
                    "from": change.from_type,
                    "to": change.to_type,
                    "why": change.explanation_nl,
                }
                for change in adjust_mod.apply(sb, plan_rows[0]["id"], today)
            ]
        except Exception as exc:  # noqa: BLE001 - bijstellen mag de tick niet vellen
            log.error("bijstellen mislukt: %s: %s", type(exc).__name__, exc)

    # Meldingen die uit de toestand volgen. Alles is idempotent op dedupe_key,
    # dus dit elke tick draaien levert hoogstens één melding per gebeurtenis op.
    try:
        result["notified"] = reminders_mod.run_all(
            sb,
            plan_rows[0]["id"] if plan_rows else None,
            today,
            clock.now().hour,
            token=result.get("token_warning"),
        )
    except Exception as exc:  # noqa: BLE001 - melden mag de tick niet vellen
        log.error("meldingen mislukt: %s: %s", type(exc).__name__, exc)

    found = triggers_mod.detect(sb, today)
    if preworkout_request and request:
        try:
            explicit = _preworkout_trigger(sb, workout_request, int(request["id"]))
        except Exception as exc:  # noqa: BLE001
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error=f"{type(exc).__name__}: {exc}",
            )
            return result
        if explicit:
            # De door de atleet aangevraagde review gaat voor op achtergrond-
            # triggers die toevallig in dezelfde tick werden gevonden.
            found.insert(0, explicit)
    if coach_chat_request and request:
        try:
            explicit = _coach_chat_trigger(sb, workout_request, int(request["id"]))
        except Exception as exc:  # noqa: BLE001
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error=f"{type(exc).__name__}: {exc}",
            )
            return result
        if explicit:
            found.insert(0, explicit)
    if goal_plan_request and request:
        try:
            explicit = _goal_plan_trigger(sb, workout_request, int(request["id"]))
        except Exception as exc:  # noqa: BLE001
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error=f"{type(exc).__name__}: {exc}",
            )
            return result
        if explicit:
            found.insert(0, explicit)
    result["triggers"] = [{"kind": t.kind, "key": t.key, "reason": t.reason} for t in found]

    for t in found:
        log.info("trigger %s — %s", t.kind, t.reason)

    if not with_coach or not found:
        if plan_review_request and request:
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error="Coachreview is uitgeschakeld of leverde geen trigger op.",
            )
        return result

    top = found[0]
    if top.goal_id is not None:
        rows = sb.table("goals").select("*").eq("id", top.goal_id).limit(1).execute().data
        goal = rows[0] if rows else None
    else:
        goal = _active_goal(sb)
    if not goal:
        log.warning("triggers gevonden maar geen actief doel; coach niet aangeroepen")
        if plan_review_request and request:
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error="Geen actief trainingsdoel gevonden.",
            )
        return result

    # Eén aanroep per tick, zwaarste trigger eerst. De rest wordt volgende keer
    # opgepikt of is dan niet meer relevant.
    log.info("coach aanroepen voor %s (%s)", top.kind, top.key)
    try:
        result["plan"] = generate_plan(
            sb,
            settings,
            goal,
            trigger=top.kind,
            weeks=PLAN_WEEKS,
            trigger_key=top.key,
            trigger_reason=top.reason,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("herplanning mislukt: %s: %s", type(exc).__name__, exc)
        if plan_review_request and request:
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                error=f"{type(exc).__name__}: {exc}",
            )
    else:
        if plan_review_request and request:
            _close_request(
                sb,
                request,
                today,
                sync_start,
                sync_end,
                items=1,
            )

    return result


def run_once(*, with_sync: bool = True, with_coach: bool = True) -> dict[str, Any]:
    settings = load_settings()
    sb = supabase_client(settings)
    return tick(sb, settings, with_sync=with_sync, with_coach=with_coach)
