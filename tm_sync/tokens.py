"""Houdbaarheid van de Garmin-tokens.

De refresh-token van Garmin verloopt ongeveer elk half jaar en is niet zelf
uit te lezen: het is geen JWT, alleen een ondoorzichtige string. De access-token
ernaast leeft maar een dag en zegt dus niets over het moment waarop je opnieuw
moet inloggen.

Daarom stempelt `scripts/garmin_login.py` bij het inloggen de datum, en telt de
worker vanaf daar af. Zonder stempel zwijgt de controle liever dan te gokken —
een verkeerde waarschuwing over verlopen tokens is erger dan geen.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger(__name__)

STAMP_NAME = "tm_login_stamp.json"

# Garmin geeft ongeveer een half jaar; we waarschuwen ruim op tijd, zodat je
# het opnieuw inloggen kunt plannen in plaats van het als storing te beleven.
WARN_AFTER_DAYS = 150
EXPIRED_AFTER_DAYS = 180


def stamp_path(tokenstore: str) -> Path:
    return Path(tokenstore).expanduser() / STAMP_NAME


def write_stamp(tokenstore: str) -> Path:
    """Leg vast wanneer er voor het laatst volledig is ingelogd."""
    target = stamp_path(tokenstore)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(
        json.dumps({"logged_in_at": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8",
    )
    return target


def days_since_login(tokenstore: str) -> float | None:
    """Dagen sinds de laatste volledige login, of None als dat onbekend is."""
    try:
        raw = json.loads(stamp_path(tokenstore).read_text(encoding="utf-8"))
        when = datetime.fromisoformat(str(raw["logged_in_at"]))
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return (datetime.now(timezone.utc) - when).total_seconds() / 86_400


def expiry_warning(tokenstore: str) -> dict[str, object] | None:
    """Waarschuwing als de tokens tegen hun houdbaarheidsdatum lopen."""
    age = days_since_login(tokenstore)
    if age is None or age < WARN_AFTER_DAYS:
        return None
    remaining = EXPIRED_AFTER_DAYS - age
    return {
        "days_since_login": round(age),
        "days_remaining": round(remaining),
        "expired": remaining <= 0,
        "action": "draai scripts/garmin_login.py lokaal en kopieer het tokenbestand",
    }
