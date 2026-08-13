from __future__ import annotations

import unittest
from datetime import date
from unittest.mock import patch

from tm_coach.engine import plan_status_for
from tm_sync.workouts import apply_active_plan, build_running_workout


class _Result:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


class _Query:
    def __init__(self, table: str, rows: dict[str, list[dict]]) -> None:
        self.table_name = table
        self.rows = rows
        self.filters: dict[str, object] = {}

    def select(self, _columns: str):
        return self

    def eq(self, column: str, value: object):
        self.filters[column] = value
        return self

    def gte(self, column: str, value: object):
        self.filters[f"{column}__gte"] = value
        return self

    def in_(self, column: str, value: list[object]):
        self.filters[f"{column}__in"] = value
        return self

    def order(self, _column: str):
        return self

    def limit(self, _value: int):
        return self

    def execute(self):
        data = self.rows.get(self.table_name, [])
        for key, value in self.filters.items():
            if key.endswith("__gte"):
                column = key.removesuffix("__gte")
                data = [row for row in data if row.get(column, "") >= value]
            elif key.endswith("__in"):
                column = key.removesuffix("__in")
                data = [row for row in data if row.get(column) in value]
            else:
                data = [row for row in data if row.get(key) == value]
        return _Result(data)


class _FakeSB:
    def __init__(self, rows: dict[str, list[dict]]) -> None:
        self.rows = rows

    def table(self, name: str):
        return _Query(name, self.rows)


class WorkoutBuilderTest(unittest.TestCase):
    def test_easy_run_has_distance_and_hr_cap(self) -> None:
        workout = build_running_workout(
            {
                "sport": "running",
                "session_type": "easy",
                "title": "Rustige duurloop 4 km",
                "description": "Rustig lopen.",
                "planned_duration_s": 2280,
                "structure": {
                    "steps": [
                        {"type": "warmup", "duration_s": 300, "distance_m": 0, "repeat": 1, "hr_max": 120},
                        {"type": "run", "duration_s": 0, "distance_m": 4000, "repeat": 1, "hr_max": 141},
                        {"type": "cooldown", "duration_s": 300, "distance_m": 0, "repeat": 1, "hr_max": 120},
                    ]
                },
            }
        ).to_dict()

        steps = workout["workoutSegments"][0]["workoutSteps"]
        self.assertEqual([step["stepOrder"] for step in steps], [1, 2, 3])
        self.assertEqual(steps[1]["endCondition"]["conditionTypeKey"], "distance")
        self.assertEqual(steps[1]["endConditionValue"], 4000.0)
        self.assertEqual(steps[1]["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")
        self.assertEqual(steps[1]["targetValueOne"], 50.0)
        self.assertEqual(steps[1]["targetValueTwo"], 141.0)

    def test_easy_run_keeps_hr_cap_even_with_a_pace_guideline(self) -> None:
        """Een tempo-richtlijn op een rustige duurloop mag het plafond niet verdringen.

        Het horloge kan maar op één ding alarm slaan. Bij een easy run moet dat
        de hartslag zijn: op een warme dag loop je hetzelfde tempo op een veel
        hogere hartslag, en dan waarschuwt een tempodoel nergens voor.
        """
        workout = build_running_workout(
            {
                "sport": "running",
                "session_type": "easy",
                "title": "Rustige duurloop 5 km",
                "planned_duration_s": 2700,
                "targets": {"target_type": "hr"},
                "structure": {
                    "steps": [
                        {
                            "type": "run",
                            "duration_s": 0,
                            "distance_m": 5000,
                            "repeat": 1,
                            "hr_max": 141,
                            "pace_min_s_per_km": 330,
                            "pace_max_s_per_km": 390,
                        },
                    ]
                },
            }
        ).to_dict()

        step = workout["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual(step["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")
        self.assertEqual(step["targetValueTwo"], 141.0)

    def test_interval_uses_pace_when_the_plan_says_so(self) -> None:
        workout = build_running_workout(
            {
                "sport": "running",
                "session_type": "interval",
                "title": "5 × 3 minuten",
                "planned_duration_s": 2400,
                "targets": {"target_type": "both"},
                "structure": {
                    "steps": [
                        {
                            "type": "work",
                            "duration_s": 180,
                            "distance_m": 0,
                            "repeat": 1,
                            "hr_max": 175,
                            "pace_min_s_per_km": 280,
                            "pace_max_s_per_km": 300,
                        },
                    ]
                },
            }
        ).to_dict()

        step = workout["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual(step["targetType"]["workoutTargetTypeKey"], "pace.zone")
        # 300 s/km is de langzame kant en dus de laagste snelheid.
        self.assertAlmostEqual(step["targetValueOne"], 1000 / 300)
        self.assertAlmostEqual(step["targetValueTwo"], 1000 / 280)

    def test_interval_without_pace_falls_back_to_heart_rate(self) -> None:
        """Geen doel is erger dan het verkeerde doel."""
        workout = build_running_workout(
            {
                "sport": "running",
                "session_type": "interval",
                "title": "5 × 3 minuten",
                "planned_duration_s": 2400,
                "structure": {
                    "steps": [
                        {
                            "type": "work",
                            "duration_s": 180,
                            "distance_m": 0,
                            "repeat": 1,
                            "hr_max": 175,
                        },
                    ]
                },
            }
        ).to_dict()

        step = workout["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual(step["targetType"]["workoutTargetTypeKey"], "heart.rate.zone")

    def test_adjacent_repeats_become_one_repeat_group(self) -> None:
        workout = build_running_workout(
            {
                "sport": "running",
                "session_type": "walk_run",
                "title": "Wandel-loop",
                "planned_duration_s": 900,
                "structure": {
                    "steps": [
                        {"type": "run", "duration_s": 60, "repeat": 5, "hr_max": 141},
                        {"type": "walk", "duration_s": 90, "repeat": 5, "hr_max": 120},
                    ]
                },
            }
        ).to_dict()

        group = workout["workoutSegments"][0]["workoutSteps"][0]
        self.assertEqual(group["type"], "RepeatGroupDTO")
        self.assertEqual(group["numberOfIterations"], 5)
        self.assertEqual(len(group["workoutSteps"]), 2)

    def test_existing_plan_always_waits_for_user_choice(self) -> None:
        self.assertEqual(
            plan_status_for({}, set(), has_active_plan=False),
            "active",
        )
        self.assertEqual(
            plan_status_for({}, set(), has_active_plan=True),
            "proposed",
        )

    @patch("tm_sync.workouts.push_plan_session")
    @patch("tm_sync.workouts.unschedule_plan_session")
    def test_apply_plan_replaces_old_calendar_and_pushes_supported_runs(
        self,
        unschedule,
        push,
    ) -> None:
        sb = _FakeSB(
            {
                "plans": [{"id": 2, "status": "active"}],
                "plan_sessions": [
                    {
                        "id": 10,
                        "plan_id": 1,
                        "day": "2026-08-13",
                        "status": "planned",
                        "garmin_schedule_id": 99,
                        "sport": "running",
                        "session_type": "easy",
                    },
                    {
                        "id": 20,
                        "plan_id": 2,
                        "day": "2026-08-14",
                        "status": "planned",
                        "garmin_schedule_id": None,
                        "sport": "running",
                        "session_type": "easy",
                    },
                    {
                        "id": 21,
                        "plan_id": 2,
                        "day": "2026-08-15",
                        "status": "planned",
                        "garmin_schedule_id": None,
                        "sport": "strength",
                        "session_type": "strength",
                    },
                ],
            }
        )

        result = apply_active_plan(object(), sb, 2, 1, from_day=date(2026, 8, 12))

        unschedule.assert_called_once_with(unittest.mock.ANY, sb, 10)
        push.assert_called_once_with(unittest.mock.ANY, sb, 20)
        self.assertEqual(result["removed"], 1)
        self.assertEqual(result["pushed"], 1)
        self.assertEqual(result["ignored"], 1)


if __name__ == "__main__":
    unittest.main()
