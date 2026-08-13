"""Garmin JSON naar tabelrijen.

Alle mappers zijn defensief: ontbrekende velden worden None, en de volledige
respons gaat altijd mee in `raw`. Zo kunnen we later velden toevoegen zonder
opnieuw te syncen.
"""

from __future__ import annotations

from typing import Any

SPORT_MAP = {
    "running": "running",
    "treadmill_running": "running",
    "trail_running": "running",
    "track_running": "running",
    "indoor_running": "running",
    "cycling": "cycling",
    "road_biking": "cycling",
    "indoor_cycling": "cycling",
    "mountain_biking": "cycling",
    "gravel_cycling": "cycling",
    "virtual_ride": "cycling",
    "lap_swimming": "swimming",
    "open_water_swimming": "swimming",
    "walking": "walking",
    "hiking": "walking",
    "casual_walking": "walking",
    "speed_walking": "walking",
    "strength_training": "strength",
    "indoor_cardio": "strength",
}

RUN_TYPE_KEYS = {
    "running",
    "treadmill_running",
    "trail_running",
    "track_running",
    "indoor_running",
}


def _num(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _int(value: Any) -> int | None:
    n = _num(value)
    return None if n is None else int(round(n))


def type_key(activity: dict[str, Any]) -> str:
    return (activity.get("activityType") or {}).get("typeKey") or "other"


def map_activity(a: dict[str, Any]) -> dict[str, Any]:
    """Activity header -> rij voor `activities`."""
    speed = _num(a.get("averageSpeed"))
    pace = 1000 / speed if speed else None

    gmt = a.get("startTimeGMT")
    start_time = f"{gmt}+00:00" if gmt else None

    return {
        "garmin_activity_id": int(a["activityId"]),
        "sport": SPORT_MAP.get(type_key(a), "other"),
        "sub_sport": type_key(a),
        "name": a.get("activityName"),
        "start_time": start_time,
        "start_time_local": a.get("startTimeLocal"),
        "duration_s": _num(a.get("duration")),
        "moving_duration_s": _num(a.get("movingDuration")),
        "distance_m": _num(a.get("distance")),
        "avg_hr": _int(a.get("averageHR")),
        "max_hr": _int(a.get("maxHR")),
        "avg_pace_s_per_km": pace,
        "elevation_gain_m": _num(a.get("elevationGain")),
        "calories": _int(a.get("calories")),
        "aerobic_training_effect": _num(a.get("aerobicTrainingEffect")),
        "anaerobic_training_effect": _num(a.get("anaerobicTrainingEffect")),
        "avg_cadence": _num(a.get("averageRunningCadenceInStepsPerMinute")),
        "avg_power": _num(a.get("avgPower")),
        "vo2max": _num(a.get("vO2MaxValue")),
        "perceived_exertion": _int(a.get("perceivedExertion")),
        "raw": a,
    }


def map_zones(activity_id: int, a: dict[str, Any]) -> list[dict[str, Any]]:
    """Zonetijd zit al in de activity header (hrTimeInZone_1..5) — geen extra call."""
    rows = []
    for z in range(1, 6):
        secs = _num(a.get(f"hrTimeInZone_{z}"))
        if secs is None:
            continue
        rows.append(
            {
                "activity_id": activity_id,
                "zone_number": z,
                "seconds_in_zone": secs,
            }
        )
    return rows


def map_laps(activity_id: int, splits: dict[str, Any] | None) -> list[dict[str, Any]]:
    if not splits:
        return []
    rows = []
    for i, lap in enumerate(splits.get("lapDTOs") or []):
        speed = _num(lap.get("averageSpeed"))
        rows.append(
            {
                "activity_id": activity_id,
                "lap_index": i,
                "duration_s": _num(lap.get("duration")),
                "distance_m": _num(lap.get("distance")),
                "avg_hr": _int(lap.get("averageHR")),
                "max_hr": _int(lap.get("maxHR")),
                "avg_pace_s_per_km": 1000 / speed if speed else None,
                "elevation_gain_m": _num(lap.get("elevationGain")),
                "raw": lap,
            }
        )
    return rows


def map_sleep(entry: dict[str, Any]) -> dict[str, Any] | None:
    day = entry.get("calendarDate")
    if not day:
        return None
    v = entry.get("values") or {}
    return {
        "day": day,
        "sleep_total_s": _int(v.get("totalSleepTimeInSeconds")),
        "sleep_deep_s": _int(v.get("deepTime")),
        "sleep_light_s": _int(v.get("lightTime")),
        "sleep_rem_s": _int(v.get("remTime")),
        "sleep_awake_s": _int(v.get("awakeTime")),
        "sleep_score": _int(v.get("overallScore") or v.get("sleepScoreValue")),
        "resting_hr": _int(v.get("restingHeartRate")),
        "raw": entry,
    }


def map_hrv(entry: dict[str, Any]) -> dict[str, Any] | None:
    day = entry.get("calendarDate")
    if not day:
        return None
    baseline = entry.get("baseline") or {}
    return {
        "day": day,
        "hrv_last_night_avg": _int(entry.get("lastNightAvg")),
        "hrv_status": entry.get("status"),
        "hrv_baseline_low": _int(baseline.get("balancedLow")),
        "hrv_baseline_high": _int(baseline.get("balancedUpper")),
    }


def map_readiness(entry: dict[str, Any]) -> dict[str, Any] | None:
    day = entry.get("calendarDate")
    if not day:
        return None
    return {
        "day": day,
        "training_readiness_score": _int(entry.get("score")),
        "training_readiness_level": entry.get("level"),
        # De Training Readiness-response bevat de Slaapscore van de nacht die
        # Garmin zelf voor deze dag gebruikt.
        "sleep_score": _int(entry.get("sleepScore")),
    }


def map_daily_summary(entry: dict[str, Any]) -> dict[str, Any] | None:
    """Garmin Daily Summary -> bestaande dagelijkse gezondheidskolommen."""
    day = entry.get("calendarDate")
    if not day:
        return None

    def measured(key: str) -> int | None:
        value = _int(entry.get(key))
        return value if value is not None and value >= 0 else None

    return {
        "day": day,
        "steps": measured("totalSteps"),
        "resting_hr": measured("restingHeartRate"),
        "avg_stress": measured("averageStressLevel"),
        "body_battery_high": measured("bodyBatteryHighestValue"),
        "body_battery_low": measured("bodyBatteryLowestValue"),
    }


def map_sleep_detail(
    day: str, entry: dict[str, Any], existing_raw: dict[str, Any] | None
) -> dict[str, Any] | None:
    """Bewaar de exacte Garmin-slaapfasen compact in de bestaande raw JSONB.

    Garmin codeert de fasen als 0 diep, 1 licht, 2 REM en 3 wakker. Alleen
    geldige segmenten met een start- en eindtijd gaan mee naar de webapp.
    """
    levels = []
    for segment in entry.get("sleepLevels") or []:
        start = segment.get("startGMT")
        end = segment.get("endGMT")
        level = _int(segment.get("activityLevel"))
        if start and end and level in {0, 1, 2, 3}:
            levels.append({"start_gmt": start, "end_gmt": end, "level": level})

    if not levels:
        return None

    daily = entry.get("dailySleepDTO") or {}
    old_raw = existing_raw or {}
    # Een volgende sync mag de wrapper niet telkens opnieuw nesten.
    daily_summary = old_raw.get("daily_summary", old_raw)
    if "sleep_detail" in daily_summary:
        daily_summary = {}

    return {
        "day": day,
        "raw": {
            "daily_summary": daily_summary,
            "sleep_detail": {
                "start_local_ms": _int(daily.get("sleepStartTimestampLocal")),
                "end_local_ms": _int(daily.get("sleepEndTimestampLocal")),
                "levels": levels,
            },
        },
    }


def map_vo2max(entry: dict[str, Any]) -> dict[str, Any] | None:
    generic = entry.get("generic") or {}
    day = generic.get("calendarDate")
    if not day:
        return None
    return {
        "day": day,
        "vo2max_running": _num(
            generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        ),
        "raw": entry,
    }
