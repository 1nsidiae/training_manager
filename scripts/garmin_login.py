"""Eenmalige Garmin Connect-login.

Genereert OAuth-tokens en bewaart ze in ~/.garminconnect. De sync-worker
hergebruikt die tokens daarna en ververst ze automatisch; je hoeft dit script
pas opnieuw te draaien als de refresh-token verloopt (ongeveer elke 6 maanden).

Draai dit LOKAAL, niet op de VPS: Garmin's login-flow struikelt regelmatig over
datacenter-IP's. Kopieer daarna alleen het tokenbestand naar de server.

Gebruik:
    uv run scripts/garmin_login.py

Je wachtwoord wordt niet getoond, niet gelogd en niet opgeslagen — alleen de
tokens die Garmin teruggeeft worden bewaard.
"""

from __future__ import annotations

import os
import sys
from getpass import getpass
from pathlib import Path

try:
    from garminconnect import Garmin
except ModuleNotFoundError:
    sys.exit(
        "garminconnect ontbreekt. Draai dit script via:\n"
        "    uv run scripts/garmin_login.py"
    )

TOKENSTORE = os.environ.get("GARMIN_TOKENSTORE", "~/.garminconnect")
STAMP_NAME_HINT = "tm_login_stamp.json"


def main() -> int:
    email = os.environ.get("GARMIN_EMAIL") or input("Garmin e-mail: ").strip()
    if not email:
        print("Geen e-mail opgegeven.", file=sys.stderr)
        return 1

    client = Garmin(
        email,
        getpass("Garmin wachtwoord (invoer blijft onzichtbaar): "),
        prompt_mfa=lambda: input("MFA-code: ").strip(),
    )

    try:
        client.login(TOKENSTORE)
    except Exception as exc:  # noqa: BLE001 - login kan van alles opleveren
        print(f"\nLogin mislukt: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    store = Path(TOKENSTORE).expanduser()
    print(f"\nIngelogd. Tokens opgeslagen in: {store}")
    for f in sorted(store.glob("*.json")):
        print(f"  - {f.name} ({f.stat().st_size} bytes)")

    # De refresh-token verraadt zijn eigen einddatum niet, dus leggen we het
    # moment van inloggen vast. Daar telt de worker vanaf af en waarschuwt hij
    # ruim voordat de tokens verlopen.
    try:
        from tm_sync.tokens import WARN_AFTER_DAYS, write_stamp

        write_stamp(TOKENSTORE)
        print(f"  - {STAMP_NAME_HINT} (aanmaakdatum; waarschuwing na {WARN_AFTER_DAYS} dagen)")
    except Exception as exc:  # noqa: BLE001 - een stempel is handig, niet essentieel
        print(f"  (aanmaakdatum niet vastgelegd: {type(exc).__name__}: {exc})")

    # Rooktest: bevestig dat de tokens ook echt werken tegen de API.
    print("\nVerbinding controleren:")
    for probe in ("get_full_name", "get_unit_system"):
        fn = getattr(client, probe, None)
        if not callable(fn):
            continue
        try:
            print(f"  {probe}() -> {fn()}")
        except Exception as exc:  # noqa: BLE001
            print(f"  {probe}() faalde: {type(exc).__name__}: {exc}")

    print(
        "\nKlaar. Zet dit tokenbestand nooit in git — .gitignore dekt het al af."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
