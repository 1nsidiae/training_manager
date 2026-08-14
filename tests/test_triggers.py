from __future__ import annotations

import unittest
from datetime import date

from tests.fake_supabase import FakeSB
from tm_worker import triggers

TODAY = date(2026, 8, 14)  # vrijdag, dus geen wekelijkse review

RULES = [
    {"key": "pain_score_override", "status": "active", "params": {"pain_threshold": 6}},
    {"key": "readiness_gate_quality", "status": "active", "params": {"min_readiness": 50}},
]


def _session(session_id: int, day: str, status: str = "planned", session_type: str = "easy"):
    return {
        "id": session_id,
        "plan_id": 1,
        "day": day,
        "status": status,
        "session_type": session_type,
        "title": "sessie",
        "targets": {},
    }


def _store(**tables):
    rows = {
        "coach_runs": [],
        "coach_rules": RULES,
        "plans": [{"id": 1, "goal_id": 3, "status": "active"}],
        "session_feedback": [],
        "plan_sessions": [],
        "wellness_daily": [],
        "activities": [],
    }
    rows.update(tables)
    return FakeSB(rows)


def _kinds(sb) -> list[str]:
    return [t.kind for t in triggers.detect(sb, TODAY)]


class AfdrijvingTest(unittest.TestCase):
    """Eén gemiste sessie is ruis, drie zijn een patroon."""

    def test_een_gemiste_sessie_kost_geen_modelaanroep(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-09-10"),
            ]
        )
        self.assertNotIn("plan_drift", _kinds(sb))

    def test_twee_gemiste_sessies_ook_niet(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-08-09", "skipped"),
                _session(3, "2026-09-10"),
            ]
        )
        self.assertNotIn("plan_drift", _kinds(sb))

    def test_drie_gemiste_sessies_rechtvaardigen_een_herplanning(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-08-09", "skipped"),
                _session(3, "2026-08-06", "skipped"),
                _session(4, "2026-09-10"),
            ]
        )
        found = triggers.detect(sb, TODAY)
        drift = next(t for t in found if t.kind == "plan_drift")
        self.assertIn("3 sessies gemist", drift.reason)

    def test_oude_missers_tellen_niet_mee(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-07-09", "skipped"),
                _session(3, "2026-07-06", "skipped"),
                _session(4, "2026-09-10"),
            ]
        )
        self.assertNotIn("plan_drift", _kinds(sb))

    def test_dezelfde_stand_start_niet_twee_keer_een_herplanning(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-08-09", "skipped"),
                _session(3, "2026-08-06", "skipped"),
                _session(4, "2026-09-10"),
            ],
            coach_runs=[{"trigger_key": "plan_drift:plan=1:missed=3"}],
        )
        self.assertNotIn("plan_drift", _kinds(sb))


class BlokEindeTest(unittest.TestCase):
    def test_een_aflopend_blok_vraagt_om_een_vervolg(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-18")])
        found = triggers.detect(sb, TODAY)
        block = next(t for t in found if t.kind == "block_end")
        self.assertIn("2026-08-18", block.reason)

    def test_een_blok_met_ruimte_blijft_met_rust(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-09-10")])
        self.assertNotIn("block_end", _kinds(sb))


class GeenTriggerMeerTest(unittest.TestCase):
    """Wat vroeger geld kostte en nu deterministisch wordt afgehandeld."""

    def test_ingevulde_feedback_start_geen_herplanning(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-09-10")],
            session_feedback=[
                {
                    "id": 9,
                    "plan_session_id": None,
                    "activity_id": None,
                    "pain_score": 2,
                    "endurance_score": 4,
                    "extra": {},
                    "created_at": "2026-08-14T07:00:00Z",
                }
            ],
        )
        self.assertEqual(_kinds(sb), [])

    def test_een_fietsrit_start_geen_herplanning(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-09-10")],
            activities=[
                {
                    "id": 5,
                    "sport": "cycling",
                    "sub_sport": None,
                    "name": "Fietsen",
                    "duration_s": 5400,
                    "start_time_local": "2026-08-14T09:00:00",
                    "raw": {"activityTrainingLoad": 120},
                }
            ],
        )
        self.assertEqual(_kinds(sb), [])


class AlarmBlijftTest(unittest.TestCase):
    def test_pijn_blijft_wel_een_alarm(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-09-10")],
            session_feedback=[
                {
                    "id": 9,
                    "plan_session_id": None,
                    "activity_id": None,
                    "pain_score": 7,
                    "endurance_score": 3,
                    "extra": {},
                    "created_at": "2026-08-14T07:00:00Z",
                }
            ],
        )
        self.assertEqual(_kinds(sb), ["alarm"])

    def test_alarm_gaat_voor_op_afdrijving(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "skipped"),
                _session(2, "2026-08-09", "skipped"),
                _session(3, "2026-08-06", "skipped"),
                _session(4, "2026-09-10"),
            ],
            wellness_daily=[
                {"day": "2026-08-13", "hrv_status": "UNBALANCED"},
                {"day": "2026-08-12", "hrv_status": "UNBALANCED"},
                {"day": "2026-08-11", "hrv_status": "UNBALANCED"},
            ],
        )
        self.assertEqual(_kinds(sb)[0], "alarm")


if __name__ == "__main__":
    unittest.main()
