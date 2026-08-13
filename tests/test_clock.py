from __future__ import annotations

import unittest
import unittest.mock
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from tm_sync import clock
from tm_worker.loop import CALM_MINUTES, DENSE_MINUTES, next_interval_minutes

BRUSSELS = ZoneInfo("Europe/Brussels")


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Genoeg van de Supabase-client om next_interval_minutes te draaien."""

    def __init__(self, rows):
        self.rows = rows

    def select(self, *_):
        return self

    def order(self, *_, **__):
        return self

    def limit(self, *_):
        return self

    def execute(self):
        return _Result(self.rows)


class _Supabase:
    def __init__(self, rows=None):
        self.rows = rows or []

    def table(self, _name):
        return _Query(self.rows)


class ClockTest(unittest.TestCase):
    def test_local_day_differs_from_utc_just_after_midnight(self) -> None:
        """De kern van de bug: om 00:30 in Brussel is het in UTC nog gisteren.

        De worker draait op de VPS in UTC. `date.today()` gaf daar tussen
        middernacht en 02:00 de dag ervoor, waardoor de sessie van vandaag als
        gemist kon worden aangemerkt.
        """
        brussels_midnight = datetime(2026, 8, 14, 0, 30, tzinfo=BRUSSELS)
        self.assertEqual(brussels_midnight.date().isoformat(), "2026-08-14")
        self.assertEqual(brussels_midnight.astimezone(timezone.utc).date().isoformat(), "2026-08-13")

    def test_clock_now_is_timezone_aware(self) -> None:
        now = clock.now()
        self.assertIsNotNone(now.tzinfo, "zonder tzinfo valt hij terug op de systeemtijd")
        self.assertEqual(clock.today(), now.date())

    def test_timezone_is_configurable(self) -> None:
        with unittest.mock.patch.dict("os.environ", {"TM_TIMEZONE": "Pacific/Auckland"}):
            offset = clock.now().utcoffset()
        assert offset is not None
        self.assertGreaterEqual(offset.total_seconds() / 3600, 12)


class MorningWindowTest(unittest.TestCase):
    def test_seven_in_the_morning_is_dense(self) -> None:
        """07:00 Brusselse tijd hoort in het dichte venster.

        Op UTC was dat 05:00 en viel het er dus buiten: de worker pollde traag
        precies wanneer Garmin slaap en readiness uploadt.
        """
        now = datetime(2026, 8, 14, 7, 0, tzinfo=BRUSSELS)
        self.assertEqual(next_interval_minutes(_Supabase(), now), DENSE_MINUTES)

    def test_utc_reading_of_the_same_moment_would_have_missed_it(self) -> None:
        as_utc = datetime(2026, 8, 14, 7, 0, tzinfo=BRUSSELS).astimezone(timezone.utc)
        self.assertEqual(as_utc.hour, 5)
        self.assertEqual(next_interval_minutes(_Supabase(), as_utc), CALM_MINUTES)

    def test_afternoon_is_calm(self) -> None:
        now = datetime(2026, 8, 14, 14, 0, tzinfo=BRUSSELS)
        self.assertEqual(next_interval_minutes(_Supabase(), now), CALM_MINUTES)


if __name__ == "__main__":
    unittest.main()
