from __future__ import annotations

import unittest

from tm_coach.consistency import InconsistentContext, check, require_consistent


def _context(**overrides):
    base = {
        "today": "2026-08-14",
        "goal": {"target_date": "2026-11-08"},
        "plan_window": {"plan_start_date": "2026-08-17"},
        "constraints": {
            "runs_last_21d": 0,
            "entry_week_ceiling_m": 15000,
            "easy_hr_cap": 141,
        },
        "status": {"days_since_last_run": 31},
        "fitness": {"anchor": {"basis": {"confidence": "medium"}}},
    }
    for key, value in overrides.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


class TegenstrijdigeContextTest(unittest.TestCase):
    def test_recent_gelopen_en_lang_inactief_kan_niet_allebei(self) -> None:
        """De fout die drie Opus-aanroepen kostte zonder resultaat.

        Met 14 runs in 21 dagen eist quality_variety_required intensiteit,
        terwijl return_to_run_phase die na 31 dagen inactiviteit verbiedt. Het
        model springt daar heen en weer tussen tot de pogingen op zijn.
        """
        problems = check(_context(constraints={"runs_last_21d": 14}))
        self.assertEqual(len(problems), 1)
        self.assertIn("runs_last_21d", problems[0])
        self.assertIn("days_since_last_run", problems[0])

    def test_die_combinatie_stopt_voor_de_eerste_aanroep(self) -> None:
        with self.assertRaises(InconsistentContext):
            require_consistent(_context(constraints={"runs_last_21d": 14}))

    def test_consistente_context_gaat_door(self) -> None:
        self.assertEqual(check(_context()), [])
        require_consistent(_context())

    def test_recent_gelopen_met_recente_laatste_run_is_prima(self) -> None:
        ctx = _context(constraints={"runs_last_21d": 14}, status={"days_since_last_run": 2})
        self.assertEqual(check(ctx), [])


class OverigeControlesTest(unittest.TestCase):
    def test_geen_ruimte_om_te_plannen(self) -> None:
        problems = check(_context(constraints={"entry_week_ceiling_m": 0}))
        self.assertTrue(any("entry_week_ceiling_m" in p for p in problems))

    def test_onmogelijk_hartslagplafond(self) -> None:
        problems = check(_context(constraints={"easy_hr_cap": 12}))
        self.assertTrue(any("easy_hr_cap" in p for p in problems))

    def test_doeldatum_in_het_verleden(self) -> None:
        problems = check(_context(goal={"target_date": "2026-01-01"}))
        self.assertTrue(any("doeldatum" in p for p in problems))

    def test_planstart_voor_vandaag(self) -> None:
        problems = check(_context(plan_window={"plan_start_date": "2026-08-01"}))
        self.assertTrue(any("plan_start_date" in p for p in problems))

    def test_anker_zonder_zekerheid(self) -> None:
        """Zonder confidence weet de coach niet hoe hard het tempo is."""
        problems = check(_context(fitness={"anchor": {"basis": {}}}))
        self.assertTrue(any("confidence" in p for p in problems))

    def test_zonder_anker_geen_klacht(self) -> None:
        """Een ontbrekend anker is geen tegenstrijdigheid, alleen minder bewijs."""
        self.assertEqual(check(_context(fitness={})), [])


if __name__ == "__main__":
    unittest.main()
