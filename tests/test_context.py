from __future__ import annotations

import unittest
from datetime import date

from tm_coach.context import _habitual_days, _hr_pace_curve


def _run(day: str, *, distance_m: int = 10000, duration_s: int = 3000, avg_hr: int | None = None):
    return {
        "start_time_local": f"{day}T07:30:00",
        "distance_m": distance_m,
        "duration_s": duration_s,
        "avg_hr": avg_hr,
    }


class GewoontedagenTest(unittest.TestCase):
    """Het schema plande een vrijdag; in de historie loopt hij dan bijna nooit."""

    def test_de_dagen_waarop_hij_werkelijk_loopt_komen_bovendrijven(self) -> None:
        # Ongeveer zijn werkelijke verdeling: dinsdag, donderdag, zondag en
        # zaterdag dragen de week; maandag, woensdag en vrijdag bijna niet.
        runs = [_run(day) for day in ("2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25")]
        runs += [_run(day) for day in ("2026-08-06", "2026-08-13", "2026-08-20", "2026-08-27")]
        runs += [_run(day) for day in ("2026-08-02", "2026-08-09", "2026-08-16")]  # zondag
        runs += [_run(day) for day in ("2026-08-01", "2026-08-08", "2026-08-15")]  # zaterdag
        runs += [_run("2026-08-03"), _run("2026-08-05"), _run("2026-08-07")]  # ma, wo, vr

        habits = _habitual_days(runs)
        assert habits is not None
        self.assertEqual(
            set(habits["habitual"]), {"tuesday", "thursday", "sunday", "saturday"}
        )
        self.assertEqual(set(habits["rare"]), {"monday", "wednesday", "friday"})
        self.assertEqual(habits["runs"], 17)
        self.assertAlmostEqual(habits["share_by_day"]["tuesday"], 0.235, places=2)

    def test_te_weinig_runs_levert_geen_uitspraak_op(self) -> None:
        self.assertIsNone(_habitual_days([_run("2026-08-04"), _run("2026-08-06")]))

    def test_onleesbare_datum_laat_de_rest_staan(self) -> None:
        runs = [_run(f"2026-08-{d:02d}") for d in (4, 6, 11, 13, 18, 20, 25, 27, 2, 9, 16, 23)]
        runs.append({"start_time_local": None, "distance_m": 5000, "duration_s": 1500})
        self.assertIsNotNone(_habitual_days(runs))


class HartslagTempoKrommeTest(unittest.TestCase):
    def test_de_kromme_geeft_per_bucket_een_mediaan(self) -> None:
        runs = [
            _run("2026-08-01", distance_m=10000, duration_s=3900, avg_hr=136),  # 6:30
            _run("2026-08-02", distance_m=10000, duration_s=3840, avg_hr=138),  # 6:24
            _run("2026-08-03", distance_m=10000, duration_s=3300, avg_hr=152),  # 5:30
            _run("2026-08-04", distance_m=10000, duration_s=3360, avg_hr=155),  # 5:36
            _run("2026-08-05", distance_m=10000, duration_s=3000, avg_hr=172),  # 5:00
            _run("2026-08-06", distance_m=10000, duration_s=3060, avg_hr=175),  # 5:06
        ]
        curve = _hr_pace_curve(runs, date(2026, 8, 14))
        assert curve is not None
        self.assertEqual([p["hr_from"] for p in curve["points"]], [130, 150, 170])
        self.assertEqual(curve["points"][0]["median_pace_s_per_km"], 390)
        # 390 -> 306 s/km over 40 bpm = 21 s/km per 10 bpm.
        self.assertEqual(curve["s_per_km_per_10bpm"], 21.0)

    def test_een_bucket_met_een_enkele_run_telt_niet_mee(self) -> None:
        runs = [
            _run("2026-08-01", duration_s=3900, avg_hr=136),
            _run("2026-08-02", duration_s=3840, avg_hr=138),
            _run("2026-08-03", duration_s=3300, avg_hr=152),
            _run("2026-08-04", duration_s=3360, avg_hr=155),
            _run("2026-08-05", duration_s=3000, avg_hr=172),
            _run("2026-08-06", duration_s=3060, avg_hr=175),
            _run("2026-08-07", duration_s=2700, avg_hr=185),
        ]
        curve = _hr_pace_curve(runs, date(2026, 8, 14))
        assert curve is not None
        self.assertNotIn(180, [p["hr_from"] for p in curve["points"]])

    def test_korte_runs_en_runs_zonder_hartslag_vallen_af(self) -> None:
        runs = [
            _run("2026-08-01", distance_m=800, duration_s=300, avg_hr=140),
            _run("2026-08-02", duration_s=3000, avg_hr=None),
            _run("2026-08-03", duration_s=3000, avg_hr=150),
        ]
        self.assertIsNone(_hr_pace_curve(runs, date(2026, 8, 14)))

    def test_te_weinig_buckets_levert_geen_kromme_op(self) -> None:
        runs = [
            _run("2026-08-01", duration_s=3900, avg_hr=136),
            _run("2026-08-02", duration_s=3840, avg_hr=138),
        ]
        self.assertIsNone(_hr_pace_curve(runs, date(2026, 8, 14)))

    def test_een_verse_kromme_is_niet_verouderd(self) -> None:
        runs = [
            _run("2026-08-01", duration_s=3900, avg_hr=136),
            _run("2026-08-02", duration_s=3840, avg_hr=138),
            _run("2026-08-03", duration_s=3300, avg_hr=152),
            _run("2026-08-04", duration_s=3360, avg_hr=155),
            _run("2026-08-05", duration_s=3000, avg_hr=172),
            _run("2026-08-06", duration_s=3060, avg_hr=175),
        ]
        curve = _hr_pace_curve(runs, date(2026, 8, 14))
        assert curve is not None
        self.assertFalse(curve["stale"])
        self.assertEqual(curve["age_days"], 8)

    def test_een_oude_kromme_waarschuwt_voor_zichzelf(self) -> None:
        """De historie van deze atleet ligt vóór zijn blessure. Bruikbaar voor
        het schatten van duur, nooit als tempobron."""
        runs = [
            _run("2025-10-01", duration_s=3900, avg_hr=136),
            _run("2025-10-02", duration_s=3840, avg_hr=138),
            _run("2025-10-03", duration_s=3300, avg_hr=152),
            _run("2025-10-04", duration_s=3360, avg_hr=155),
            _run("2025-10-05", duration_s=3000, avg_hr=172),
            _run("2025-10-06", duration_s=3060, avg_hr=175),
        ]
        curve = _hr_pace_curve(runs, date(2026, 8, 14))
        assert curve is not None
        self.assertTrue(curve["stale"])
        self.assertIn("nooit als tempobron", curve["note"])

    def test_onmogelijke_tempos_worden_genegeerd(self) -> None:
        """Een 'run' van 10 km in 20 minuten is een GPS-fout, geen wereldrecord."""
        runs = [
            _run("2026-08-01", distance_m=10000, duration_s=1200, avg_hr=136),
            _run("2026-08-02", distance_m=10000, duration_s=3840, avg_hr=138),
            _run("2026-08-03", distance_m=10000, duration_s=3900, avg_hr=139),
        ]
        curve = _hr_pace_curve(runs, date(2026, 8, 14))
        self.assertIsNone(curve)


if __name__ == "__main__":
    unittest.main()
