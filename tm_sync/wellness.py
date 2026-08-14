"""Dagelijkse wellness- en fitheidsdata.

Alle bronnen worden per dag samengevoegd voordat er geschreven wordt: anders
overschrijft de ene bron de velden van de andere met NULL.
"""

from __future__ import annotations

import logging
from collections.abc import Iterator
from datetime import date, timedelta
from typing import Any

from garminconnect import Garmin
from supabase import Client

from . import mappers
from .clients import Throttle, safe_call
from .config import Settings

log = logging.getLogger(__name__)

CHUNK_DAYS = 28


def _chunks(start: str, end: str) -> Iterator[tuple[str, str]]:
    cur = date.fromisoformat(start)
    stop = date.fromisoformat(end)
    while cur <= stop:
        chunk_end = min(cur + timedelta(days=CHUNK_DAYS - 1), stop)
        yield cur.isoformat(), chunk_end.isoformat()
        cur = chunk_end + timedelta(days=1)


def _normalize(
    rows: list[dict[str, Any]], defaults: dict[str, Any]
) -> list[dict[str, Any]]:
    """Maak alle rijen even breed voor de bulk-upsert.

    PostgREST bouwt bij een lijst van dicts een kolomlijst uit de unie van alle
    keys. Een rij die een key mist krijgt dan een expliciete NULL in plaats van
    de kolom-default — dat sloopt NOT NULL-kolommen als `raw`. Daarom vullen we
    de rijen hier expliciet aan.
    """
    keys: set[str] = set(defaults)
    for row in rows:
        keys.update(row)

    out = []
    for row in rows:
        filled = {key: row.get(key) for key in keys}
        for key, default in defaults.items():
            if filled.get(key) is None:
                filled[key] = default
        out.append(filled)
    return out


def _merge(target: dict[str, dict[str, Any]], row: dict[str, Any] | None) -> None:
    if not row:
        return
    day = row.pop("day")
    slot = target.setdefault(day, {"day": day})
    for key, value in row.items():
        if value is not None:
            slot[key] = value


def _preserve_sleep_detail(
    current_raw: dict[str, Any] | None,
    existing_raw: dict[str, Any] | None,
) -> dict[str, Any]:
    """Laat een tijdelijke onvolledige Garmin-respons geen tijdlijn wissen.

    `get_sleep_daily` bevat de fasetotalen, maar niet altijd de exacte
    segmenten. Wanneer `get_sleep_data` tijdens een latere sync tijdelijk geen
    `sleepLevels` teruggeeft, moet de eerder opgeslagen tijdlijn behouden
    blijven. Een nieuw opgehaalde tijdlijn in ``current_raw`` wint altijd.
    """
    current = current_raw if isinstance(current_raw, dict) else {}
    existing = existing_raw if isinstance(existing_raw, dict) else {}

    if isinstance(current.get("sleep_detail"), dict):
        return current

    detail = existing.get("sleep_detail")
    if not isinstance(detail, dict) or not detail.get("levels"):
        return current

    if "daily_summary" in current:
        return {**current, "sleep_detail": detail}
    return {"daily_summary": current, "sleep_detail": detail}


def _preserve_wellness_details(
    current_raw: dict[str, Any] | None,
    existing_raw: dict[str, Any] | None,
) -> dict[str, Any]:
    """Behoud eerder opgehaalde slaap- en stappentijdlijnen bij API-gaten."""
    current = current_raw if isinstance(current_raw, dict) else {}
    existing = existing_raw if isinstance(existing_raw, dict) else {}
    result = current

    for key, content_key in (
        ("sleep_detail", "levels"),
        ("steps_detail", "buckets"),
        ("intraday_detail", None),
    ):
        current_detail = result.get(key) if isinstance(result, dict) else None
        if isinstance(current_detail, dict) and (
            content_key is None or current_detail.get(content_key)
        ):
            continue

        existing_detail = existing.get(key)
        if not isinstance(existing_detail, dict) or (
            content_key is not None and not existing_detail.get(content_key)
        ):
            continue

        if "daily_summary" in result:
            result = {**result, key: existing_detail}
        else:
            result = {"daily_summary": result, key: existing_detail}

    return result


def sync_wellness(
    garmin: Garmin, sb: Client, settings: Settings, start: str, end: str
) -> int:
    throttle = Throttle(settings.throttle_s)
    days: dict[str, dict[str, Any]] = {}
    stored = (
        sb.table("wellness_daily")
        .select("day,raw")
        .gte("day", start)
        .lte("day", end)
        .execute()
        .data
        or []
    )
    existing_raw = {
        row["day"]: row.get("raw")
        for row in stored
        if row.get("day") and isinstance(row.get("raw"), dict)
    }

    for chunk_start, chunk_end in _chunks(start, end):
        log.info("wellness %s .. %s", chunk_start, chunk_end)

        throttle.wait()
        for entry in (
            safe_call("get_sleep_daily", garmin.get_sleep_daily, chunk_start, chunk_end)
            or []
        ):
            _merge(days, mappers.map_sleep(entry))

        throttle.wait()
        hrv = safe_call(
            "get_hrv_data_range", garmin.get_hrv_data_range, chunk_start, chunk_end
        )
        for entry in (hrv or {}).get("hrvSummaries") or []:
            _merge(days, mappers.map_hrv(entry))

        throttle.wait()
        for entry in (
            safe_call("get_rhr_daily", garmin.get_rhr_daily, chunk_start, chunk_end)
            or []
        ):
            if entry.get("calendarDate") and entry.get("value") is not None:
                _merge(
                    days,
                    {
                        "day": entry["calendarDate"],
                        "resting_hr": int(round(float(entry["value"]))),
                    },
                )

        throttle.wait()
        for entry in (
            safe_call("get_daily_steps", garmin.get_daily_steps, chunk_start, chunk_end)
            or []
        ):
            day = entry.get("calendarDate")
            steps = entry.get("totalSteps") or entry.get("steps")
            if day and steps is not None:
                _merge(days, {"day": day, "steps": int(steps)})

    # Training readiness bestaat alleen per dag. Enkel opvragen voor dagen waarop
    # het horloge gedragen is (slaapdata aanwezig) — scheelt honderden calls.
    worn = [d for d, row in days.items() if row.get("sleep_total_s")]
    log.info("readiness ophalen voor %d dagen met draagtijd", len(worn))
    for day in sorted(worn):
        throttle.wait()
        sleep_detail = safe_call(f"get_sleep_data({day})", garmin.get_sleep_data, day)
        _merge(
            days,
            mappers.map_sleep_detail(
                day,
                sleep_detail or {},
                days.get(day, {}).get("raw"),
            ),
        )

        throttle.wait()
        entries = safe_call(
            f"get_training_readiness({day})", garmin.get_training_readiness, day
        )
        # Garmin herberekent Training Readiness meerdere keren per dag en geeft
        # alle metingen terug, niet alleen de laatste — en niet op volgorde.
        # `_merge` laat de laatste die hij ziet winnen, dus zonder sorteren won
        # geregeld een meting van de avond ervoor en bleef de score hangen
        # terwijl stappen en hartslag wél meebewogen.
        for entry in sorted(entries or [], key=mappers.readiness_moment):
            _merge(days, mappers.map_readiness(entry))

        # De Garmin Daily Summary levert de officiële dagelijkse waarden voor
        # stappen, stress en Body Battery. Ze delen dezelfde kalenderdag als
        # Training Readiness en kunnen dus veilig in dezelfde dagrij landen.
        throttle.wait()
        summary = safe_call(f"get_stats({day})", garmin.get_stats, day)
        _merge(days, mappers.map_daily_summary(summary or {}))

    # De dagtotalen hierboven zijn voldoende voor 7d/4w/1j. Voor de 1d-tab
    # halen we Garmins echte kwartierblokken op en bewaren we ze compact.
    intraday_start = (date.fromisoformat(end) - timedelta(days=13)).isoformat()
    step_days = [
        d
        for d, row in days.items()
        if d >= intraday_start and row.get("steps") is not None
    ]
    log.info("intraday-stappen ophalen voor %d dagen", len(step_days))
    for day in sorted(step_days):
        throttle.wait()
        entries = safe_call(f"get_steps_data({day})", garmin.get_steps_data, day)
        _merge(
            days,
            mappers.map_steps_detail(
                day,
                entries or [],
                days.get(day, {}).get("raw"),
            ),
        )

        throttle.wait()
        stress = safe_call(f"get_stress_data({day})", garmin.get_stress_data, day)
        throttle.wait()
        heart_rate = safe_call(f"get_heart_rates({day})", garmin.get_heart_rates, day)
        _merge(
            days,
            mappers.map_intraday_detail(
                day,
                stress or {},
                heart_rate or {},
                days.get(day, {}).get("raw"),
            ),
        )

    for day, row in days.items():
        row["raw"] = _preserve_wellness_details(row.get("raw"), existing_raw.get(day))

    rows = _normalize(list(days.values()), {"raw": {}})
    for i in range(0, len(rows), 100):
        sb.table("wellness_daily").upsert(rows[i : i + 100], on_conflict="day").execute()

    return len(rows)


def sync_fitness(
    garmin: Garmin, sb: Client, settings: Settings, start: str, end: str
) -> int:
    throttle = Throttle(settings.throttle_s)
    days: dict[str, dict[str, Any]] = {}

    for chunk_start, chunk_end in _chunks(start, end):
        throttle.wait()
        for entry in (
            safe_call(
                "get_max_metrics_range",
                garmin.get_max_metrics_range,
                chunk_start,
                chunk_end,
            )
            or []
        ):
            _merge(days, mappers.map_vo2max(entry))

        throttle.wait()
        endurance = safe_call(
            "get_endurance_score", garmin.get_endurance_score, chunk_start, chunk_end
        )
        for day, payload in ((endurance or {}).get("enduranceScoreDTO") or {}).items():
            if isinstance(payload, dict) and payload.get("overallScore") is not None:
                _merge(days, {"day": day, "endurance_score": payload["overallScore"]})

    # Race predictions: huidige stand, geen historie nodig voor de coach.
    throttle.wait()
    preds = safe_call("get_race_predictions", garmin.get_race_predictions)
    if preds and preds.get("calendarDate"):
        _merge(
            days,
            {
                "day": preds["calendarDate"],
                "race_predictions": {
                    "5k": preds.get("time5K"),
                    "10k": preds.get("time10K"),
                    "half": preds.get("timeHalfMarathon"),
                    "marathon": preds.get("timeMarathon"),
                },
            },
        )

    rows = _normalize(list(days.values()), {"raw": {}})
    for i in range(0, len(rows), 100):
        sb.table("fitness_snapshots").upsert(
            rows[i : i + 100], on_conflict="day"
        ).execute()

    return len(rows)
