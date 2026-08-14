from __future__ import annotations

import unittest

from tm_sync.mappers import map_intraday_detail, map_steps_detail
from tm_sync.wellness import _preserve_sleep_detail, _preserve_wellness_details


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

    def test_steps_mapper_keeps_sleep_and_compacts_intervals(self) -> None:
        result = map_steps_detail(
            "2026-08-13",
            [
                {
                    "startGMT": "2026-08-13T08:00:00.0",
                    "endGMT": "2026-08-13T08:15:00.0",
                    "steps": 123,
                    "primaryActivityLevel": "active",
                }
            ],
            {"daily_summary": {}, "sleep_detail": {"levels": [{"level": 1}]}},
        )

        self.assertIsNotNone(result)
        assert result is not None
        self.assertIn("sleep_detail", result["raw"])
        self.assertEqual(
            result["raw"]["steps_detail"]["buckets"],
            [
                {
                    "start_gmt": "2026-08-13T08:00:00.0",
                    "end_gmt": "2026-08-13T08:15:00.0",
                    "steps": 123,
                }
            ],
        )

    def test_preserves_existing_step_intervals_when_garmin_returns_nothing(self) -> None:
        buckets = [{"start_gmt": "a", "end_gmt": "b", "steps": 50}]
        result = _preserve_wellness_details(
            {"daily_summary": {"calendarDate": "2026-08-13"}},
            {"steps_detail": {"buckets": buckets}},
        )

        self.assertEqual(result["steps_detail"]["buckets"], buckets)

    def test_maps_intraday_metrics_and_skips_unknown_stress(self) -> None:
        result = map_intraday_detail(
            "2026-08-13",
            {
                "stressValuesArray": [[1, -1, 0], [2, -2, 0], [3, 42, 0]],
                "bodyBatteryValuesArray": [[1, 1, 74, 0]],
            },
            {"heartRateValues": [[1, 55], [2, None]]},
            {},
        )

        self.assertIsNotNone(result)
        assert result is not None
        detail = result["raw"]["intraday_detail"]
        self.assertEqual([point["value"] for point in detail["stress"]], [0, 42])
        self.assertEqual(detail["body_battery"][0]["value"], 74)
        self.assertEqual(detail["heart_rate"][0]["value"], 55)


if __name__ == "__main__":
    unittest.main()
