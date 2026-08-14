"""Uitlegbare multi-sport belasting voor Garmin-activiteiten.

Garmin Training Load blijft de voorkeursbron. Ontbreekt die, dan gebruiken we
eerst hartslagzones en pas als laatste een expliciet gemarkeerde duurschatting.
Hardloopkilometers worden hier nooit met andere sporten vermengd.
"""

from __future__ import annotations

import json
import statistics
from collections import Counter
from datetime import date, timedelta
from pathlib import Path
from typing import Any

MODEL = json.loads(Path(__file__).with_name("training_load_model.json").read_text())
ZONE_WEIGHTS = tuple(float(value) for value in MODEL["zone_weights"])
MINIMUM_CHRONIC_LOAD = float(MODEL["minimum_chronic_load"])

SPORT_ALIASES = {
    "running": ("run", "jog", "trail", "treadmill"),
    "cycling": ("cycl", "bike", "biking", "bmx", "mountain_bik"),
    "swimming": ("swim",),
    "walking": ("walk",),
    "hiking": ("hik", "trek"),
    "strength": ("strength", "weight", "gym", "resistance", "functional"),
    "racquet": ("padel", "tennis", "squash", "badminton", "pickleball", "racquet"),
    "team_sport": ("football", "soccer", "basketball", "volleyball", "hockey", "rugby"),
    "rowing": ("row", "kayak", "canoe", "paddle"),
    "winter_sport": ("ski", "snowboard", "skate"),
    "yoga": ("yoga", "pilates", "mobility", "breathwork"),
}


def canonical_sport(sport: str | None, sub_sport: str | None = None, name: str | None = None) -> str:
    haystack = "_".join(str(value or "").lower().replace(" ", "_") for value in (sport, sub_sport, name))
    # Hiking moet voor walking worden gecontroleerd omdat Garmin soms beide
    # termen in hetzelfde subtype stopt.
    order = ("hiking", "running", "cycling", "swimming", "walking", "strength", "racquet", "team_sport", "rowing", "winter_sport", "yoga")
    for canonical in order:
        if any(alias in haystack for alias in SPORT_ALIASES[canonical]):
            return canonical
    return "other"


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None


def estimate_activity_load(activity: dict[str, Any], zones: dict[int, float] | list[float] | tuple[float, ...] | None = None) -> dict[str, Any]:
    canonical = canonical_sport(activity.get("sport"), activity.get("sub_sport"), activity.get("name"))
    profile = MODEL["sports"][canonical]
    raw = activity.get("raw") or {}
    garmin = _number(raw.get("activityTrainingLoad"))

    zone_values: list[float] = [0.0] * 5
    if isinstance(zones, dict):
        for zone, seconds in zones.items():
            if 1 <= int(zone) <= 5:
                zone_values[int(zone) - 1] = _number(seconds) or 0.0
    elif zones:
        for index, seconds in enumerate(zones[:5]):
            zone_values[index] = _number(seconds) or 0.0
    zone_load = sum((seconds / 60.0) * ZONE_WEIGHTS[index] for index, seconds in enumerate(zone_values))

    duration_s = _number(activity.get("duration_s")) or 0.0
    if garmin and garmin > 0:
        load, source, confidence = garmin, "garmin", "high"
    elif zone_load > 0:
        load, source, confidence = zone_load, "heart_rate", "medium"
    elif duration_s > 0:
        load = duration_s / 60.0 * float(profile["load_per_minute"])
        source, confidence = "duration", "low"
    else:
        load, source, confidence = 0.0, "missing", "missing"

    return {
        "sport": str(activity.get("sport") or "other"),
        "canonical_sport": canonical,
        "load": round(load, 1),
        "aerobic_load": round(load * float(profile["aerobic_factor"]), 1),
        "mechanical_load": round(load * float(profile["mechanical_factor"]), 1),
        "source": source,
        "confidence": confidence,
        "estimated": source == "duration",
    }


def build_load_summary(activities: list[dict[str, Any]], zones_by_activity: dict[int, Any], end_day: date) -> dict[str, Any]:
    start_day = end_day - timedelta(days=27)
    current_start = end_day - timedelta(days=6)
    recent_start = end_day - timedelta(days=1)
    days = {
        (start_day + timedelta(days=index)).isoformat(): {
            "day": (start_day + timedelta(days=index)).isoformat(),
            "load": 0.0,
            "aerobic_load": 0.0,
            "mechanical_load": 0.0,
        }
        for index in range(28)
    }
    sports: dict[str, dict[str, Any]] = {}
    sources: Counter[str] = Counter()
    recent_cross = {"load": 0.0, "aerobic_load": 0.0, "mechanical_load": 0.0}

    for activity in activities:
        day = str(activity.get("start_time_local") or "")[:10]
        if day not in days:
            continue
        estimate = estimate_activity_load(activity, zones_by_activity.get(int(activity.get("id") or 0)))
        point = days[day]
        for key in ("load", "aerobic_load", "mechanical_load"):
            point[key] += estimate[key]
        sources[estimate["source"]] += 1

        if day >= current_start.isoformat():
            key = estimate["canonical_sport"]
            slot = sports.setdefault(key, {
                "sport": key,
                "load": 0.0,
                "aerobic_load": 0.0,
                "mechanical_load": 0.0,
                "duration_s": 0,
                "sessions": 0,
                "estimated_sessions": 0,
            })
            for field in ("load", "aerobic_load", "mechanical_load"):
                slot[field] += estimate[field]
            slot["duration_s"] += round(_number(activity.get("duration_s")) or 0)
            slot["sessions"] += 1
            slot["estimated_sessions"] += int(estimate["estimated"])

        if day >= recent_start.isoformat() and estimate["canonical_sport"] != "running":
            for field in recent_cross:
                recent_cross[field] += estimate[field]

    day_rows = list(days.values())
    for point in day_rows:
        for key in ("load", "aerobic_load", "mechanical_load"):
            point[key] = round(point[key], 1)
    current = sum(point["load"] for point in day_rows[-7:])
    previous = sum(point["load"] for point in day_rows[-14:-7])
    chronic = sum(point["load"] for point in day_rows) / 4.0
    ratio = current / chronic if chronic >= MINIMUM_CHRONIC_LOAD else None
    current_daily = [point["load"] for point in day_rows[-7:]]
    spread = statistics.pstdev(current_daily)
    monotony = statistics.fmean(current_daily) / spread if spread > 0 and any(current_daily) else None
    baseline_day = max(chronic / 7.0, 20.0)
    if recent_cross["load"] >= baseline_day * 2 or recent_cross["mechanical_load"] >= baseline_day:
        heavy_run_impact = "protect"
    elif recent_cross["load"] >= baseline_day or recent_cross["mechanical_load"] >= baseline_day * 0.5:
        heavy_run_impact = "watch"
    else:
        heavy_run_impact = "clear"

    measured = sources["garmin"] + sources["heart_rate"]
    estimated = sources["duration"]
    usable = measured + estimated
    if usable == 0:
        data_quality = "missing"
    elif estimated == 0:
        data_quality = "measured"
    elif measured > 0:
        data_quality = "mixed"
    else:
        data_quality = "estimated"

    return {
        "current_load": round(current, 1),
        "previous_load": round(previous, 1),
        "chronic_load": round(chronic, 1),
        "acwr": round(ratio, 2) if ratio is not None else None,
        "monotony": round(monotony, 2) if monotony is not None else None,
        "strain": round(current * monotony, 1) if monotony is not None else None,
        "days": day_rows,
        "sports": sorted(({
            **slot,
            "load": round(slot["load"], 1),
            "aerobic_load": round(slot["aerobic_load"], 1),
            "mechanical_load": round(slot["mechanical_load"], 1),
        } for slot in sports.values()), key=lambda item: item["load"], reverse=True),
        "recent_cross_load": {key: round(value, 1) for key, value in recent_cross.items()},
        "heavy_run_impact": heavy_run_impact,
        "data_quality": data_quality,
        "sources": dict(sources),
    }
