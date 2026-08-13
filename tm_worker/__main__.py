"""CLI voor de worker.

    uv run -m tm_worker once              # één tick, geschikt voor cron
    uv run -m tm_worker once --no-coach   # alleen sync en detectie, niets kost geld
    uv run -m tm_worker serve             # blijft draaien met adaptief interval
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime

from tm_sync.clients import supabase_client
from tm_sync.config import load_settings

from .heartbeat import beat
from .loop import next_interval_minutes, pending_request, tick

# Hoe vaak we tijdens het wachten kijken of er in de app op de syncknop is
# gedrukt. Eén geïndexeerde query; goedkoop genoeg om een knop die vijftien
# seconden aanvoelt als "meteen" mogelijk te maken.
POLL_SECONDS = 15


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tm_worker")
    parser.add_argument("command", choices=["once", "serve"])
    parser.add_argument(
        "--no-sync",
        action="store_true",
        help="sla de geplande Garmin-sync over (een druk op de knop in de app telt wel)",
    )
    parser.add_argument(
        "--no-coach",
        action="store_true",
        help="detecteer triggers maar roep de coach niet aan (kost niets)",
    )
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("tm_worker")

    settings = load_settings()
    sb = supabase_client(settings)

    if args.command == "once":
        result = tick(sb, settings, with_sync=not args.no_sync, with_coach=not args.no_coach)
        log.info("klaar: %s", json.dumps(result, ensure_ascii=False, default=str))
        return 0

    log.info("worker gestart; adaptief interval")
    beat()
    while True:
        try:
            tick(sb, settings, with_sync=not args.no_sync, with_coach=not args.no_coach)
        except KeyboardInterrupt:
            log.info("gestopt")
            return 0
        except Exception:  # noqa: BLE001 - een tick mag de worker niet vellen
            log.exception("tick mislukt; volgende poging volgens schema")

        minutes = next_interval_minutes(sb, datetime.now())
        log.info("volgende tick over %d minuten (of eerder bij een sync-aanvraag)", minutes)

        # In stukjes slapen, zodat een druk op de knop in de app niet een half
        # uur hoeft te wachten op de volgende tick.
        waited = 0
        while waited < minutes * 60:
            time.sleep(min(POLL_SECONDS, minutes * 60 - waited))
            waited += POLL_SECONDS
            beat()
            try:
                if pending_request(sb):
                    log.info("sync-aanvraag gezien; nu tick")
                    break
            except Exception:  # noqa: BLE001 - een hik in het netwerk is geen reden te stoppen
                log.warning("kon niet op aanvragen controleren; volgende poging")


if __name__ == "__main__":
    sys.exit(main())
