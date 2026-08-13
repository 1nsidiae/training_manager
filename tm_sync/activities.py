"""Activiteiten synchroniseren: header, zonetijd, splits, FIT-archief, route."""

from __future__ import annotations

import logging
from typing import Any

from garminconnect import Garmin
from supabase import Client

from . import compliance, mappers, polyline
from .clients import Throttle, safe_call
from .config import Settings

log = logging.getLogger(__name__)


def _upsert_activity(sb: Client, row: dict[str, Any]) -> int:
    res = (
        sb.table("activities")
        .upsert(row, on_conflict="garmin_activity_id")
        .execute()
    )
    return res.data[0]["id"]


def _relative_delta(actual: Any, planned: Any) -> float:
    """Vergelijk targets zonder lange en korte sessies ongelijk te behandelen."""
    if actual is None or planned is None:
        return 1.0
    actual_n = float(actual)
    planned_n = float(planned)
    return abs(actual_n - planned_n) / max(actual_n, planned_n, 1.0)


SESSION_MATCH_COLUMNS = (
    "id, planned_distance_m, planned_duration_s, session_type, "
    "hr_cap, structure, targets"
)


def _store_compliance(
    sb: Client,
    session: dict[str, Any],
    activity_id: int,
    activity: dict[str, Any],
) -> None:
    targets = dict(session.get("targets") or {})
    targets["compliance"] = compliance.evaluate_session(session, activity)
    sb.table("plan_sessions").update(
        {"activity_id": activity_id, "status": "completed", "targets": targets}
    ).eq("id", session["id"]).execute()


def _match_plan_session(sb: Client, activity_id: int, activity: dict[str, Any]) -> None:
    """Koppel een activiteit deterministisch aan de geplande sessie van die dag.

    Alleen zelfde dag + zelfde sport komt in aanmerking. Als er uitzonderlijk
    meerdere kandidaten zijn, wint de beste afstands- of duurmatch. Een rustdag
    wordt nooit door een toevallige activiteit als voltooid gemarkeerd.
    """
    local_start = activity.get("start_time_local")
    sport = activity.get("sport")
    if not local_start or not sport:
        return

    already_linked = (
        sb.table("plan_sessions")
        .select(SESSION_MATCH_COLUMNS)
        .eq("activity_id", activity_id)
        .limit(1)
        .execute()
        .data
    )
    if already_linked:
        _store_compliance(sb, already_linked[0], activity_id, activity)
        return

    candidates = (
        sb.table("plan_sessions")
        .select(SESSION_MATCH_COLUMNS)
        .eq("day", str(local_start)[:10])
        .eq("sport", sport)
        .in_("status", ["planned", "moved"])
        .is_("activity_id", "null")
        .neq("session_type", "rest")
        .execute()
        .data
    )
    if not candidates:
        return

    def score(session: dict[str, Any]) -> float:
        return min(
            _relative_delta(activity.get("distance_m"), session.get("planned_distance_m")),
            _relative_delta(activity.get("duration_s"), session.get("planned_duration_s")),
        )

    matched = min(candidates, key=score)
    _store_compliance(sb, matched, activity_id, activity)
    log.info("activiteit %s gekoppeld aan plansessie %s", activity_id, matched["id"])


def _archive_fit(
    garmin: Garmin,
    sb: Client,
    settings: Settings,
    throttle: Throttle,
    garmin_activity_id: int,
) -> str | None:
    """Download het originele bestand en zet het in Storage.

    Dit is de verzekering tegen het wegvallen van de unofficiele API: het bevat
    per seconde hartslag, GPS, cadans en power.
    """
    throttle.wait()
    blob = safe_call(
        f"download_activity({garmin_activity_id})",
        garmin.download_activity,
        str(garmin_activity_id),
        dl_fmt=Garmin.ActivityDownloadFormat.ORIGINAL,
    )
    if not blob:
        return None

    path = f"{garmin_activity_id}.zip"
    try:
        sb.storage.from_(settings.fit_bucket).upload(
            path,
            blob,
            {"content-type": "application/zip", "upsert": "true"},
        )
    except Exception as exc:  # noqa: BLE001
        log.warning("FIT-upload %s faalde: %s: %s", path, type(exc).__name__, exc)
        return None
    return path


def _store_track(
    garmin: Garmin,
    sb: Client,
    throttle: Throttle,
    activity_id: int,
    garmin_activity_id: int,
) -> bool:
    throttle.wait()
    details = safe_call(
        f"get_activity_details({garmin_activity_id})",
        garmin.get_activity_details,
        str(garmin_activity_id),
        maxchart=1,
        maxpoly=4000,
    )
    if not details:
        return False

    geo = details.get("geoPolylineDTO") or {}
    points = [
        (p["lat"], p["lon"])
        for p in (geo.get("polyline") or [])
        if p.get("lat") is not None and p.get("lon") is not None
    ]
    if not points:
        return False

    sb.table("activity_tracks").upsert(
        {
            "activity_id": activity_id,
            "polyline": polyline.encode(points),
            "point_count": len(points),
            "bounds": {
                "north": geo.get("maxLat"),
                "south": geo.get("minLat"),
                "east": geo.get("maxLon"),
                "west": geo.get("minLon"),
            },
            "distance_m": geo.get("distanceMeter"),
            "source": "details",
        },
        on_conflict="activity_id",
    ).execute()
    return True


def _already_done(sb: Client) -> tuple[set[int], set[int]]:
    """Welke activiteiten hebben al een FIT-archief en een route?

    Zonder deze check download een her-sync elke keer opnieuw 83 FIT-bestanden.
    """
    archived = {
        int(r["garmin_activity_id"])
        for r in sb.table("activities")
        .select("garmin_activity_id")
        .not_.is_("fit_path", "null")
        .execute()
        .data
    }
    tracked = {
        int(r["garmin_activity_id"])
        for r in sb.table("activities")
        .select("garmin_activity_id, activity_tracks!inner(activity_id)")
        .execute()
        .data
    }
    return archived, tracked


def sync_activities(
    garmin: Garmin,
    sb: Client,
    settings: Settings,
    start: str,
    end: str,
    *,
    with_fit: bool = True,
    with_tracks: bool = True,
    with_laps: bool = True,
    force: bool = False,
) -> int:
    throttle = Throttle(settings.throttle_s)
    archived, tracked = (set(), set()) if force else _already_done(sb)
    if archived or tracked:
        log.info(
            "overslaan waar al aanwezig: %d FIT-archieven, %d routes",
            len(archived),
            len(tracked),
        )

    throttle.wait()
    activities = (
        safe_call(
            "get_activities_by_date",
            garmin.get_activities_by_date,
            start,
            end,
            sortorder="asc",
        )
        or []
    )
    log.info("%d activiteiten gevonden tussen %s en %s", len(activities), start, end)

    synced = 0
    for i, a in enumerate(activities, 1):
        gid = int(a["activityId"])
        name = a.get("activityName") or "?"
        log.info("[%d/%d] %s | %s", i, len(activities), a.get("startTimeLocal"), name)

        activity_row = mappers.map_activity(a)
        activity_id = _upsert_activity(sb, activity_row)
        try:
            _match_plan_session(sb, activity_id, activity_row)
        except Exception as exc:  # noqa: BLE001
            # Een koppelprobleem mag de Garmin-sync niet blokkeren. De PWA stelt
            # dezelfde match opnieuw voor wanneer de gebruiker feedback invult.
            log.warning(
                "plansessie koppelen voor activiteit %s faalde: %s: %s",
                activity_id,
                type(exc).__name__,
                exc,
            )

        zones = mappers.map_zones(activity_id, a)
        if zones:
            sb.table("activity_zones").upsert(
                zones, on_conflict="activity_id,zone_number"
            ).execute()

        if with_laps and a.get("hasSplits"):
            throttle.wait()
            splits = safe_call(
                f"get_activity_splits({gid})", garmin.get_activity_splits, str(gid)
            )
            laps = mappers.map_laps(activity_id, splits)
            if laps:
                sb.table("activity_laps").upsert(
                    laps, on_conflict="activity_id,lap_index"
                ).execute()

        if with_tracks and a.get("hasPolyline") and gid not in tracked:
            _store_track(garmin, sb, throttle, activity_id, gid)

        if with_fit and gid not in archived:
            path = _archive_fit(garmin, sb, settings, throttle, gid)
            if path:
                sb.table("activities").update(
                    {"fit_path": path, "fit_archived_at": "now()"}
                ).eq("id", activity_id).execute()

        synced += 1

    return synced
