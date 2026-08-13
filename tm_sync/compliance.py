"""Deterministische controle van een geplande sessie tegen Garmin-resultaten.

Dit is bewust geen AI-oordeel. Dezelfde getallen leveren altijd dezelfde status,
zodat een waarschuwing en een automatische reductie controleerbaar blijven.
"""

from __future__ import annotations

from typing import Any

STATUS_RANK = {"unknown": 0, "met": 1, "partial": 2, "missed": 3}
PACE_SESSION_TYPES = {"tempo", "race"}


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


def _pace_band(
    session: dict[str, Any]
) -> tuple[float | None, float | None, float]:
    fast: list[float] = []
    slow: list[float] = []
    targeted_distance = 0.0
    targeted_duration = 0.0
    structure = session.get("structure") or {}
    for step in structure.get("steps") or []:
        if step.get("type") not in {"work", "run"}:
            continue
        pace_fast = _number(step.get("pace_min_s_per_km"))
        pace_slow = _number(step.get("pace_max_s_per_km"))
        if pace_fast:
            fast.append(pace_fast)
        if pace_slow:
            slow.append(pace_slow)
        if pace_fast or pace_slow:
            repeat = _number(step.get("repeat")) or 1
            targeted_distance += (_number(step.get("distance_m")) or 0) * repeat
            targeted_duration += (_number(step.get("duration_s")) or 0) * repeat

    planned_distance = _number(session.get("planned_distance_m"))
    planned_duration = _number(session.get("planned_duration_s"))
    if planned_distance and targeted_distance:
        coverage = min(1.0, targeted_distance / planned_distance)
    elif planned_duration and targeted_duration:
        coverage = min(1.0, targeted_duration / planned_duration)
    else:
        coverage = 0.0
    return (
        min(fast) if fast else None,
        max(slow) if slow else None,
        coverage,
    )


def evaluate_session(
    session: dict[str, Any], activity: dict[str, Any]
) -> dict[str, Any]:
    """Geef `met`, `partial`, `missed` of `unknown` met meetbare redenen.

    Toleranties voorkomen dat GPS-ruis of een normale cooling-down als mislukking
    geldt. Een gemiddelde HR boven een bovengrens is wél ondubbelzinnig: dan zat
    een betekenisvol deel van de sessie erboven.
    """
    status = "unknown"
    reasons: list[str] = []

    def mark(next_status: str, reason: str) -> None:
        nonlocal status
        if STATUS_RANK[next_status] > STATUS_RANK[status]:
            status = next_status
        reasons.append(reason)

    planned_distance = _number(session.get("planned_distance_m"))
    actual_distance = _number(activity.get("distance_m"))
    planned_duration = _number(session.get("planned_duration_s"))
    actual_duration = _number(activity.get("duration_s"))

    completion_ratio = None
    if planned_distance and actual_distance:
        completion_ratio = actual_distance / planned_distance
    elif planned_duration and actual_duration:
        completion_ratio = actual_duration / planned_duration

    if completion_ratio is not None:
        status = "met"
        if completion_ratio < 0.85:
            mark("missed", "completion_below_85pct")
        elif completion_ratio < 0.95:
            mark("partial", "completion_below_95pct")

    hr_cap = _number(session.get("hr_cap"))
    avg_hr = _number(activity.get("avg_hr"))
    if hr_cap and avg_hr:
        if status == "unknown":
            status = "met"
        if avg_hr > hr_cap + 5:
            mark("missed", "average_hr_more_than_5_above_cap")
        elif avg_hr > hr_cap:
            mark("partial", "average_hr_above_cap")

    pace_fast, pace_slow, pace_coverage = _pace_band(session)
    actual_pace = _number(activity.get("avg_pace_s_per_km"))
    if (
        session.get("session_type") in PACE_SESSION_TYPES
        and actual_pace
        and pace_fast
        and pace_slow
        and pace_coverage >= 0.8
    ):
        if status == "unknown":
            status = "met"
        if actual_pace > pace_slow * 1.08:
            mark("missed", "pace_more_than_8pct_slower_than_target")
        elif actual_pace < pace_fast * 0.92:
            mark("missed", "pace_more_than_8pct_faster_than_target")
        elif actual_pace > pace_slow:
            mark("partial", "pace_slower_than_target")
        elif actual_pace < pace_fast:
            mark("partial", "pace_faster_than_target")

    return {
        "version": 1,
        "status": status,
        "reasons": reasons,
        "completion_ratio": round(completion_ratio, 3)
        if completion_ratio is not None
        else None,
        "planned_distance_m": round(planned_distance) if planned_distance else None,
        "actual_distance_m": round(actual_distance) if actual_distance else None,
        "planned_duration_s": round(planned_duration) if planned_duration else None,
        "actual_duration_s": round(actual_duration) if actual_duration else None,
        "hr_cap": round(hr_cap) if hr_cap else None,
        "avg_hr": round(avg_hr) if avg_hr else None,
        "hr_delta": round(avg_hr - hr_cap) if hr_cap and avg_hr else None,
        "pace_target_fast_s_per_km": round(pace_fast) if pace_fast else None,
        "pace_target_slow_s_per_km": round(pace_slow) if pace_slow else None,
        "actual_pace_s_per_km": round(actual_pace) if actual_pace else None,
        "pace_target_coverage": round(pace_coverage, 3),
    }


def is_heavy_feedback(feedback: dict[str, Any]) -> bool:
    extra = feedback.get("extra") or {}
    try:
        rpe = float(extra.get("rpe") or 0)
        endurance = float(feedback.get("endurance_score") or 10)
    except (TypeError, ValueError):
        return False
    return rpe >= 8 or endurance <= 2


def consecutive_heavy_misses(
    feedback_rows: list[dict[str, Any]],
    sessions_by_id: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    """De twee recentste gekoppelde loopfeedbacks moeten beide zwaar gemist zijn."""
    linked: list[dict[str, Any]] = []
    for feedback in feedback_rows:
        session_id = feedback.get("plan_session_id")
        session = sessions_by_id.get(int(session_id)) if session_id is not None else None
        if not session:
            continue
        compliance = (session.get("targets") or {}).get("compliance") or {}
        linked.append(
            {
                "feedback": feedback,
                "session": session,
                "compliance": compliance,
            }
        )
        if len(linked) == 2:
            break

    if len(linked) < 2:
        return []
    if all(
        item["compliance"].get("status") == "missed"
        and is_heavy_feedback(item["feedback"])
        for item in linked
    ):
        return linked
    return []
