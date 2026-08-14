"""Context samenstellen voor de coach.

Compact houden is geen optimalisatie maar een ontwerpeis: het model plant beter
op twintig goede getallen dan op duizend ruwe rijen, en elke rij die je meestuurt
betaal je bij elke aanroep opnieuw.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from supabase import Client

from tm_sync import clock

from tm_sync import compliance

RECENT_DAYS = 21
RECENT_WEEKS = 10


def _one(sb: Client, table: str, columns: str = "*", **filters: Any) -> dict | None:
    q = sb.table(table).select(columns)
    for key, value in filters.items():
        q = q.eq(key, value)
    rows = q.limit(1).execute().data
    return rows[0] if rows else None


def build_context(sb: Client, goal: dict[str, Any], weeks_to_plan: int) -> dict[str, Any]:
    today = clock.today()

    profile = _one(sb, "athlete_profile") or {}

    daily = (
        sb.table("daily_metrics")
        .select("day, distance_m, duration_s, session_count, load, zone1_s, zone2_s, zone3_s, zone4_s, zone5_s")
        .gte("day", (today - timedelta(days=RECENT_DAYS)).isoformat())
        .order("day")
        .execute()
        .data
    )

    weekly = (
        sb.table("weekly_metrics")
        .select(
            "week_start, distance_m, session_count, easy_share, acute_load, "
            "chronic_load, acwr, monotony, avg_sleep_s, sleep_debt_s, "
            "avg_readiness, hrv_unbalanced_days"
        )
        .order("week_start", desc=True)
        .limit(RECENT_WEEKS)
        .execute()
        .data
    )
    weekly.reverse()

    wellness = (
        sb.table("wellness_daily")
        .select(
            "day, sleep_total_s, hrv_last_night_avg, hrv_status, "
            "training_readiness_score, training_readiness_level, resting_hr"
        )
        .gte("day", (today - timedelta(days=RECENT_DAYS)).isoformat())
        .order("day")
        .execute()
        .data
    )

    estimates = {
        row["scope"]: row
        for row in sb.table("fitness_estimates")
        .select("*")
        .order("day", desc=True)
        .limit(10)
        .execute()
        .data
    }

    predictions = (
        sb.table("fitness_snapshots")
        .select("day, race_predictions, vo2max_running")
        .not_.is_("race_predictions", "null")
        .order("day", desc=True)
        .limit(1)
        .execute()
        .data
    )

    rules = (
        sb.table("coach_rules")
        .select("key, class, status, title, params, param_bounds, condition, action, user_pinned")
        .in_("status", ["active", "proposed"])
        .execute()
        .data
    )

    feedback = (
        sb.table("session_feedback")
        .select(
            "id, plan_session_id, activity_id, created_at, pain_score, "
            "endurance_score, extra, notes"
        )
        .order("created_at", desc=True)
        .limit(10)
        .execute()
        .data
    )

    feedback_session_ids = [
        int(row["plan_session_id"])
        for row in feedback
        if row.get("plan_session_id") is not None
    ]
    feedback_sessions: dict[int, dict[str, Any]] = {}
    if feedback_session_ids:
        rows = (
            sb.table("plan_sessions")
            .select("id, day, title, session_type, targets")
            .in_("id", feedback_session_ids)
            .execute()
            .data
        )
        feedback_sessions = {int(row["id"]): row for row in rows}

    for row in feedback:
        session_id = row.get("plan_session_id")
        session = feedback_sessions.get(int(session_id)) if session_id is not None else None
        if session:
            row["planned_session"] = {
                "day": session.get("day"),
                "title": session.get("title"),
                "session_type": session.get("session_type"),
            }
            row["target_compliance"] = (session.get("targets") or {}).get("compliance")

    repeated_misses = compliance.consecutive_heavy_misses(feedback, feedback_sessions)

    # Alle Garmin-sporten blijven coachcontext. Afstanden van zwemmen, fietsen,
    # wandelen enz. zijn niet vergelijkbaar met hardloopkilometers, maar hun
    # duur, hartslagzones en Garmins eigen Training Load zijn wel herstelkosten.
    recent_activities_raw = (
        sb.table("activities")
        .select(
            "sport, sub_sport, name, start_time_local, duration_s, distance_m, "
            "avg_hr, raw"
        )
        .gte(
            "start_time_local",
            (today - timedelta(days=RECENT_DAYS)).isoformat(),
        )
        .order("start_time_local", desc=True)
        .execute()
        .data
    )

    activity_mix: dict[str, dict[str, Any]] = {}
    recent_activities: list[dict[str, Any]] = []
    for activity in recent_activities_raw:
        raw = activity.get("raw") or {}
        load_value = raw.get("activityTrainingLoad")
        try:
            training_load = round(float(load_value), 1) if load_value is not None else None
        except (TypeError, ValueError):
            training_load = None

        sport = str(activity.get("sport") or "other")
        slot = activity_mix.setdefault(
            sport,
            {"sessions": 0, "duration_s": 0, "training_load": 0.0},
        )
        slot["sessions"] += 1
        slot["duration_s"] += round(float(activity.get("duration_s") or 0))
        if training_load is not None:
            slot["training_load"] = round(slot["training_load"] + training_load, 1)

        recent_activities.append(
            {
                "day": str(activity.get("start_time_local") or "")[:10],
                "sport": sport,
                "garmin_type": activity.get("sub_sport"),
                "name": activity.get("name"),
                "duration_s": round(float(activity.get("duration_s") or 0)),
                "distance_m": round(float(activity.get("distance_m") or 0)),
                "avg_hr": activity.get("avg_hr"),
                "garmin_training_load": training_load,
            }
        )

    last_run = (
        sb.table("activities")
        .select("start_time_local, distance_m, duration_s, avg_hr")
        .eq("sport", "running")
        .order("start_time", desc=True)
        .limit(1)
        .execute()
        .data
    )
    days_since_run = None
    if last_run:
        days_since_run = (today - date.fromisoformat(str(last_run[0]["start_time_local"])[:10])).days

    params = goal.get("params") or {}

    def requested_date(key: str, fallback: date) -> date:
        try:
            value = date.fromisoformat(str(params.get(key) or ""))
        except ValueError:
            return fallback
        return max(value, fallback)

    plan_start = requested_date("plan_start_date", today)
    first_training_date = (
        requested_date("first_training_date", plan_start)
        if params.get("first_training_date")
        else None
    )
    first_monday = plan_start - timedelta(days=plan_start.weekday())
    first_week_is_partial = plan_start > first_monday

    active_plan_rows = (
        sb.table("plans")
        .select("id")
        .eq("status", "active")
        .limit(1)
        .execute()
        .data
    )
    active_next_7d: list[dict[str, Any]] = []
    if active_plan_rows:
        active_next_7d = (
            sb.table("plan_sessions")
            .select(
                "day, sport, session_type, title, planned_distance_m, "
                "planned_duration_s"
            )
            .eq("plan_id", active_plan_rows[0]["id"])
            .in_("status", ["planned", "moved"])
            .gte("day", today.isoformat())
            .lte("day", (today + timedelta(days=6)).isoformat())
            .order("day")
            .execute()
            .data
        )

    # Voorgerekende grenzen. Het model is de coach, niet de rekenmachine: laat
    # het afleiden welke week de referentie is en het rekent er een keer naast,
    # wat een volledige herkansing kost (~$0,45 op Opus 5).
    rules_by_key = {r["key"]: r for r in rules}
    ramp_pct = float(
        (rules_by_key.get("weekly_volume_ramp_cap", {}).get("params") or {}).get(
            "max_increase_pct", 10
        )
    )
    reference = next(
        (w for w in reversed(weekly) if (w.get("distance_m") or 0) > 0), None
    )
    ref_distance = float(reference["distance_m"]) if reference else 0.0

    sleeps = [
        float(w["sleep_total_s"]) for w in wellness[-7:] if w.get("sleep_total_s")
    ]
    sleep_7d_avg_h = round(sum(sleeps) / len(sleeps) / 3600.0, 2) if sleeps else None

    zones = profile.get("hr_zones") or []
    zone2_high = next((z["high"] for z in zones if z.get("zone") == 2), None)

    # Zelfgerapporteerde capaciteit: wat de atleet nu pijnvrij aankan. Dit is
    # actuele informatie die nergens in de Garmin-data zit — één losse run van
    # vorige maand zegt niets over wat hij vandaag kan.
    capacity_m = float(params.get("current_capacity_m") or 0)
    sessions_pw = float(params.get("sessions_per_week") or 3)

    # Instapplafond: drie à vier rustige runs op comfortabele afstand is een
    # verdedigbaar startpunt. Zonder opgegeven capaciteit valt hij terug op de
    # oude, veel conservatievere berekening uit het feitelijke weekvolume.
    ratio_based = ref_distance * (1 + ramp_pct / 100.0)
    capacity_based = capacity_m * sessions_pw if capacity_m else 0.0
    entry_ceiling = max(ratio_based, capacity_based)

    # Trainingsbasis: heeft hij recent genoeg gelopen om intensiteit te dragen?
    # Bepaalt of de variatieregel geldt of dat dit nog een terugkeerblok is.
    runs_last_21d = sum(1 for activity in recent_activities if activity["sport"] == "running")
    non_running = [activity for activity in recent_activities if activity["sport"] != "running"]
    current_next_7d_distance_m = round(
        sum(
            float(session.get("planned_distance_m") or 0)
            for session in active_next_7d
            if session.get("sport") == "running"
        )
    )
    # "Niet groeien bij weinig slaap" betekent het huidige trainingsniveau
    # vasthouden, niet terugvallen naar de afstand van één losse historische
    # run. Bij een actief plan is diens komende zeven dagen daarom de relevante
    # bovengrens; alleen zonder plan vallen we terug op werkelijk weekvolume.
    sleep_volume_ceiling_next_7d_m = (
        current_next_7d_distance_m or round(ref_distance)
    )
    repeated_reduction_required = len(repeated_misses) == 2
    repeated_reduction_ceiling_m = (
        round(current_next_7d_distance_m * 0.85)
        if repeated_reduction_required
        else None
    )

    constraints = {
        "runs_last_21d": runs_last_21d,
        "reference_week": reference["week_start"] if reference else None,
        "reference_week_distance_m": round(ref_distance),
        "stated_capacity_m": round(capacity_m) or None,
        "sessions_per_week": sessions_pw,
        "plan_start_date": plan_start.isoformat(),
        "first_training_date": first_training_date.isoformat() if first_training_date else None,
        "entry_week_ceiling_m": round(entry_ceiling),
        "first_week_is_partial": first_week_is_partial,
        "first_week_days_remaining": 7 - plan_start.weekday(),
        "max_weekly_increase_pct": ramp_pct,
        "easy_hr_cap": zone2_high,
        "sleep_7d_avg_h": sleep_7d_avg_h,
        "sleep_volume_ceiling_next_7d_m": sleep_volume_ceiling_next_7d_m,
        "non_running_sessions_last_21d": len(non_running),
        "non_running_duration_s_last_21d": sum(
            int(activity["duration_s"] or 0) for activity in non_running
        ),
        "non_running_training_load_last_21d": round(
            sum(float(activity["garmin_training_load"] or 0) for activity in non_running),
            1,
        ),
        "repeated_heavy_target_misses": repeated_reduction_required,
        "target_miss_evidence": [
            {
                "day": item["session"].get("day"),
                "title": item["session"].get("title"),
                "rpe": (item["feedback"].get("extra") or {}).get("rpe"),
                "endurance_score": item["feedback"].get("endurance_score"),
                "compliance": item["compliance"],
            }
            for item in repeated_misses
        ],
        "current_plan_next_7d_distance_m": current_next_7d_distance_m,
        "target_miss_next_7d_ceiling_m": repeated_reduction_ceiling_m,
        "note": (
            "entry_week_ceiling_m is het plafond voor de EERSTE geplande week en komt "
            "uit de aangetoonde capaciteit, niet uit het recente weekvolume: de "
            "ramp-rate bepaalt hoe snel je groeit, niet waar je begint. Elke volgende "
            "week mag maximaal max_weekly_increase_pct boven de vorige geplande week. "
            "Als first_week_is_partial waar is, is die onvolledige kalenderweek GEEN "
            "ramp-ratebasis: de eerste volledige week mag opnieuw tot het "
            "entry_week_ceiling_m worden gevuld. Pas daarna geldt de procentuele groei. "
            "Bij stated_capacity_m van 3 km of meer is wandel-loop niet nodig; begin "
            "met aaneengesloten rustige runs. De HR-bovengrens en de pijnregel blijven "
            "onverkort gelden. Bij te weinig slaap is "
            "sleep_volume_ceiling_next_7d_m het maximum voor de KOMENDE ZEVEN DAGEN; "
            "dat bevriest het huidige niveau en is geen terugval naar beginnersvolume."
        ),
    }

    return {
        "today": today.isoformat(),
        "plan_window": {
            "first_week_start": first_monday.isoformat(),
            "plan_start_date": plan_start.isoformat(),
            "first_training_date": first_training_date.isoformat() if first_training_date else None,
            "weeks": weeks_to_plan,
        },
        "athlete": {
            "max_hr": profile.get("max_hr"),
            "resting_hr": profile.get("resting_hr"),
            "lactate_threshold_hr": profile.get("lactate_threshold_hr"),
            "hr_zones": profile.get("hr_zones"),
            "zones_note": (
                "Zonegrenzen zoals Garmin ze toepast op hardlopen. Zone 4 ligt "
                "onder de lactaatdrempel; 'rustig' betekent hier onder de bovengrens "
                "van zone 2."
            ),
        },
        "goal": {
            "type": goal["goal_type"],
            "name": goal["name"],
            "target_date": goal.get("target_date"),
            "target_distance_m": goal.get("target_distance_m"),
            "target_time_s": goal.get("target_time_s"),
            "params": goal.get("params"),
        },
        "status": {
            "days_since_last_run": days_since_run,
            "last_run": last_run[0] if last_run else None,
        },
        "constraints": constraints,
        "fitness": {
            "current": estimates.get("current"),
            "historical": estimates.get("historical"),
            "garmin_predictions": predictions[0] if predictions else None,
            "note": (
                "current komt uit de eigen runs met sample_size erbij; "
                "garmin_predictions is VO2max-gebaseerd. Wijken ze af, neem de "
                "conservatieve en zeg dat. historical is context, geen doel."
            ),
        },
        "recent_days": daily,
        "recent_activity_mix": activity_mix,
        "recent_activities": recent_activities,
        "recent_wellness": wellness,
        "recent_weeks": weekly,
        "rules": rules,
        "recent_feedback": feedback,
    }
