from __future__ import annotations

import unittest
from datetime import date, timedelta

from tests.fake_supabase import FakeSB
from tm_worker import reminders

TODAY = date(2026, 8, 14)
MIDDAG = 12


def _store(**tables):
    rows = {"plan_sessions": [], "session_feedback": [], "notifications": []}
    rows.update(tables)
    return FakeSB(rows)


def _session(session_id: int, day: str, **extra):
    base = {
        "id": session_id,
        "plan_id": 1,
        "day": day,
        "title": "Rustige duurloop 10 km",
        "session_type": "easy",
        "status": "planned",
        "planned_distance_m": 10000,
        "planned_duration_s": None,
        "hr_cap": 141,
        "activity_id": None,
    }
    base.update(extra)
    return base


def _kinds(sb) -> list[str]:
    return [r["kind"] for r in sb.rows["notifications"]]


class SessieVandaagTest(unittest.TestCase):
    def test_de_sessie_van_vandaag_wordt_gemeld_met_afstand_en_plafond(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14")])
        self.assertIsNotNone(reminders.session_today(sb, 1, TODAY, MIDDAG))

        melding = sb.rows["notifications"][0]
        self.assertEqual(melding["kind"], "session_today")
        self.assertIn("10,0 km", melding["body"])
        self.assertIn("onder 141 bpm", melding["body"])

    def test_een_sessie_op_tijd_meldt_minuten(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-14", planned_distance_m=None, planned_duration_s=1800)
            ]
        )
        reminders.session_today(sb, 1, TODAY, MIDDAG)
        self.assertIn("30 min", sb.rows["notifications"][0]["body"])

    def test_voor_zeven_uur_geen_wekker(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14")])
        self.assertIsNone(reminders.session_today(sb, 1, TODAY, 5))
        self.assertEqual(sb.rows["notifications"], [])

    def test_een_rustdag_levert_geen_melding_op(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14", session_type="rest")])
        self.assertIsNone(reminders.session_today(sb, 1, TODAY, MIDDAG))

    def test_een_al_afgeronde_sessie_ook_niet(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14", status="completed")])
        self.assertIsNone(reminders.session_today(sb, 1, TODAY, MIDDAG))

    def test_de_worker_draait_elk_half_uur_maar_meldt_een_keer(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14")])
        reminders.session_today(sb, 1, TODAY, MIDDAG)
        reminders.session_today(sb, 1, TODAY, MIDDAG + 1)
        self.assertEqual(len(sb.rows["notifications"]), 1)


class FeedbackVraagTest(unittest.TestCase):
    def test_een_gelopen_sessie_zonder_feedback_wordt_gevraagd(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-13", status="completed", activity_id=99)]
        )
        self.assertIsNotNone(reminders.feedback_request(sb, 1, TODAY))
        self.assertEqual(_kinds(sb), ["feedback_request"])

    def test_met_feedback_erbij_blijft_het_stil(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-13", status="completed", activity_id=99)],
            session_feedback=[{"id": 7, "plan_session_id": 1}],
        )
        self.assertIsNone(reminders.feedback_request(sb, 1, TODAY))

    def test_een_sessie_zonder_gekoppelde_activiteit_telt_niet(self) -> None:
        """Zonder activiteit is niet bewezen dat hij gelopen is."""
        sb = _store(
            plan_sessions=[_session(1, "2026-08-13", status="completed", activity_id=None)]
        )
        self.assertIsNone(reminders.feedback_request(sb, 1, TODAY))

    def test_na_twee_dagen_vragen_we_niet_meer(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-05", status="completed", activity_id=99)]
        )
        self.assertIsNone(reminders.feedback_request(sb, 1, TODAY))

    def test_twee_open_sessies_leveren_een_melding_op(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-13", status="completed", activity_id=99),
                _session(2, "2026-08-12", status="completed", activity_id=98),
            ]
        )
        reminders.feedback_request(sb, 1, TODAY)
        self.assertEqual(len(sb.rows["notifications"]), 1)
        self.assertIn("+1 meer", sb.rows["notifications"][0]["body"])


class TokenWaarschuwingTest(unittest.TestCase):
    WARNING = {
        "days_since_login": 155,
        "days_remaining": 25,
        "action": "Draai scripts/garmin_login.py opnieuw.",
    }

    def test_de_waarschuwing_bevat_de_getallen_en_de_actie(self) -> None:
        sb = _store()
        reminders.token_warning(sb, self.WARNING, TODAY)
        body = sb.rows["notifications"][0]["body"]
        self.assertIn("155", body)
        self.assertIn("25", body)
        self.assertIn("garmin_login.py", body)

    def test_hoogstens_een_keer_per_week(self) -> None:
        """Dit speelt over maanden; dagelijks herhalen leert je wegvegen."""
        sb = _store()
        reminders.token_warning(sb, self.WARNING, TODAY)
        reminders.token_warning(sb, self.WARNING, TODAY + timedelta(days=2))
        self.assertEqual(len(sb.rows["notifications"]), 1)


class SamenTest(unittest.TestCase):
    def test_run_all_meldt_alles_wat_aan_de_beurt_is(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-14"),
                _session(2, "2026-08-13", status="completed", activity_id=99),
            ]
        )
        verstuurd = reminders.run_all(sb, 1, TODAY, MIDDAG)
        self.assertEqual(set(verstuurd), {"session_today", "feedback_request"})

    def test_zonder_plan_valt_er_niets_te_melden(self) -> None:
        sb = _store()
        self.assertEqual(reminders.run_all(sb, None, TODAY, MIDDAG), [])


if __name__ == "__main__":
    unittest.main()
