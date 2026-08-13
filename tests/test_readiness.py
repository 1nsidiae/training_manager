from __future__ import annotations

import unittest

from tm_sync import mappers
from tm_sync.wellness import _merge


def _entry(score: int, level: str, timestamp: str, sleep_score=None) -> dict:
    return {
        "calendarDate": "2026-08-13",
        "score": score,
        "level": level,
        "timestamp": timestamp,
        "sleepScore": sleep_score,
    }


class ReadinessOrderTest(unittest.TestCase):
    """Garmin geeft meerdere Training Readiness-metingen per dag terug.

    Ze komen niet op volgorde binnen, en `_merge` laat de laatst geziene winnen.
    Zonder sorteren won daardoor geregeld een meting van de avond ervoor: de
    score bleef hangen terwijl stappen en hartslag wél meebewogen.
    """

    # Precies zoals Garmin het teruggaf op 13 augustus 2026: de actuele meting
    # van 08:06 stond vóór de verouderde van de avond ervoor.
    ECHTE_RESPONSE = [
        _entry(70, "MODERATE", "2026-08-13T08:06:51.0", sleep_score=73),
        _entry(82, "HIGH", "2026-08-12T22:35:33.0"),
    ]

    def test_newest_measurement_wins(self) -> None:
        days: dict[str, dict] = {}
        for entry in sorted(self.ECHTE_RESPONSE, key=mappers.readiness_moment):
            _merge(days, mappers.map_readiness(entry))

        self.assertEqual(days["2026-08-13"]["training_readiness_score"], 70)
        self.assertEqual(days["2026-08-13"]["training_readiness_level"], "MODERATE")

    def test_without_sorting_the_stale_one_would_win(self) -> None:
        days: dict[str, dict] = {}
        for entry in self.ECHTE_RESPONSE:
            _merge(days, mappers.map_readiness(entry))

        self.assertEqual(days["2026-08-13"]["training_readiness_score"], 82)

    def test_sleep_score_survives_a_newer_entry_without_one(self) -> None:
        """De late meting draagt geen slaapscore; die mag niet verdwijnen."""
        days: dict[str, dict] = {}
        for entry in sorted(self.ECHTE_RESPONSE, key=mappers.readiness_moment):
            _merge(days, mappers.map_readiness(entry))

        self.assertEqual(days["2026-08-13"]["sleep_score"], 73)

    def test_entry_without_timestamp_loses(self) -> None:
        entries = [_entry(55, "LOW", ""), _entry(70, "MODERATE", "2026-08-13T08:06:51.0")]
        days: dict[str, dict] = {}
        for entry in sorted(entries, key=mappers.readiness_moment):
            _merge(days, mappers.map_readiness(entry))

        self.assertEqual(days["2026-08-13"]["training_readiness_score"], 70)


if __name__ == "__main__":
    unittest.main()
