"""De lokale dag en het lokale uur, onafhankelijk van de containerinstelling.

Op de VPS draait de worker in UTC. Dat gaf twee stille fouten. Het dichte
ochtendvenster (`MORNING_WINDOW`, 06:00-10:00) liep in de praktijk van 08:00 tot
12:00 Brusselse tijd, precies naast het moment waarop Garmin je slaap en
readiness uploadt. En tussen middernacht en 02:00 gaf `date.today()` nog de dag
ervoor, waardoor de sessie van vandaag als gemist kon worden aangemerkt.

Beide keren was de code niet fout maar de tijdzone onuitgesproken. Daarom staat
hij hier expliciet, en niet in een omgevingsvariabele van de container.
"""

from __future__ import annotations

import logging
import os
from datetime import date, datetime, timezone

log = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "Europe/Brussels"

_warned = False


def _zone():
    """De ingestelde zone, of None als de tijdzonedatabase ontbreekt."""
    global _warned
    name = os.environ.get("TM_TIMEZONE", DEFAULT_TIMEZONE)
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(name)
    except Exception as exc:  # noqa: BLE001 - ontbrekende tzdata mag niets vellen
        if not _warned:
            log.warning(
                "tijdzone %s niet beschikbaar (%s); val terug op de systeemtijd",
                name,
                type(exc).__name__,
            )
            _warned = True
        return None


def now() -> datetime:
    """Nu, in de lokale tijdzone van de atleet."""
    zone = _zone()
    return datetime.now(zone) if zone else datetime.now()


def today() -> date:
    """De lokale kalenderdag. Dit bepaalt welke sessie 'vandaag' is."""
    return now().date()


def utc_now() -> datetime:
    """Voor tijdstempels die de database in gaan."""
    return datetime.now(timezone.utc)
