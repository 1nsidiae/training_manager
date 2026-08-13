from __future__ import annotations

import json
import tempfile
import unittest
import unittest.mock
from datetime import datetime, timedelta, timezone
from pathlib import Path

from tm_sync import tokens
from tm_worker import heartbeat


def _stamp(store: Path, days_ago: float) -> None:
    when = datetime.now(timezone.utc) - timedelta(days=days_ago)
    (store / tokens.STAMP_NAME).write_text(
        json.dumps({"logged_in_at": when.isoformat()}), encoding="utf-8"
    )


class TokenExpiryTest(unittest.TestCase):
    def test_no_stamp_stays_silent(self) -> None:
        """Liever geen waarschuwing dan een verzonnen einddatum.

        De refresh-token van Garmin is ondoorzichtig, dus zonder stempel weten
        we het simpelweg niet.
        """
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(tokens.days_since_login(tmp))
            self.assertIsNone(tokens.expiry_warning(tmp))

    def test_fresh_login_stays_silent(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _stamp(Path(tmp), days_ago=10)
            self.assertIsNone(tokens.expiry_warning(tmp))

    def test_warns_before_expiry_with_days_left(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _stamp(Path(tmp), days_ago=tokens.WARN_AFTER_DAYS + 5)
            warning = tokens.expiry_warning(tmp)
            assert warning is not None
            self.assertFalse(warning["expired"])
            # 180 - 155 = 25 dagen om lokaal opnieuw in te loggen.
            self.assertEqual(warning["days_remaining"], 25)

    def test_marks_expired_past_the_window(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            _stamp(Path(tmp), days_ago=tokens.EXPIRED_AFTER_DAYS + 3)
            warning = tokens.expiry_warning(tmp)
            assert warning is not None
            self.assertTrue(warning["expired"])

    def test_write_stamp_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tokens.write_stamp(tmp)
            age = tokens.days_since_login(tmp)
            assert age is not None
            self.assertLess(age, 0.01)

    def test_corrupt_stamp_is_treated_as_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / tokens.STAMP_NAME).write_text("niet eens json", encoding="utf-8")
            self.assertIsNone(tokens.days_since_login(tmp))


class HeartbeatTest(unittest.TestCase):
    def test_beat_then_read_is_fresh(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "hb"
            with unittest.mock.patch.dict("os.environ", {"TM_WORKER_HEARTBEAT": str(target)}):
                heartbeat.beat()
                age = heartbeat.age_seconds()
            assert age is not None
            self.assertLess(age, 5)

    def test_missing_heartbeat_reads_as_unknown(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "bestaat-niet"
            with unittest.mock.patch.dict("os.environ", {"TM_WORKER_HEARTBEAT": str(target)}):
                self.assertIsNone(heartbeat.age_seconds())


if __name__ == "__main__":
    unittest.main()
