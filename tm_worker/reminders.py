"""Meldingen die uit een toestand volgen in plaats van uit een gebeurtenis.

Het verschil met `adjust.py` is dat hier niets verandert: deze module kijkt en
meldt. Alles is idempotent via `dedupe_key`, want de worker draait elk half uur
en ziet dan telkens dezelfde dag opnieuw.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from supabase import Client

from tm_sync import notify

log = logging.getLogger(__name__)

# Vóór dit uur is een herinnering voor vandaag geen dienst maar een wekker.
MORNING_HOUR = 7

# Hoe lang na een run de feedbackvraag nog zinvol is. Daarna weet je het niet
# meer goed genoeg om er een oordeel op te bouwen.
FEEDBACK_WINDOW_DAYS = 2


def _hhmm(seconds: float | None) -> str:
    if not seconds:
        return ""
    minutes = int(round(float(seconds) / 60))
    return f"{minutes} min"


def session_today(sb: Client, plan_id: int, today: date, hour: int) -> int | None:
    """Wat staat er vandaag op het programma?"""
    if hour < MORNING_HOUR:
        return None

    sessions = (
        sb.table("plan_sessions")
        .select("id, day, title, session_type, planned_distance_m, planned_duration_s, hr_cap")
        .eq("plan_id", plan_id)
        .eq("day", today.isoformat())
        .in_("status", ["planned", "moved"])
        .neq("session_type", "rest")
        .order("id")
        .execute()
        .data
    )
    if not sessions:
        return None

    session = sessions[0]
    distance = float(session.get("planned_distance_m") or 0)
    omvang = (
        f"{distance / 1000:.1f} km".replace(".", ",")
        if distance
        else _hhmm(session.get("planned_duration_s"))
    )
    plafond = f" onder {session['hr_cap']} bpm" if session.get("hr_cap") else ""
    rest = f" (+{len(sessions) - 1} meer)" if len(sessions) > 1 else ""

    return notify.send(
        sb,
        kind="session_today",
        title="Vandaag op het programma",
        body=f"{session['title']} — {omvang}{plafond}.{rest}",
        url="/",
        dedupe_key=f"session_today:{today.isoformat()}",
        data={"session_id": session["id"], "session_type": session["session_type"]},
    )


def feedback_request(sb: Client, plan_id: int, today: date) -> int | None:
    """Een gelopen sessie zonder feedback is een gemiste meting.

    Zonder feedback weet de coach alleen wat de klok zag, niet hoe het voelde —
    en juist dat oordeel voedt de pijnregel en de doelcontrole.
    """
    since = (today - timedelta(days=FEEDBACK_WINDOW_DAYS)).isoformat()
    done = (
        sb.table("plan_sessions")
        .select("id, day, title")
        .eq("plan_id", plan_id)
        .eq("status", "completed")
        .not_.is_("activity_id", "null")
        .gte("day", since)
        .lte("day", today.isoformat())
        .order("day", desc=True)
        .execute()
        .data
    )
    if not done:
        return None

    ids = [int(row["id"]) for row in done]
    beantwoord = {
        int(row["plan_session_id"])
        for row in (
            sb.table("session_feedback")
            .select("plan_session_id")
            .in_("plan_session_id", ids)
            .execute()
            .data
        )
        if row.get("plan_session_id") is not None
    }
    open_sessies = [row for row in done if int(row["id"]) not in beantwoord]
    if not open_sessies:
        return None

    oudste = open_sessies[-1]
    rest = f" (+{len(open_sessies) - 1} meer)" if len(open_sessies) > 1 else ""
    return notify.send(
        sb,
        kind="feedback_request",
        title="Hoe ging het?",
        body=f"{oudste['title']} van {oudste['day']} wacht nog op je feedback.{rest}",
        url="/",
        dedupe_key=f"feedback_request:{oudste['id']}",
        data={"session_id": oudste["id"], "open": len(open_sessies)},
    )


def token_warning(sb: Client, warning: dict[str, Any], today: date) -> int | None:
    """Verlopende Garmin-tokens: het enige dat de hele lus stilzet.

    Eén melding per week is genoeg — dit speelt over maanden, niet over dagen,
    en een dagelijkse herhaling leert je alleen ze weg te vegen.
    """
    week = today.isocalendar()
    return notify.send(
        sb,
        kind="sync_problem",
        title="Garmin-koppeling verloopt",
        body=(
            f"Je tokens zijn {warning['days_since_login']} dagen oud en nog ongeveer "
            f"{warning['days_remaining']} dagen geldig. {warning['action']}"
        ),
        url="/profiel",
        dedupe_key=f"token_warning:{week.year}-W{week.week:02d}",
        data=dict(warning),
    )


def run_all(
    sb: Client,
    plan_id: int | None,
    today: date,
    hour: int,
    *,
    token: dict[str, Any] | None = None,
) -> list[str]:
    """Alle toestandsmeldingen in één keer. Geeft terug wat er verstuurd is."""
    verstuurd: list[str] = []
    if plan_id is not None:
        if session_today(sb, plan_id, today, hour) is not None:
            verstuurd.append("session_today")
        if feedback_request(sb, plan_id, today) is not None:
            verstuurd.append("feedback_request")
    if token and token_warning(sb, token, today) is not None:
        verstuurd.append("sync_problem")
    return verstuurd
