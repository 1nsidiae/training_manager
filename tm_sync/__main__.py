"""CLI voor de sync-worker.

    uv run -m tm_sync backfill              # volledige historie
    uv run -m tm_sync recent                # laatste 14 dagen
    uv run -m tm_sync backfill --no-fit     # zonder FIT-archief (sneller)
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, timedelta

from . import activities as activities_mod
from . import features as features_mod
from . import profile as profile_mod
from . import wellness as wellness_mod
from .clients import garmin_client, supabase_client
from .config import load_settings

FIRST_DATA_DAY = "2025-03-01"


def _log_sync(sb, sync_type: str, start: str, end: str) -> int:
    res = (
        sb.table("sync_log")
        .insert(
            {
                "sync_type": sync_type,
                "window_start": start,
                "window_end": end,
                "status": "running",
            }
        )
        .execute()
    )
    return res.data[0]["id"]


def _finish_sync(sb, log_id: int, status: str, items: int, error: str | None) -> None:
    sb.table("sync_log").update(
        {
            "finished_at": "now()",
            "status": status,
            "items_synced": items,
            "error": error,
        }
    ).eq("id", log_id).execute()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tm_sync")
    parser.add_argument("command", choices=["backfill", "recent", "features"])
    parser.add_argument("--from", dest="start", help="startdatum YYYY-MM-DD")
    parser.add_argument("--to", dest="end", help="einddatum YYYY-MM-DD")
    parser.add_argument("--no-fit", action="store_true", help="sla FIT-archief over")
    parser.add_argument("--no-tracks", action="store_true", help="sla routes over")
    parser.add_argument("--no-laps", action="store_true", help="sla splits over")
    parser.add_argument(
        "--only",
        choices=["profile", "activities", "wellness", "fitness"],
        action="append",
        help="alleen dit onderdeel draaien (herhaalbaar)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="FIT-archief en routes opnieuw ophalen, ook als ze al bestaan",
    )
    args = parser.parse_args(argv)
    parts = set(args.only or ["profile", "activities", "wellness", "fitness"])

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("tm_sync")

    today = date.today().isoformat()
    if args.command == "backfill":
        start = args.start or FIRST_DATA_DAY
    else:
        start = args.start or (date.today() - timedelta(days=14)).isoformat()
    end = args.end or today

    settings = load_settings()
    sb = supabase_client(settings)

    # De feature-laag rekent alleen op wat al in de database staat en heeft
    # geen Garmin-verbinding nodig.
    if args.command == "features":
        log_id = _log_sync(sb, "features", start, end)
        try:
            total = features_mod.compute_all(sb)
        except Exception as exc:  # noqa: BLE001
            log.exception("Feature-berekening afgebroken")
            _finish_sync(sb, log_id, "error", 0, f"{type(exc).__name__}: {exc}")
            return 1
        _finish_sync(sb, log_id, "ok", total, None)
        log.info("Klaar. %d records verwerkt.", total)
        return 0

    log.info("Verbinden met Garmin...")
    try:
        garmin = garmin_client(settings)
    except Exception as exc:  # noqa: BLE001
        log.error("Garmin-login mislukt: %s: %s", type(exc).__name__, exc)
        log.error("Draai scripts/garmin_login.py opnieuw om tokens te vernieuwen.")
        return 1

    log.info("Sync %s: %s .. %s", args.command, start, end)
    log_id = _log_sync(sb, args.command, start, end)
    total = 0

    try:
        if "profile" in parts:
            total += profile_mod.sync_profile(garmin, sb, settings)
        if "activities" in parts:
            total += activities_mod.sync_activities(
                garmin,
                sb,
                settings,
                start,
                end,
                with_fit=not args.no_fit,
                with_tracks=not args.no_tracks,
                with_laps=not args.no_laps,
                force=args.force,
            )
        if "wellness" in parts:
            total += wellness_mod.sync_wellness(garmin, sb, settings, start, end)
        if "fitness" in parts:
            total += wellness_mod.sync_fitness(garmin, sb, settings, start, end)
    except Exception as exc:  # noqa: BLE001
        log.exception("Sync afgebroken")
        _finish_sync(sb, log_id, "error", total, f"{type(exc).__name__}: {exc}")
        return 1

    _finish_sync(sb, log_id, "ok", total, None)
    log.info("Klaar. %d records verwerkt.", total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
