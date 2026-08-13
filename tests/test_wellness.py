from __future__ import annotations

import unittest

from tm_sync.wellness import _preserve_sleep_detail


class PreserveSleepDetailTest(unittest.TestCase):
    def test_keeps_existing_timeline_when_current_response_has_only_summary(self) -> None:
        detail = {
            "start_local_ms": 1,
            "end_local_ms": 2,
            "levels": [{"start_gmt": "a", "end_gmt": "b", "level": 1}],
        }

        merged = _preserve_sleep_detail(
            {"calendarDate": "2026-08-12", "values": {}},
            {"daily_summary": {}, "sleep_detail": detail},
        )

        self.assertEqual(merged["sleep_detail"], detail)
        self.assertEqual(merged["daily_summary"]["calendarDate"], "2026-08-12")

    def test_new_timeline_wins_over_existing_timeline(self) -> None:
        current = {
            "daily_summary": {},
            "sleep_detail": {
                "levels": [{"start_gmt": "new", "end_gmt": "new", "level": 2}]
            },
        }
        existing = {
            "sleep_detail": {
                "levels": [{"start_gmt": "old", "end_gmt": "old", "level": 1}]
            }
        }

        self.assertIs(_preserve_sleep_detail(current, existing), current)


if __name__ == "__main__":
    unittest.main()
