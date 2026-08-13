"""Healthcheck voor de worker-container.

    python -m tm_worker.health

Exitcode 0 als de serve-lus recent nog rondging, 1 als hij zwijgt. Docker
herstart de container dan volgens het restartbeleid in compose.yaml.
"""

from __future__ import annotations

import sys

from .heartbeat import STALE_AFTER_S, age_seconds, path


def main() -> int:
    age = age_seconds()
    if age is None:
        print(f"geen leesbare hartslag in {path()}", file=sys.stderr)
        return 1
    if age > STALE_AFTER_S:
        print(
            f"hartslag {age:.0f}s oud, drempel is {STALE_AFTER_S}s",
            file=sys.stderr,
        )
        return 1
    print(f"ok, hartslag {age:.0f}s oud")
    return 0


if __name__ == "__main__":
    sys.exit(main())
