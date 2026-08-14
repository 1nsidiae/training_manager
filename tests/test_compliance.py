from __future__ import annotations

import unittest

from tm_coach import guardrails
from tm_sync.compliance import consecutive_heavy_misses, evaluate_session


class ComplianceTest(unittest.TestCase):
    def test_easy_run_is_missed_when_short_and_above_hr_cap(self) -> None:
        result = evaluate_session(
            {
                "session_type": "easy",
                "planned_distance_m": 5000,
                "planned_duration_s": 2400,
                "hr_cap": 141,
                "structure": {"steps": []},
            },
            {
                "distance_m": 3600,
                "duration_s": 2100,
                "avg_hr": 153,
                "avg_pace_s_per_km": 583,
            },
        )
        self.assertEqual(result["status"], "missed")
        self.assertEqual(result["completion_ratio"], 0.72)
        self.assertEqual(result["hr_delta"], 12)
        self.assertIn("completion_below_85pct", result["reasons"])
        self.assertIn("average_hr_more_than_5_above_cap", result["reasons"])

    def test_small_gps_difference_still_meets_target(self) -> None:
        result = evaluate_session(
            {
                "session_type": "easy",
                "planned_distance_m": 5000,
                "planned_duration_s": 2400,
                "hr_cap": 141,
                "structure": {"steps": []},
            },
            {
                "distance_m": 4930,
                "duration_s": 2380,
                "avg_hr": 139,
                "avg_pace_s_per_km": 482,
            },
        )
        self.assertEqual(result["status"], "met")
        self.assertEqual(result["reasons"], [])

    def test_tempo_average_is_not_scored_when_target_covers_only_work_block(self) -> None:
        result = evaluate_session(
            {
                "session_type": "tempo",
                "planned_distance_m": 6000,
                "planned_duration_s": 2400,
                "hr_cap": 0,
                "structure": {
                    "steps": [
                        {"type": "warmup", "duration_s": 600, "distance_m": 0, "repeat": 1},
                        {
                            "type": "work",
                            "duration_s": 1200,
                            "distance_m": 0,
                            "repeat": 1,
                            "pace_min_s_per_km": 300,
                            "pace_max_s_per_km": 320,
                        },
                        {"type": "cooldown", "duration_s": 600, "distance_m": 0, "repeat": 1},
                    ]
                },
            },
            {
                "distance_m": 6000,
                "duration_s": 2400,
                "avg_hr": 160,
                "avg_pace_s_per_km": 400,
            },
        )
        self.assertEqual(result["status"], "met")
        self.assertEqual(result["pace_target_coverage"], 0.5)
        self.assertNotIn("pace_more_than_8pct_slower_than_target", result["reasons"])

    def test_two_latest_heavy_misses_form_streak(self) -> None:
        feedback = [
            {"id": 2, "plan_session_id": 12, "endurance_score": 2, "extra": {"rpe": 9}},
            {"id": 1, "plan_session_id": 11, "endurance_score": 2, "extra": {"rpe": 8}},
        ]
        sessions = {
            12: {"id": 12, "targets": {"compliance": {"status": "missed"}}},
            11: {"id": 11, "targets": {"compliance": {"status": "missed"}}},
        }
        self.assertEqual(len(consecutive_heavy_misses(feedback, sessions)), 2)

    def test_one_normal_run_breaks_streak(self) -> None:
        feedback = [
            {"id": 2, "plan_session_id": 12, "endurance_score": 6, "extra": {"rpe": 5}},
            {"id": 1, "plan_session_id": 11, "endurance_score": 2, "extra": {"rpe": 9}},
        ]
        sessions = {
            12: {"id": 12, "targets": {"compliance": {"status": "met"}}},
            11: {"id": 11, "targets": {"compliance": {"status": "missed"}}},
        }
        self.assertEqual(consecutive_heavy_misses(feedback, sessions), [])


class ComplianceGuardrailTest(unittest.TestCase):
    @staticmethod
    def _sleep_context(reference_week_distance_m: int = 10_000) -> dict:
        return {
            "today": "2026-08-13",
            "athlete": {"hr_zones": []},
            "goal": {"type": "maintenance"},
            "status": {"days_since_last_run": None},
            "fitness": {},
            "recent_wellness": [
                {"sleep_total_s": int(5.5 * 3600)} for _ in range(7)
            ],
            "constraints": {
                "entry_week_ceiling_m": 30_000,
                "reference_week_distance_m": reference_week_distance_m,
                "sleep_volume_ceiling_next_7d_m": reference_week_distance_m,
                "stated_capacity_m": 5000,
            },
        }

    @staticmethod
    def _sleep_rule() -> list[dict]:
        return [{
            "key": "sleep_7d_below_threshold",
            "status": "active",
            "params": {"threshold_h": 6.0},
        }]

    def test_low_sleep_allows_growth_after_next_seven_days(self) -> None:
        plan = {
            "weeks": [
                {
                    "week_start": "2026-08-10",
                    "planned_distance_m": 10_000,
                    "sessions": [{
                        "date": "2026-08-14",
                        "session_type": "easy",
                        "planned_distance_m": 5000,
                        "hr_cap": 141,
                        "steps": [],
                    }],
                },
                {
                    "week_start": "2026-08-17",
                    "planned_distance_m": 11_000,
                    "sessions": [{
                        "date": "2026-08-20",
                        "session_type": "easy",
                        "planned_distance_m": 5000,
                        "hr_cap": 141,
                        "steps": [],
                    }, {
                        "date": "2026-08-21",
                        "session_type": "easy",
                        "planned_distance_m": 1000,
                        "hr_cap": 141,
                        "steps": [],
                    }],
                },
            ]
        }

        problems = guardrails.validate(
            plan,
            self._sleep_context(),
            self._sleep_rule(),
        )

        self.assertFalse(
            any(problem.rule == "sleep_7d_below_threshold" for problem in problems)
        )

    def test_low_sleep_blocks_growth_over_the_next_seven_days(self) -> None:
        plan = {
            "weeks": [{
                "week_start": "2026-08-10",
                "planned_distance_m": 11_000,
                "sessions": [{
                    "date": "2026-08-14",
                    "session_type": "easy",
                    "planned_distance_m": 11_000,
                    "hr_cap": 141,
                    "steps": [],
                }],
            }]
        }

        problems = guardrails.validate(
            plan,
            self._sleep_context(),
            self._sleep_rule(),
        )

        sleep_problems = [
            problem for problem in problems
            if problem.rule == "sleep_7d_below_threshold"
        ]
        self.assertEqual(len(sleep_problems), 1)
        self.assertEqual(sleep_problems[0].where, "2026-08-13")

    def test_partial_first_week_does_not_cap_first_full_week(self) -> None:
        plan = {
            "weeks": [
                {
                    "week_start": "2026-08-10",
                    "planned_distance_m": 9000,
                    "sessions": [],
                },
                {
                    "week_start": "2026-08-17",
                    "planned_distance_m": 15_000,
                    "sessions": [],
                },
                {
                    "week_start": "2026-08-24",
                    "planned_distance_m": 16_500,
                    "sessions": [],
                },
            ]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["constraints"]["entry_week_ceiling_m"] = 15_000
        context["constraints"]["first_week_is_partial"] = True

        problems = guardrails.validate(plan, context, [])

        self.assertFalse(
            any(problem.rule == "weekly_volume_ramp_cap" for problem in problems)
        )

    def test_first_full_week_still_obeys_entry_ceiling(self) -> None:
        plan = {
            "weeks": [
                {
                    "week_start": "2026-08-10",
                    "planned_distance_m": 9000,
                    "sessions": [],
                },
                {
                    "week_start": "2026-08-17",
                    "planned_distance_m": 15_100,
                    "sessions": [],
                },
            ]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["constraints"]["entry_week_ceiling_m"] = 15_000
        context["constraints"]["first_week_is_partial"] = True

        problems = guardrails.validate(plan, context, [])

        ramp_problems = [
            problem for problem in problems
            if problem.rule == "weekly_volume_ramp_cap"
        ]
        self.assertEqual(len(ramp_problems), 1)
        self.assertEqual(ramp_problems[0].where, "2026-08-17")

    def test_confirmed_five_k_capacity_rejects_walk_run_and_tiny_run(self) -> None:
        plan = {
            "weeks": [{
                "week_start": "2026-08-10",
                "planned_distance_m": 2700,
                "sessions": [{
                    "date": "2026-08-14",
                    "session_type": "walk_run",
                    "planned_distance_m": 1600,
                    "hr_cap": 141,
                    "steps": [],
                }, {
                    "date": "2026-08-16",
                    "session_type": "easy",
                    "planned_distance_m": 1100,
                    "hr_cap": 141,
                    "steps": [],
                }],
            }]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["status"]["days_since_last_run"] = 30

        problems = guardrails.validate(plan, context, [])

        capacity_problems = [
            problem for problem in problems
            if problem.rule == "demonstrated_continuous_capacity"
        ]
        self.assertEqual(len(capacity_problems), 2)

    def test_confirmed_capacity_allows_long_but_delays_quality_one_week(self) -> None:
        plan = {
            "weeks": [{
                "week_start": "2026-08-10",
                "planned_distance_m": 9000,
                "sessions": [{
                    "date": "2026-08-14",
                    "session_type": "tempo",
                    "planned_distance_m": 4000,
                    "hr_cap": 0,
                    "target_type": "pace",
                    "steps": [{
                        "pace_min_s_per_km": 300,
                        "pace_max_s_per_km": 360,
                    }],
                }, {
                    "date": "2026-08-16",
                    "session_type": "long",
                    "planned_distance_m": 5000,
                    "hr_cap": 141,
                    "steps": [],
                }],
            }]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["status"]["days_since_last_run"] = 30

        problems = guardrails.validate(plan, context, [])

        return_problems = [
            problem for problem in problems if problem.rule == "return_to_run_phase"
        ]
        self.assertEqual(len(return_problems), 1)
        self.assertIn("tempo", return_problems[0].message)

    def test_repeated_misses_force_reduction_and_no_long_run(self) -> None:
        plan = {
            "weeks": [
                {
                    "week_start": "2026-08-10",
                    "planned_distance_m": 13000,
                    "sessions": [
                        {
                            "date": "2026-08-13",
                            "session_type": "easy",
                            "planned_distance_m": 5000,
                            "hr_cap": 141,
                            "steps": [],
                        },
                        {
                            "date": "2026-08-16",
                            "session_type": "long",
                            "planned_distance_m": 8000,
                            "hr_cap": 141,
                            "steps": [],
                        },
                    ],
                }
            ]
        }
        context = {
            "today": "2026-08-12",
            "athlete": {"hr_zones": []},
            "goal": {"type": "maintenance"},
            "status": {"days_since_last_run": None},
            "fitness": {},
            "recent_wellness": [],
            "constraints": {
                "entry_week_ceiling_m": 20000,
                "reference_week_distance_m": 0,
                "stated_capacity_m": 5000,
                "repeated_heavy_target_misses": True,
                "target_miss_next_7d_ceiling_m": 8500,
            },
        }
        problems = guardrails.validate(plan, context, [])
        repeated = [problem for problem in problems if problem.rule == "repeated_heavy_target_miss"]
        self.assertEqual(len(repeated), 2)
        self.assertTrue(any("reductieplafond" in problem.message for problem in repeated))
        self.assertTrue(any("geen long" in problem.message for problem in repeated))

    def test_plan_wizard_enforces_start_and_first_training_date(self) -> None:
        plan = {
            "weeks": [{
                "week_start": "2026-08-17",
                "planned_distance_m": 5000,
                "sessions": [{
                    "date": "2026-08-19",
                    "session_type": "easy",
                    "planned_distance_m": 5000,
                    "hr_cap": 141,
                    "steps": [],
                }],
            }]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["plan_window"] = {
            "plan_start_date": "2026-08-17",
            "first_training_date": "2026-08-18",
        }
        context["goal"] = {
            "type": "maintenance",
            "params": {
                "created_via": "plan_wizard",
                "preferred_training_days": ["tuesday", "wednesday"],
            },
        }

        problems = guardrails.validate(plan, context, [])

        first_day = [problem for problem in problems if problem.rule == "first_training_date"]
        self.assertEqual(len(first_day), 1)
        self.assertIn("2026-08-18", first_day[0].message)

    def test_plan_wizard_allows_two_sessions_on_same_selected_day(self) -> None:
        plan = {
            "weeks": [{
                "week_start": "2026-08-17",
                "planned_distance_m": 5000,
                "sessions": [{
                    "date": "2026-08-18",
                    "session_type": "easy",
                    "planned_distance_m": 5000,
                    "hr_cap": 141,
                    "steps": [],
                }, {
                    "date": "2026-08-18",
                    "session_type": "strength",
                    "planned_distance_m": 0,
                    "hr_cap": 0,
                    "steps": [],
                }],
            }]
        }
        context = self._sleep_context()
        context["recent_wellness"] = []
        context["plan_window"] = {
            "plan_start_date": "2026-08-17",
            "first_training_date": "2026-08-18",
        }
        context["goal"] = {
            "type": "maintenance",
            "params": {
                "created_via": "plan_wizard",
                "preferred_training_days": ["tuesday"],
            },
        }

        problems = guardrails.validate(plan, context, [])

        self.assertFalse(any(problem.rule in {
            "plan_start_date", "first_training_date", "preferred_training_days"
        } for problem in problems))


if __name__ == "__main__":
    unittest.main()
