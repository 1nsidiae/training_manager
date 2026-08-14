from __future__ import annotations

import unittest
from datetime import date

from tests.fake_supabase import FakeSB
from tm_coach.engine import _frozen_rows, commitment_horizon

WEDNESDAY = date(2026, 8, 12)
SUNDAY = date(2026, 8, 16)

ACTIVE_PLAN = {"plans": [{"id": 1, "status": "active"}]}


class ToezeggingshorizonTest(unittest.TestCase):
    def test_een_afdrijvend_schema_begint_pas_maandag(self) -> None:
        horizon = commitment_horizon(FakeSB(ACTIVE_PLAN), "plan_drift", WEDNESDAY)
        self.assertEqual(horizon, SUNDAY)

    def test_een_aflopend_blok_ook(self) -> None:
        horizon = commitment_horizon(FakeSB(ACTIVE_PLAN), "block_end", WEDNESDAY)
        self.assertEqual(horizon, SUNDAY)

    def test_op_zondag_ligt_alleen_zondag_zelf_nog_vast(self) -> None:
        horizon = commitment_horizon(FakeSB(ACTIVE_PLAN), "weekly_review", SUNDAY)
        self.assertEqual(horizon, SUNDAY)

    def test_pijn_mag_de_lopende_week_wel_omgooien(self) -> None:
        """Bij een alarm klopt wat er vandaag staat gewoon niet meer."""
        self.assertIsNone(commitment_horizon(FakeSB(ACTIVE_PLAN), "alarm", WEDNESDAY))

    def test_een_ander_doel_ook(self) -> None:
        self.assertIsNone(commitment_horizon(FakeSB(ACTIVE_PLAN), "goal_changed", WEDNESDAY))

    def test_een_expliciete_aanvraag_ook(self) -> None:
        self.assertIsNone(commitment_horizon(FakeSB(ACTIVE_PLAN), "manual", WEDNESDAY))

    def test_zonder_actief_plan_valt_er_niets_te_bevriezen(self) -> None:
        sb = FakeSB({"plans": [{"id": 1, "status": "superseded"}]})
        self.assertIsNone(commitment_horizon(sb, "plan_drift", WEDNESDAY))


class OvernemenTest(unittest.TestCase):
    def _store(self):
        return FakeSB(
            {
                **ACTIVE_PLAN,
                "plan_sessions": [
                    {"id": 1, "plan_id": 1, "day": "2026-08-11", "status": "completed"},
                    {"id": 2, "plan_id": 1, "day": "2026-08-13", "status": "planned"},
                    {"id": 3, "plan_id": 1, "day": "2026-08-16", "status": "moved"},
                    {"id": 4, "plan_id": 1, "day": "2026-08-18", "status": "planned"},
                    {"id": 5, "plan_id": 1, "day": "2026-08-14", "status": "skipped"},
                ],
            }
        )

    def test_alleen_wat_nog_komt_en_nog_openstaat_gaat_mee(self) -> None:
        rows = _frozen_rows(self._store(), WEDNESDAY, SUNDAY)
        self.assertEqual([r["day"] for r in rows], ["2026-08-13", "2026-08-16"])

    def test_afgeronde_en_gemiste_dagen_blijven_bij_het_oude_plan(self) -> None:
        """Anders zou een voltooide sessie twee keer meetellen in de adherentie."""
        rows = _frozen_rows(self._store(), WEDNESDAY, SUNDAY)
        self.assertNotIn("completed", [r["status"] for r in rows])
        self.assertNotIn("skipped", [r["status"] for r in rows])


if __name__ == "__main__":
    unittest.main()
