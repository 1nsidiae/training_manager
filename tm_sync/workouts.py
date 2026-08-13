"""Plan-sessies als gestructureerde Garmin-workouts versturen.

De browser schrijft alleen een aanvraag in ``sync_log``. Deze module draait in
de worker, waar de Garmin-tokens veilig lokaal blijven. Een sessie geldt pas als
gepusht nadat workout, kalenderitem en device-message alle drie gelukt zijn.
"""

from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta
from typing import Any

from garminconnect import Garmin
from garminconnect.workout import (
    ConditionType,
    ExecutableStep,
    RepeatGroup,
    RunningWorkout,
    SportType,
    StepType,
    TargetType,
    WorkoutSegment,
)
from supabase import Client

from . import clock


SUPPORTED_SESSION_TYPES = {"easy", "recovery", "long", "tempo", "interval", "walk_run", "race"}

# Waarop het horloge alarm slaat. Bij rustige sessies is dat de hartslag: bij
# hitte, wind of vermoeide benen loop je hetzelfde tempo op een veel hogere
# hartslag, en precies daar ontspoorde de training eerder. Bij kwaliteitswerk is
# het omgekeerd, want hartslag loopt achter op korte herhalingen.
PACE_LED_SESSION_TYPES = {"tempo", "interval", "race"}

SPORT = {"sportTypeId": SportType.RUNNING, "sportTypeKey": "running", "displayOrder": 1}
NO_TARGET = {
    "workoutTargetTypeId": TargetType.NO_TARGET,
    "workoutTargetTypeKey": "no.target",
    "displayOrder": 1,
}
HR_TARGET = {
    "workoutTargetTypeId": TargetType.HEART_RATE_ZONE,
    "workoutTargetTypeKey": "heart.rate.zone",
    "displayOrder": 4,
}
PACE_TARGET = {
    "workoutTargetTypeId": TargetType.PACE_ZONE,
    "workoutTargetTypeKey": "pace.zone",
    "displayOrder": 6,
}

STEP_TYPES: dict[str, tuple[int, str, int]] = {
    "warmup": (StepType.WARMUP, "warmup", 1),
    "cooldown": (StepType.COOLDOWN, "cooldown", 2),
    "run": (StepType.INTERVAL, "interval", 3),
    "work": (StepType.INTERVAL, "interval", 3),
    "walk": (StepType.RECOVERY, "recovery", 4),
    "recover": (StepType.RECOVERY, "recovery", 4),
    "recovery": (StepType.RECOVERY, "recovery", 4),
    "rest": (StepType.REST, "rest", 5),
}


def prefers_pace(session: dict[str, Any]) -> bool:
    """Stuurt deze sessie op tempo of op hartslag?

    Een Garmin-stap kan maar één doelsoort tegelijk hebben, dus dit is een echte
    keuze. `target_type` uit het plan is leidend wanneer die eenduidig is; bij
    `both`, `none` of een ouder plan zonder dat veld beslist het sessietype.
    """
    target_type = (session.get("targets") or {}).get("target_type")
    if target_type == "pace":
        return True
    if target_type == "hr":
        return False
    return session.get("session_type") in PACE_LED_SESSION_TYPES


def _pace_target(step: dict[str, Any]) -> dict[str, float] | None:
    """Tempogrenzen staan in het plan als seconden per kilometer; Garmin wil
    meter per seconde."""
    pace_a = float(step.get("pace_min_s_per_km") or 0)
    pace_b = float(step.get("pace_max_s_per_km") or 0)
    if pace_a <= 0 or pace_b <= 0:
        return None
    speeds = sorted((1000.0 / pace_a, 1000.0 / pace_b))
    return {"targetValueOne": speeds[0], "targetValueTwo": speeds[1]}


def _hr_target(step: dict[str, Any]) -> dict[str, float] | None:
    """Een custom HR-range. De ondergrens 50 bpm voorkomt in de praktijk een
    lage-HR-melding, zodat het bedoelde plafond de relevante waarschuwing blijft."""
    hr_max = int(step.get("hr_max") or 0)
    if hr_max <= 0:
        return None
    hr_min = int(step.get("hr_min") or 0)
    lower = hr_min if hr_min > 0 else 50
    if lower >= hr_max:
        lower = max(30, hr_max - 30)
    return {"targetValueOne": float(lower), "targetValueTwo": float(hr_max)}


def _target(
    step: dict[str, Any], *, prefer_pace: bool
) -> tuple[dict[str, Any], dict[str, float]]:
    """Garmin-target en extra velden voor een planstap.

    De voorkeur wint wanneer die beschikbaar is; anders valt hij terug op het
    andere doel. Zonder allebei loopt de stap zonder alarm.
    """
    pace = _pace_target(step)
    heart_rate = _hr_target(step)

    if prefer_pace:
        if pace:
            return PACE_TARGET, pace
        if heart_rate:
            return HR_TARGET, heart_rate
    else:
        if heart_rate:
            return HR_TARGET, heart_rate
        if pace:
            return PACE_TARGET, pace

    return NO_TARGET, {}


def _executable(step: dict[str, Any], order: int, *, prefer_pace: bool) -> ExecutableStep:
    raw_type = str(step.get("type") or "run").lower()
    step_id, step_key, display_order = STEP_TYPES.get(
        raw_type, (StepType.OTHER, "other", 7)
    )
    duration = float(step.get("duration_s") or 0)
    distance = float(step.get("distance_m") or 0)

    if distance > 0:
        condition = {
            "conditionTypeId": ConditionType.DISTANCE,
            "conditionTypeKey": "distance",
            "displayOrder": 3,
            "displayable": True,
        }
        value = distance
    elif duration > 0:
        condition = {
            "conditionTypeId": ConditionType.TIME,
            "conditionTypeKey": "time",
            "displayOrder": 2,
            "displayable": True,
        }
        value = duration
    else:
        condition = {
            "conditionTypeId": ConditionType.LAP_BUTTON,
            "conditionTypeKey": "lap.button",
            "displayOrder": 1,
            "displayable": True,
        }
        value = None

    target_type, target_values = _target(step, prefer_pace=prefer_pace)
    return ExecutableStep(
        stepOrder=order,
        stepType={
            "stepTypeId": step_id,
            "stepTypeKey": step_key,
            "displayOrder": display_order,
        },
        description=str(step.get("note") or "")[:160] or None,
        endCondition=condition,
        endConditionValue=value,
        targetType=target_type,
        **target_values,
    )


def _workout_steps(
    raw_steps: list[dict[str, Any]], *, prefer_pace: bool
) -> list[ExecutableStep | RepeatGroup]:
    """Zet stappen om en behoud gekoppelde intervalherhalingen.

    Aangrenzende stappen met hetzelfde repeat-aantal vormen één Garmin
    repeatgroep (bijvoorbeeld 5 × lopen + wandelen), net zoals in de PWA.
    """
    groups: list[tuple[int, list[dict[str, Any]]]] = []
    for step in raw_steps:
        repeat = max(1, int(step.get("repeat") or 1))
        if groups and repeat > 1 and groups[-1][0] == repeat:
            groups[-1][1].append(step)
        else:
            groups.append((repeat, [step]))

    out: list[ExecutableStep | RepeatGroup] = []
    order = 1
    for repeat, steps in groups:
        if repeat == 1:
            for step in steps:
                out.append(_executable(step, order, prefer_pace=prefer_pace))
                order += 1
            continue

        group_order = order
        order += 1
        children: list[ExecutableStep] = []
        for step in steps:
            children.append(_executable(step, order, prefer_pace=prefer_pace))
            order += 1
        out.append(
            RepeatGroup(
                stepOrder=group_order,
                stepType={
                    "stepTypeId": StepType.REPEAT,
                    "stepTypeKey": "repeat",
                    "displayOrder": 6,
                },
                numberOfIterations=repeat,
                workoutSteps=children,
                endCondition={
                    "conditionTypeId": ConditionType.ITERATIONS,
                    "conditionTypeKey": "iterations",
                    "displayOrder": 7,
                    "displayable": False,
                },
                endConditionValue=float(repeat),
            )
        )
    return out


def build_running_workout(session: dict[str, Any]) -> RunningWorkout:
    """Bouw een typed Garmin-workout zonder netwerkverkeer."""
    if session.get("sport") != "running":
        raise ValueError("Alleen hardloopsessies kunnen momenteel naar Garmin.")
    if session.get("session_type") not in SUPPORTED_SESSION_TYPES:
        raise ValueError("Dit sessietype wordt nog niet als Garmin-workout ondersteund.")

    structure = session.get("structure") or {}
    raw_steps = structure.get("steps") or []
    if not raw_steps:
        raise ValueError("De sessie heeft geen workoutstappen.")

    name = f"TM - {session.get('title') or 'Looptraining'}"[:50]
    return RunningWorkout(
        workoutName=name,
        description=str(session.get("description") or "")[:255] or None,
        estimatedDurationInSecs=max(1, int(session.get("planned_duration_s") or 1)),
        workoutSegments=[
            WorkoutSegment(
                segmentOrder=1,
                sportType=SPORT,
                workoutSteps=_workout_steps(
                    raw_steps, prefer_pace=prefers_pace(session)
                ),
            )
        ],
    )


def _scheduled_item(garmin: Garmin, workout_id: int, workout_day: str) -> dict[str, Any] | None:
    parsed = date.fromisoformat(workout_day)
    calendar = garmin.get_scheduled_workouts(parsed.year, parsed.month)
    for item in calendar.get("calendarItems", []):
        if int(item.get("workoutId") or 0) == workout_id and item.get("date") == workout_day:
            return item
    return None


def _response_id(response: Any, *keys: str) -> int | None:
    if not isinstance(response, dict):
        return None
    for key in keys:
        value = response.get(key)
        if value is not None:
            return int(value)
    return None


def _clear_conflicts(sb: Client, session_id: int) -> None:
    rows = (
        sb.table("sync_log")
        .select("id")
        .like("sync_type", f"workout_conflict:{session_id}:%")
        .eq("status", "error")
        .execute()
        .data
    )
    for row in rows:
        sb.table("sync_log").update(
            {"status": "ok", "finished_at": datetime.now().astimezone().isoformat()}
        ).eq("id", row["id"]).execute()


def _record_conflict(
    sb: Client,
    session: dict[str, Any],
    garmin_day: str | None,
    garmin_schedule_id: int | None = None,
) -> None:
    marker = garmin_day or "removed"
    sync_type = f"workout_conflict:{session['id']}:{marker}"
    existing = (
        sb.table("sync_log")
        .select("id")
        .eq("sync_type", sync_type)
        .eq("status", "error")
        .limit(1)
        .execute()
        .data
    )
    if existing:
        return
    _clear_conflicts(sb, int(session["id"]))
    sb.table("sync_log").insert(
        {
            "sync_type": sync_type,
            "status": "error",
            "error": json.dumps(
                {
                    "kind": "workout_calendar_conflict",
                    "session_id": session["id"],
                    "pwa_day": session["day"],
                    "garmin_day": garmin_day,
                    "garmin_schedule_id": garmin_schedule_id,
                }
            ),
        }
    ).execute()


def _ignore_missing_schedule(exc: Exception) -> bool:
    response = getattr(exc, "response", None)
    return getattr(response, "status_code", None) == 404 or "404" in str(exc)


def push_plan_session(
    garmin: Garmin,
    sb: Client,
    session_id: int,
    *,
    force_reschedule: bool = False,
) -> dict[str, Any]:
    """Upload, plan, push en verifieer één actieve plan-sessie."""
    rows = sb.table("plan_sessions").select("*").eq("id", session_id).limit(1).execute().data
    if not rows:
        raise ValueError(f"Sessie {session_id} bestaat niet.")
    session = rows[0]

    active = (
        sb.table("plans")
        .select("id")
        .eq("id", session["plan_id"])
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    if not active:
        raise ValueError("Alleen een sessie uit het actieve plan kan naar Garmin.")
    if session.get("status") not in {"planned", "moved"}:
        raise ValueError("Alleen een geplande of verplaatste sessie kan naar Garmin.")

    workout = build_running_workout(session)
    workout_id = int(session.get("garmin_workout_id") or 0)
    schedule_id = int(session.get("garmin_schedule_id") or 0)

    try:
        if workout_id:
            garmin.update_workout(workout_id, workout.to_dict())
        else:
            uploaded = garmin.upload_running_workout(workout)
            workout_id = _response_id(uploaded, "workoutId", "id") or 0
            if not workout_id:
                raise RuntimeError("Garmin gaf geen workout-ID terug.")
            sb.table("plan_sessions").update(
                {"garmin_workout_id": workout_id, "push_error": None}
            ).eq("id", session_id).execute()

        stored = garmin.get_workout_by_id(workout_id)
        if int(stored.get("workoutId") or 0) != workout_id:
            raise RuntimeError("De workout kon niet uit Garmin worden teruggelezen.")

        if force_reschedule and schedule_id:
            try:
                garmin.unschedule_workout(schedule_id)
            except Exception as exc:
                if not _ignore_missing_schedule(exc):
                    raise
            schedule_id = 0
            sb.table("plan_sessions").update(
                {"garmin_schedule_id": None, "pushed_at": None}
            ).eq("id", session_id).execute()

        if not schedule_id:
            scheduled = garmin.schedule_workout(workout_id, str(session["day"]))
            schedule_id = _response_id(scheduled, "workoutScheduleId", "scheduleId", "id") or 0

        calendar_item = None
        for attempt in range(3):
            calendar_item = _scheduled_item(garmin, workout_id, str(session["day"]))
            if calendar_item:
                break
            if attempt < 2:
                time.sleep(1)
        if not calendar_item:
            raise RuntimeError("De workout staat na upload niet in de Garmin-kalender.")
        schedule_id = schedule_id or int(calendar_item.get("id") or 0)

        profile = sb.table("athlete_profile").select("garmin_device_id").limit(1).execute().data
        device_id = int(profile[0].get("garmin_device_id") or 0) if profile else 0
        if not device_id:
            raise RuntimeError("Geen Garmin-toestel gevonden; synchroniseer eerst je profiel.")
        garmin.push_workout_to_device(workout_id, device_id)

        pushed_at = datetime.now().astimezone().isoformat()
        sb.table("plan_sessions").update(
            {
                "garmin_workout_id": workout_id,
                "garmin_schedule_id": schedule_id or None,
                "pushed_at": pushed_at,
                "push_error": None,
            }
        ).eq("id", session_id).execute()
        _clear_conflicts(sb, session_id)
        return {
            "session_id": session_id,
            "workout_id": workout_id,
            "schedule_id": schedule_id or None,
            "day": session["day"],
            "pushed_at": pushed_at,
        }
    except Exception as exc:
        sb.table("plan_sessions").update(
            {"push_error": f"{type(exc).__name__}: {exc}", "pushed_at": None}
        ).eq("id", session_id).execute()
        raise


def unschedule_plan_session(garmin: Garmin, sb: Client, session_id: int) -> dict[str, Any]:
    """Haal een sessie uit de Garmin-kalender, maar bewaar de workoutbibliotheek."""
    rows = (
        sb.table("plan_sessions")
        .select("id, garmin_schedule_id")
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"Sessie {session_id} bestaat niet.")
    schedule_id = int(rows[0].get("garmin_schedule_id") or 0)
    if schedule_id:
        try:
            garmin.unschedule_workout(schedule_id)
        except Exception as exc:
            if not _ignore_missing_schedule(exc):
                raise

    sb.table("plan_sessions").update(
        {
            "garmin_schedule_id": None,
            "pushed_at": None,
            "push_error": None,
        }
    ).eq("id", session_id).execute()
    _clear_conflicts(sb, session_id)
    return {"session_id": session_id, "unscheduled": True}


def apply_active_plan(
    garmin: Garmin,
    sb: Client,
    plan_id: int,
    previous_plan_id: int | None = None,
    *,
    from_day: date | None = None,
) -> dict[str, Any]:
    """Vervang de toekomstige Garmin-planning door het goedgekeurde plan.

    Oude toekomstige kalenderitems worden eerst verwijderd. Daarna worden alle
    ondersteunde loopsessies uit de nieuwe actieve versie gepland en naar het
    horloge gestuurd. Een fout bij één sessie stopt de overige sessies niet.
    """
    active = (
        sb.table("plans")
        .select("id")
        .eq("id", plan_id)
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    if not active:
        raise ValueError("Alleen het actieve plan kan naar Garmin worden gestuurd.")

    start = (from_day or clock.today()).isoformat()
    removed = 0
    pushed = 0
    ignored = 0
    failures: list[str] = []

    if previous_plan_id and previous_plan_id != plan_id:
        previous = (
            sb.table("plan_sessions")
            .select("id, garmin_schedule_id")
            .eq("plan_id", previous_plan_id)
            .gte("day", start)
            .in_("status", ["planned", "moved"])
            .order("day")
            .execute()
            .data
        )
        for session in previous:
            if not session.get("garmin_schedule_id"):
                continue
            try:
                unschedule_plan_session(garmin, sb, int(session["id"]))
                removed += 1
            except Exception as exc:  # noqa: BLE001 - probeer de rest van het plan
                failures.append(
                    f"oude sessie {session['id']} verwijderen: {type(exc).__name__}: {exc}"
                )

    upcoming = (
        sb.table("plan_sessions")
        .select("id, sport, session_type")
        .eq("plan_id", plan_id)
        .gte("day", start)
        .in_("status", ["planned", "moved"])
        .order("day")
        .execute()
        .data
    )
    for session in upcoming:
        supported = (
            session.get("sport") == "running"
            and session.get("session_type") in SUPPORTED_SESSION_TYPES
        )
        if not supported:
            ignored += 1
            continue
        try:
            push_plan_session(garmin, sb, int(session["id"]))
            pushed += 1
        except Exception as exc:  # noqa: BLE001 - fout staat ook op de plansessie
            failures.append(
                f"nieuwe sessie {session['id']} sturen: {type(exc).__name__}: {exc}"
            )

    if failures:
        preview = "; ".join(failures[:3])
        extra = f" (+{len(failures) - 3} meer)" if len(failures) > 3 else ""
        raise RuntimeError(
            f"Garmin-plan gedeeltelijk bijgewerkt: {pushed} verstuurd, "
            f"{removed} verwijderd. {preview}{extra}"
        )

    return {
        "plan_id": plan_id,
        "previous_plan_id": previous_plan_id,
        "pushed": pushed,
        "removed": removed,
        "ignored": ignored,
    }


def accept_garmin_calendar(
    sb: Client,
    session_id: int,
    garmin_day: str | None,
    garmin_schedule_id: int | None = None,
) -> dict[str, Any]:
    """Neem een bewuste Garmin-kalenderwijziging over in het actieve plan."""
    rows = (
        sb.table("plan_sessions")
        .select("id, plan_id, status")
        .eq("id", session_id)
        .limit(1)
        .execute()
        .data
    )
    if not rows:
        raise ValueError(f"Sessie {session_id} bestaat niet.")
    session = rows[0]
    active = (
        sb.table("plans")
        .select("id")
        .eq("id", session["plan_id"])
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    if not active:
        raise ValueError("Alleen het actieve plan kan vanuit Garmin worden aangepast.")

    if garmin_day:
        date.fromisoformat(garmin_day)
        sb.table("plan_sessions").update(
            {
                "day": garmin_day,
                "status": "moved",
                "garmin_schedule_id": garmin_schedule_id,
                "push_error": None,
            }
        ).eq("id", session_id).execute()
    else:
        sb.table("plan_sessions").update(
            {
                "status": "skipped",
                "garmin_schedule_id": None,
                "pushed_at": None,
                "push_error": None,
            }
        ).eq("id", session_id).execute()
    _clear_conflicts(sb, session_id)
    return {"session_id": session_id, "accepted_day": garmin_day}


def _month_pairs(start: date, end: date) -> list[tuple[int, int]]:
    cursor = start.replace(day=1)
    pairs: list[tuple[int, int]] = []
    while cursor <= end:
        pairs.append((cursor.year, cursor.month))
        cursor = (cursor.replace(day=28) + timedelta(days=4)).replace(day=1)
    return pairs


def sync_workout_calendar(garmin: Garmin, sb: Client) -> dict[str, int]:
    """Vergelijk de actieve PWA-planning met Garmin zonder stil te overschrijven."""
    plans = sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    if not plans:
        return {"checked": 0, "conflicts": 0}
    sessions = (
        sb.table("plan_sessions")
        .select(
            "id, day, status, garmin_workout_id, garmin_schedule_id, pushed_at"
        )
        .eq("plan_id", plans[0]["id"])
        .in_("status", ["planned", "moved"])
        .order("day")
        .execute()
        .data
    )
    sessions = [s for s in sessions if s.get("garmin_workout_id")]
    if not sessions:
        return {"checked": 0, "conflicts": 0}

    first = date.fromisoformat(str(sessions[0]["day"])) - timedelta(days=32)
    last = date.fromisoformat(str(sessions[-1]["day"])) + timedelta(days=32)
    calendar_items: list[dict[str, Any]] = []
    for year, month in _month_pairs(first, last):
        calendar = garmin.get_scheduled_workouts(year, month)
        calendar_items.extend(
            item
            for item in calendar.get("calendarItems", [])
            if item.get("itemType") == "workout" and item.get("workoutId")
        )

    by_workout: dict[int, list[dict[str, Any]]] = {}
    for item in calendar_items:
        by_workout.setdefault(int(item["workoutId"]), []).append(item)

    conflicts = 0
    for session in sessions:
        workout_id = int(session["garmin_workout_id"])
        candidates = by_workout.get(workout_id, [])
        matching = next(
            (item for item in candidates if item.get("date") == session["day"]),
            None,
        )
        if matching:
            schedule_id = int(matching.get("id") or 0)
            if schedule_id and schedule_id != int(session.get("garmin_schedule_id") or 0):
                sb.table("plan_sessions").update(
                    {"garmin_schedule_id": schedule_id}
                ).eq("id", session["id"]).execute()
            _clear_conflicts(sb, int(session["id"]))
            continue

        if candidates:
            garmin_day = str(candidates[0].get("date"))
            remote_schedule_id = int(candidates[0].get("id") or 0) or None
            if remote_schedule_id != int(session.get("garmin_schedule_id") or 0):
                sb.table("plan_sessions").update(
                    {"garmin_schedule_id": remote_schedule_id}
                ).eq("id", session["id"]).execute()
            _record_conflict(
                sb,
                session,
                garmin_day,
                remote_schedule_id,
            )
            conflicts += 1
        elif session.get("garmin_schedule_id") and session.get("pushed_at"):
            _record_conflict(sb, session, None)
            conflicts += 1

    return {"checked": len(sessions), "conflicts": conflicts}
