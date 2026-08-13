"""Garmin- en Supabase-clients, plus throttling voor de unofficiele API."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, TypeVar

from garminconnect import Garmin
from supabase import Client, create_client

from .config import Settings

log = logging.getLogger(__name__)
T = TypeVar("T")


def garmin_client(settings: Settings) -> Garmin:
    """Hervat een bestaande sessie uit de tokenstore.

    Vraagt nooit om een wachtwoord: als de tokens ontbreken of verlopen zijn,
    moet scripts/garmin_login.py opnieuw gedraaid worden.
    """
    client = Garmin()
    client.login(settings.garmin_tokenstore)
    return client


def supabase_client(settings: Settings) -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_key)


class Throttle:
    """Houdt een minimale pauze tussen Garmin-calls aan."""

    def __init__(self, seconds: float) -> None:
        self.seconds = seconds
        self._last = 0.0

    def wait(self) -> None:
        elapsed = time.monotonic() - self._last
        if elapsed < self.seconds:
            time.sleep(self.seconds - elapsed)
        self._last = time.monotonic()


def safe_call(label: str, fn: Callable[..., T], *args: Any, **kwargs: Any) -> T | None:
    """Roep een Garmin-endpoint aan; log fouten in plaats van de sync te stoppen.

    Ontbrekende data is normaal (geen horloge gedragen, feature niet actief),
    en mag een backfill van 17 maanden niet laten crashen.
    """
    try:
        return fn(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001 - unofficiele API, alles kan
        log.warning("%s faalde: %s: %s", label, type(exc).__name__, exc)
        return None
