"""Atleetprofiel synchroniseren: HR-zones, drempels, toestel.

De zonegrenzen komen uit de meest recente run, niet uit de profielinstelling.
Reden: de zonetijden die we opslaan (`hrTimeInZone_1..5`) zijn door Garmin
berekend met de grenzen die op dat moment voor hardlopen golden, en die wijken
af van het DEFAULT-sportprofiel. Grenzen uit een andere bron zouden niet matchen
met de tijden die we al hebben.
"""

from __future__ import annotations

import logging
from typing import Any

from garminconnect import Garmin
from supabase import Client

from .clients import Throttle, safe_call
from .config import Settings

log = logging.getLogger(__name__)


def _zones_from_activity(
    garmin: Garmin, throttle: Throttle, garmin_activity_id: int, max_hr: int | None
) -> list[dict[str, Any]] | None:
    throttle.wait()
    zones = safe_call(
        "get_activity_hr_in_timezones",
        garmin.get_activity_hr_in_timezones,
        str(garmin_activity_id),
    )
    if not zones:
        return None

    floors = sorted(
        (int(z["zoneNumber"]), int(z["zoneLowBoundary"]))
        for z in zones
        if z.get("zoneLowBoundary") is not None
    )
    if not floors:
        return None

    out = []
    for i, (zone, low) in enumerate(floors):
        high = floors[i + 1][1] - 1 if i + 1 < len(floors) else (max_hr or low + 30)
        out.append({"zone": zone, "low": low, "high": high})
    return out


def sync_profile(garmin: Garmin, sb: Client, settings: Settings) -> int:
    throttle = Throttle(settings.throttle_s)

    throttle.wait()
    hr_config = safe_call("get_heart_rate_zones", garmin.get_heart_rate_zones) or []
    default_cfg = next(
        (c for c in hr_config if c.get("sport") in ("RUNNING", "DEFAULT")), None
    )

    max_hr = default_cfg.get("maxHeartRateUsed") if default_cfg else None
    resting_hr = default_cfg.get("restingHeartRateUsed") if default_cfg else None
    lthr = default_cfg.get("lactateThresholdHeartRateUsed") if default_cfg else None

    throttle.wait()
    device = safe_call("get_device_last_used", garmin.get_device_last_used) or {}

    throttle.wait()
    name = safe_call("get_full_name", garmin.get_full_name)

    # Meest recente run als bron voor de effectieve zonegrenzen.
    latest = (
        sb.table("activities")
        .select("garmin_activity_id")
        .eq("sport", "running")
        .order("start_time", desc=True)
        .limit(1)
        .execute()
        .data
    )
    zones = None
    if latest:
        zones = _zones_from_activity(
            garmin, throttle, int(latest[0]["garmin_activity_id"]), max_hr
        )

    row = {
        "display_name": name,
        "max_hr": max_hr,
        "resting_hr": resting_hr,
        "lactate_threshold_hr": lthr,
        "garmin_device_id": device.get("userDeviceId"),
        "hr_zones": zones or [],
        "hr_zones_source": "activity" if zones else "garmin",
        "hr_zones_updated_at": "now()",
        "locale": "nl",
    }

    existing = sb.table("athlete_profile").select("id").limit(1).execute().data
    if existing:
        sb.table("athlete_profile").update(row).eq("id", existing[0]["id"]).execute()
    else:
        sb.table("athlete_profile").insert(row).execute()

    log.info(
        "profiel: maxHR %s, rustHR %s, LTHR %s, %d zones (bron: %s)",
        max_hr,
        resting_hr,
        lthr,
        len(zones or []),
        row["hr_zones_source"],
    )
    return 1
