from __future__ import annotations

import unittest
from datetime import date

from tests.fake_supabase import FakeSB
from tm_worker import adjust

TODAY = date(2026, 8, 14)  # een vrijdag

RULES = [
    {"key": "pain_score_override", "status": "active", "params": {"pain_threshold": 6}},
    {"key": "readiness_gate_quality", "status": "active", "params": {"min_readiness": 50}},
]

PROFILE = [{"hr_zones": [{"zone": 1, "high": 120}, {"zone": 2, "high": 141}]}]


def _session(session_id: int, day: str, session_type: str, **extra):
    base = {
        "id": session_id,
        "plan_id": 1,
        "day": day,
        "session_type": session_type,
        "status": "planned",
        "title": f"{session_type} sessie",
        "description": "",
        "structure": {"steps": [{"type": "work", "pace_min_s_per_km": 290}]},
        "targets": {"target_type": "pace"},
        "hr_cap": None,
        "planned_distance_m": 10000,
        "planned_duration_s": None,
        "pushed_at": "2026-08-13T10:00:00Z",
        "garmin_workout_id": 55,
    }
    base.update(extra)
    return base


def _store(**tables):
    rows = {
        "coach_rules": RULES,
        "athlete_profile": PROFILE,
        "plan_sessions": [],
        "session_feedback": [],
        "wellness_daily": [],
        "plan_adjustments": [],
        "sync_log": [],
    }
    rows.update(tables)
    return FakeSB(rows)


class PijnregelTest(unittest.TestCase):
    """De regel die er al stond en nooit iets deed."""

    def test_pijn_maakt_van_intervaltraining_een_rustige_loop(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        changes = adjust.apply(sb, 1, TODAY)

        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0].rule, "pain_score_override")
        session = sb.row("plan_sessions", 1)
        self.assertEqual(session["session_type"], "easy")
        self.assertEqual(session["hr_cap"], 141)
        self.assertEqual(session["targets"]["target_type"], "hr")
        # 60% van 10 km: lichter, niet geschrapt.
        self.assertEqual(session["planned_distance_m"], 6000)

    def test_de_oorspronkelijke_sessie_blijft_bewaard(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "tempo")],
            session_feedback=[
                {"id": 9, "pain_score": 8, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        adjust.apply(sb, 1, TODAY)

        original = sb.row("plan_sessions", 1)["targets"]["downgraded_from"]
        self.assertEqual(original["session_type"], "tempo")
        self.assertEqual(original["planned_distance_m"], 10000)

    def test_pijn_raakt_ook_de_lange_duurloop(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-16", "long")],
            session_feedback=[
                {"id": 9, "pain_score": 6, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        self.assertEqual(len(adjust.apply(sb, 1, TODAY)), 1)

    def test_pijn_laat_een_easy_run_met_rust(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "easy", hr_cap=141)],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])

    def test_pijn_onder_de_drempel_verandert_niets(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 5, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])
        self.assertEqual(sb.row("plan_sessions", 1)["session_type"], "interval")

    def test_de_pijnrem_loopt_af(self) -> None:
        """Drie dagen na de melding staat intensiteit weer toe."""
        sb = _store(
            plan_sessions=[_session(1, "2026-08-18", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])

    def test_oude_pijnmelding_telt_niet_meer(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 9, "created_at": "2026-08-01T07:00:00Z"}
            ],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])


class ReadinessTest(unittest.TestCase):
    def test_lage_readiness_haalt_de_kwaliteit_van_vandaag_weg(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-14", "tempo")],
            wellness_daily=[{"day": "2026-08-14", "training_readiness_score": 38}],
        )
        changes = adjust.apply(sb, 1, TODAY)

        self.assertEqual([c.rule for c in changes], ["readiness_gate_quality"])
        session = sb.row("plan_sessions", 1)
        self.assertEqual(session["session_type"], "easy")
        self.assertEqual(session["planned_distance_m"], 7500)

    def test_readiness_raakt_alleen_vandaag(self) -> None:
        """Op de dagvorm van vandaag de rest van de week omgooien is precies
        het gedrag dat we hier afschaffen."""
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "tempo")],
            wellness_daily=[{"day": "2026-08-14", "training_readiness_score": 38}],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])

    def test_goede_readiness_laat_de_sessie_staan(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-14", "tempo")],
            wellness_daily=[{"day": "2026-08-14", "training_readiness_score": 72}],
        )
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])

    def test_zonder_readinessmeting_geen_ingreep(self) -> None:
        sb = _store(plan_sessions=[_session(1, "2026-08-14", "tempo")])
        self.assertEqual(adjust.apply(sb, 1, TODAY), [])


class BoekhoudingTest(unittest.TestCase):
    def test_de_ingreep_wordt_uitgelegd_met_cijfers(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        adjust.apply(sb, 1, TODAY)

        row = sb.rows["plan_adjustments"][0]
        self.assertEqual(row["rule"], "pain_score_override")
        self.assertEqual(row["severity"], "override")
        self.assertTrue(row["applied"])
        self.assertIn("7", row["explanation"]["nl"])
        self.assertEqual(row["evidence"]["threshold"], 6.0)

    def test_het_horloge_wordt_opnieuw_gevraagd(self) -> None:
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        adjust.apply(sb, 1, TODAY)

        jobs = [r["sync_type"] for r in sb.rows["sync_log"]]
        self.assertEqual(jobs, ["workout_reschedule:1"])

    def test_een_tweede_tick_doet_niets_dubbel(self) -> None:
        """De worker draait elk half uur; dezelfde pijn geldt drie dagen."""
        sb = _store(
            plan_sessions=[_session(1, "2026-08-15", "interval")],
            session_feedback=[
                {"id": 9, "pain_score": 7, "created_at": "2026-08-14T07:00:00Z"}
            ],
        )
        adjust.apply(sb, 1, TODAY)
        adjust.apply(sb, 1, TODAY)

        self.assertEqual(len(sb.rows["plan_adjustments"]), 1)
        self.assertEqual(len(sb.rows["sync_log"]), 1)
        # De tweede ronde vindt geen intervalsessie meer, dus het origineel
        # blijft het interval en niet de al verzachte versie.
        original = sb.row("plan_sessions", 1)["targets"]["downgraded_from"]
        self.assertEqual(original["session_type"], "interval")


class GemisteSessiesTest(unittest.TestCase):
    def test_alleen_gemiste_sessies_binnen_het_venster_tellen(self) -> None:
        sb = _store(
            plan_sessions=[
                _session(1, "2026-08-12", "easy", status="skipped"),
                _session(2, "2026-08-05", "easy", status="skipped"),
                _session(3, "2026-07-01", "easy", status="skipped"),
                _session(4, "2026-08-13", "easy", status="completed"),
                _session(5, "2026-08-13", "rest", status="skipped"),
            ],
        )
        missed = adjust.missed_recent(sb, 1, TODAY)
        self.assertEqual([m["id"] for m in missed], [1, 2])


if __name__ == "__main__":
    unittest.main()
