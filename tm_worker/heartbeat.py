"""Levensteken van de serve-lus.

Een worker die vastloopt zonder te crashen blijft voor Docker gewoon "up".
Herstarten op basis van het proces alleen is dus niet genoeg. De lus schrijft
bij elke poll een tijdstempel weg; `tm_worker.health` kijkt of die vers genoeg
is. Een bestand volstaat: het proces dat schrijft en het proces dat leest zitten
in dezelfde container.
"""

from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path

# Ruim boven het pollinterval van 15 seconden, zodat één trage Supabase-call
# geen herstart uitlokt, maar ruim onder het rustige tickinterval van 30 minuten.
STALE_AFTER_S = 120


def path() -> Path:
    default = Path(tempfile.gettempdir()) / "tm_worker.heartbeat"
    return Path(os.environ.get("TM_WORKER_HEARTBEAT", str(default)))


def beat() -> None:
    """Schrijf een hartslag. Mag nooit de lus vellen."""
    try:
        target = path()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(str(time.time()), encoding="utf-8")
    except OSError:
        pass


def age_seconds() -> float | None:
    """Leeftijd van de laatste hartslag, of None als er geen bruikbare is."""
    try:
        raw = path().read_text(encoding="utf-8").strip()
        return time.time() - float(raw)
    except (OSError, ValueError):
        return None
