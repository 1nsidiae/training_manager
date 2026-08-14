"""Een melding versturen is een rij schrijven.

De databasetrigger op `notifications` stuurt hem door naar de Edge Function
`send-push`, die de Web Push aflevert. Dat betekent dat deze module niets weet
van VAPID, endpoints of toestellen — en dat een melding ook aankomt wanneer ze
door de webapp of met de hand wordt weggeschreven.

`dedupe_key` is hier de belangrijkste kolom. De worker draait elk half uur en
kijkt telkens naar dezelfde toestand; zonder sleutel zou "je hebt een sessie
vandaag" achtenveertig keer trillen. De sleutel is uniek in de database, dus
dubbel schrijven mislukt daar en niet hier.
"""

from __future__ import annotations

import logging
from typing import Any

from supabase import Client

log = logging.getLogger(__name__)

KINDS = {
    "plan_ready",
    "plan_adjusted",
    "session_today",
    "feedback_request",
    "sync_problem",
}


def send(
    sb: Client,
    *,
    kind: str,
    title: str,
    body: str,
    url: str = "/",
    dedupe_key: str | None = None,
    data: dict[str, Any] | None = None,
) -> int | None:
    """Schrijf een melding. Geeft het id terug, of None als ze al bestond.

    Een dubbele sleutel is geen fout maar het bewijs dat de rem werkt, dus die
    wordt stil ingeslikt. Elke andere fout wordt gelogd en niet doorgegooid:
    een melding die niet lukt, mag een sync of een herplanning niet vellen.
    """
    if kind not in KINDS:
        raise ValueError(f"onbekende meldingssoort {kind!r}; kies uit {sorted(KINDS)}")

    try:
        rows = (
            sb.table("notifications")
            .insert(
                {
                    "kind": kind,
                    "title": title,
                    "body": body,
                    "url": url,
                    "data": data or {},
                    "dedupe_key": dedupe_key,
                }
            )
            .execute()
            .data
        )
    except Exception as exc:  # noqa: BLE001 - melden mag nooit de taak breken
        if "23505" in str(exc) or "duplicate key" in str(exc).lower():
            log.debug("melding %s bestond al (%s)", kind, dedupe_key)
            return None
        log.warning("melding %s niet verstuurd: %s: %s", kind, type(exc).__name__, exc)
        return None

    if not rows:
        return None
    log.info("melding %s: %s", kind, title)
    return int(rows[0]["id"])
