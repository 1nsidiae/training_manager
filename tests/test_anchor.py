from __future__ import annotations

import unittest
from datetime import date

from tm_sync import anchor

VANDAAG = date(2026, 8, 14)
LTHR = 180.0

# Garmins voorspelling voor Jasper op 14 augustus 2026.
GARMIN = {"5k": 1505, "10k": 3257, "half": 7550, "marathon": 17250}


def _schatting(day: str, *, km5=None, km10=None, half=None, marathon=None, samples=1):
    return {
        "equiv_5k_s": km5,
        "equiv_10k_s": km10,
        "equiv_half_s": half,
        "equiv_marathon_s": marathon,
        "sample_size": samples,
        "basis": {"5k": {"date": day}},
    }


class InspanningsfilterTest(unittest.TestCase):
    def test_rustige_jog_telt_niet_als_prestatie(self) -> None:
        """De echte run die het anker onbruikbaar maakte.

        5 km op 6:08/km met hartslag 151 -- 84% van de drempel. Zolang die
        meetelde, luidde de schatting "5 km in 30:38" voor iemand die er een
        half jaar eerder 19:22 op stond.
        """
        self.assertFalse(anchor.is_effort({"avg_hr": 151}, LTHR))

    def test_tempoloop_telt_wel(self) -> None:
        self.assertTrue(anchor.is_effort({"avg_hr": 169}, LTHR))

    def test_zonder_hartslag_geven_we_het_voordeel_van_de_twijfel(self) -> None:
        """Liever een schatting met ruis dan helemaal geen bewijs."""
        self.assertTrue(anchor.is_effort({"avg_hr": None}, LTHR))
        self.assertTrue(anchor.is_effort({"avg_hr": 120}, None))


class BronkeuzeTest(unittest.TestCase):
    def test_zonder_eigen_bewijs_wint_garmin(self) -> None:
        row = anchor.build(own=None, garmin_predictions=GARMIN, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["basis"]["source"], "garmin")
        self.assertEqual(row["equiv_5k_s"], 1505)
        self.assertEqual(row["basis"]["confidence"], "medium")

    def test_alleen_historisch_is_lage_zekerheid(self) -> None:
        row = anchor.build(
            own=None,
            garmin_predictions=None,
            historical=_schatting("2025-10-19", km5=1162, marathon=13185, samples=73),
            today=VANDAAG,
        )
        assert row is not None
        self.assertEqual(row["basis"]["source"], "historical_aged")
        self.assertEqual(row["basis"]["confidence"], "low")
        self.assertEqual(row["basis"]["evidence_age_days"], 299)

    def test_zonder_enige_bron_geen_anker(self) -> None:
        """Geen getal is bruikbaarder dan een verzonnen getal."""
        self.assertIsNone(
            anchor.build(own=None, garmin_predictions=None, historical=None, today=VANDAAG)
        )


class ConservatiefSamenvoegenTest(unittest.TestCase):
    def test_de_langzaamste_van_de_twee_wint(self) -> None:
        """Een te optimistisch anker levert tempodoelen op die niemand haalt."""
        eigen = _schatting("2026-08-01", km5=1300)  # sneller dan Garmins 1505
        row = anchor.build(own=eigen, garmin_predictions=GARMIN, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["equiv_5k_s"], 1505)
        self.assertEqual(row["basis"]["source"], "own_effort+garmin")

    def test_eigen_bewijs_wint_als_het_voorzichtiger_is(self) -> None:
        eigen = _schatting("2026-08-01", km5=1700)
        row = anchor.build(own=eigen, garmin_predictions=GARMIN, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["equiv_5k_s"], 1700)

    def test_garmin_vult_de_afstanden_waar_eigen_bewijs_ontbreekt(self) -> None:
        """Riegel mag maar een factor drie extrapoleren.

        Een reeks runs van 5 km zegt niets over een halve of hele marathon.
        Zonder aanvulling bleven die leeg terwijl er wel een schatting was.
        """
        eigen = _schatting("2026-05-04", km5=1600, km10=3400)
        row = anchor.build(own=eigen, garmin_predictions=GARMIN, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["equiv_5k_s"], 1600)
        self.assertEqual(row["equiv_half_s"], 7550)
        self.assertEqual(row["equiv_marathon_s"], 17250)


class ZekerheidTest(unittest.TestCase):
    def test_vers_bewijs_met_meerdere_metingen_is_hoog(self) -> None:
        eigen = _schatting("2026-08-01", km5=1600, samples=3)
        row = anchor.build(own=eigen, garmin_predictions=None, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["basis"]["confidence"], "high")

    def test_oud_bewijs_zakt_naar_medium(self) -> None:
        """Jaspers situatie op 14 augustus: laatste inspanning van 4 mei."""
        eigen = _schatting("2026-05-04", km5=1600, samples=3)
        row = anchor.build(own=eigen, garmin_predictions=None, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["basis"]["evidence_age_days"], 102)
        self.assertEqual(row["basis"]["confidence"], "medium")

    def test_een_enkele_meting_is_nooit_hoog(self) -> None:
        eigen = _schatting("2026-08-13", km5=1600, samples=1)
        row = anchor.build(own=eigen, garmin_predictions=None, historical=None, today=VANDAAG)
        assert row is not None
        self.assertEqual(row["basis"]["confidence"], "medium")


if __name__ == "__main__":
    unittest.main()
