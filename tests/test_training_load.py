from __future__ import annotations

import unittest
from datetime import date

from tm_sync.training_load import (
    build_load_summary,
    canonical_sport,
    estimate_activity_load,
)


def _activity(
    activity_id: int = 1,
    *,
    sport: str = "running",
    day: str = "2026-08-14",
    duration_s: int = 3600,
    garmin_load: float | None = None,
    name: str | None = None,
):
    return {
        "id": activity_id,
        "sport": sport,
        "sub_sport": None,
        "name": name,
        "start_time_local": f"{day}T18:00:00",
        "duration_s": duration_s,
        "raw": {"activityTrainingLoad": garmin_load} if garmin_load is not None else {},
    }


class ActivityLoadTest(unittest.TestCase):
    def test_garmin_training_load_is_de_voorkeursbron(self) -> None:
        result = estimate_activity_load(_activity(garmin_load=84), {5: 3600})
        self.assertEqual(result["load"], 84)
        self.assertEqual(result["source"], "garmin")

    def test_hartslagzones_worden_gebruikt_als_garmin_load_ontbreekt(self) -> None:
        result = estimate_activity_load(_activity(), {1: 600, 2: 600, 3: 600})
        self.assertEqual(result["load"], 60)
        self.assertEqual(result["source"], "heart_rate")

    def test_duur_is_een_expliceerbare_laatste_fallback(self) -> None:
        result = estimate_activity_load(_activity(sport="strength_training", duration_s=3000))
        self.assertEqual(result["canonical_sport"], "strength")
        self.assertEqual(result["source"], "duration")
        self.assertTrue(result["estimated"])

    def test_padel_en_toekomstige_sporten_vallen_nooit_uit(self) -> None:
        self.assertEqual(canonical_sport("padel"), "racquet")
        self.assertEqual(canonical_sport("underwater_chess"), "other")
        unknown = estimate_activity_load(_activity(sport="underwater_chess"))
        self.assertGreater(unknown["load"], 0)
        self.assertEqual(unknown["canonical_sport"], "other")


class MultiSportSummaryTest(unittest.TestCase):
    def test_niet_loopbelasting_beschermt_de_volgende_zware_run(self) -> None:
        activities = [
            _activity(1, sport="padel", duration_s=7200, garmin_load=120),
            _activity(2, sport="strength_training", duration_s=3600, garmin_load=100),
        ]
        summary = build_load_summary(activities, {}, date(2026, 8, 14))
        self.assertEqual(summary["heavy_run_impact"], "protect")
        self.assertEqual({sport["sport"] for sport in summary["sports"]}, {"racquet", "strength"})
        self.assertEqual(summary["data_quality"], "measured")

    def test_alleen_ontbrekende_brondata_is_niet_gemeten(self) -> None:
        empty = _activity(duration_s=0)
        summary = build_load_summary([empty], {}, date(2026, 8, 14))
        self.assertEqual(summary["data_quality"], "missing")


if __name__ == "__main__":
    unittest.main()
