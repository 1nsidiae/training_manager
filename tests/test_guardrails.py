from __future__ import annotations

import unittest

from tm_coach.guardrails import validate

RULES = [
    {"key": "pain_score_override", "status": "active", "params": {"pain_threshold": 6}},
    {"key": "readiness_gate_quality", "status": "active", "params": {"min_readiness": 50}},
]


def _context(**overrides):
    base = {
        "today": "2026-08-14",
        "plan_window": {"plan_start_date": "2026-08-15"},
        "athlete": {"hr_zones": [{"zone": 2, "high": 141}]},
        "goal": {"type": "race", "params": {}},
        "status": {"days_since_last_run": 2},
        "constraints": {
            "entry_week_ceiling_m": 60000,
            "stated_capacity_m": 16000,
            "runs_last_21d": 12,
        },
        "fitness": {},
        "recent_wellness": [],
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


def _session(day: str, session_type: str, **extra):
    base = {
        "date": day,
        "session_type": session_type,
        "hr_cap": 141 if session_type in {"easy", "long", "recovery"} else 0,
        "planned_distance_m": 10000,
        "target_type": "hr",
        "steps": [],
    }
    if session_type in {"tempo", "interval", "race"}:
        base["target_type"] = "pace"
        base["steps"] = [{"type": "work", "pace_min_s_per_km": 300, "pace_max_s_per_km": 315}]
    base.update(extra)
    return base


def _plan(*sessions):
    return {
        "weeks": [
            {
                "week_start": "2026-08-17",
                "planned_distance_m": sum(s.get("planned_distance_m") or 0 for s in sessions),
                "sessions": list(sessions),
            }
        ]
    }


def _rules_hit(plan, context) -> list[str]:
    return [p.rule for p in validate(plan, context, RULES)]


class PijnregelTest(unittest.TestCase):
    """De regel stond actief in coach_rules en werd nergens getoetst."""

    SIGNAL = {
        "day": "2026-08-14",
        "pain_score": 7,
        "threshold": 6,
        "no_intensity_until": "2026-08-17",
    }

    def test_intensiteit_binnen_het_pijnvenster_wordt_afgekeurd(self) -> None:
        plan = _plan(_session("2026-08-16", "interval"))
        hits = _rules_hit(plan, _context(constraints={"pain_signal": self.SIGNAL}))
        self.assertIn("pain_score_override", hits)

    def test_een_lange_duurloop_telt_ook_als_intensiteit(self) -> None:
        plan = _plan(_session("2026-08-16", "long"))
        hits = _rules_hit(plan, _context(constraints={"pain_signal": self.SIGNAL}))
        self.assertIn("pain_score_override", hits)

    def test_na_het_venster_mag_het_weer(self) -> None:
        plan = _plan(_session("2026-08-18", "interval"))
        hits = _rules_hit(plan, _context(constraints={"pain_signal": self.SIGNAL}))
        self.assertNotIn("pain_score_override", hits)

    def test_een_rustige_run_zonder_plafond_wordt_afgekeurd(self) -> None:
        plan = _plan(_session("2026-08-16", "easy", hr_cap=0))
        hits = _rules_hit(plan, _context(constraints={"pain_signal": self.SIGNAL}))
        self.assertIn("pain_score_override", hits)

    def test_een_rustige_run_met_plafond_mag(self) -> None:
        plan = _plan(_session("2026-08-16", "easy"))
        hits = _rules_hit(plan, _context(constraints={"pain_signal": self.SIGNAL}))
        self.assertNotIn("pain_score_override", hits)

    def test_zonder_pijnsignaal_zegt_de_regel_niets(self) -> None:
        plan = _plan(_session("2026-08-16", "interval"))
        self.assertNotIn("pain_score_override", _rules_hit(plan, _context()))


class ReadinessTest(unittest.TestCase):
    LOW = {"score": 38, "threshold": 50}

    def test_kwaliteit_op_een_dag_met_lage_readiness_wordt_afgekeurd(self) -> None:
        plan = _plan(_session("2026-08-14", "tempo"))
        hits = _rules_hit(plan, _context(constraints={"low_readiness_today": self.LOW}))
        self.assertIn("readiness_gate_quality", hits)

    def test_morgen_valt_er_niets_te_zeggen(self) -> None:
        plan = _plan(_session("2026-08-15", "tempo"))
        hits = _rules_hit(plan, _context(constraints={"low_readiness_today": self.LOW}))
        self.assertNotIn("readiness_gate_quality", hits)

    def test_rustig_lopen_mag_ook_bij_lage_readiness(self) -> None:
        plan = _plan(_session("2026-08-14", "easy"))
        hits = _rules_hit(plan, _context(constraints={"low_readiness_today": self.LOW}))
        self.assertNotIn("readiness_gate_quality", hits)


class MultiSportHerstelTest(unittest.TestCase):
    def test_zware_run_binnen_48_uur_wordt_afgekeurd_bij_protect(self) -> None:
        plan = _plan(_session("2026-08-15", "tempo", sport="running"))
        context = _context(multi_sport_load={"heavy_run_impact": "protect"})
        self.assertIn("multi_sport_recovery_spacing", _rules_hit(plan, context))

    def test_easy_run_en_later_zwaar_lopen_blijven_mogelijk(self) -> None:
        plan = _plan(
            _session("2026-08-15", "easy", sport="running"),
            _session("2026-08-17", "tempo", sport="running"),
        )
        context = _context(multi_sport_load={"heavy_run_impact": "protect"})
        self.assertNotIn("multi_sport_recovery_spacing", _rules_hit(plan, context))

    def test_watch_is_advies_geen_hard_blok(self) -> None:
        plan = _plan(_session("2026-08-15", "long", sport="running"))
        context = _context(multi_sport_load={"heavy_run_impact": "watch"})
        self.assertNotIn("multi_sport_recovery_spacing", _rules_hit(plan, context))

class ToezeggingshorizonTest(unittest.TestCase):
    def test_het_model_mag_de_vastgelegde_week_niet_overschrijven(self) -> None:
        plan = _plan(_session("2026-08-16", "easy"))
        hits = _rules_hit(
            plan,
            _context(plan_window={"frozen_until": "2026-08-16"}),
        )
        self.assertIn("commitment_horizon", hits)

    def test_de_dag_erna_is_wel_van_het_model(self) -> None:
        plan = _plan(_session("2026-08-17", "easy"))
        hits = _rules_hit(
            plan,
            _context(plan_window={"frozen_until": "2026-08-16"}),
        )
        self.assertNotIn("commitment_horizon", hits)

    def test_zonder_horizon_geldt_de_regel_niet(self) -> None:
        plan = _plan(_session("2026-08-14", "easy"))
        self.assertNotIn("commitment_horizon", _rules_hit(plan, _context()))

    def test_het_slaapplafond_meet_de_week_die_het_model_wel_plant(self) -> None:
        """Zonder deze verschuiving zou het plafond een leeg venster meten en
        dus altijd slagen: een controle die niets kan afkeuren."""
        wellness = [{"sleep_total_s": 5 * 3600} for _ in range(7)]
        context = _context(
            plan_window={"frozen_until": "2026-08-16"},
            constraints={"sleep_volume_ceiling_next_7d_m": 30000},
            recent_wellness=wellness,
        )
        rules = RULES + [
            {
                "key": "sleep_7d_below_threshold",
                "status": "active",
                "params": {"threshold_h": 6.0},
            }
        ]
        # Bewust ná 2026-08-20: een venster dat nog vanaf vandaag (08-14) zou
        # meten, ziet deze twee sessies helemaal niet en keurt dus niets af.
        plan = _plan(
            _session("2026-08-21", "easy", planned_distance_m=20000),
            _session("2026-08-22", "easy", planned_distance_m=20000),
        )
        hits = [p.rule for p in validate(plan, context, rules)]
        self.assertIn("sleep_7d_below_threshold", hits)

        vroeger = _context(
            constraints={"sleep_volume_ceiling_next_7d_m": 30000},
            recent_wellness=wellness,
        )
        self.assertNotIn(
            "sleep_7d_below_threshold", [p.rule for p in validate(plan, vroeger, rules)]
        )


if __name__ == "__main__":
    unittest.main()
