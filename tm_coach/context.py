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

# Beide vensters zijn ruim, en dat is een keuze. Deze atleet komt terug na een
# blessure: in de laatste 90 dagen staat één run, in het laatste jaar 23. Een
# krap venster levert dan niets op, en niets is hier slechter dan oud — want
# beide grootheden verouderen traag. Op welke weekdagen iemand loopt hangt aan
# werk en gezin, niet aan vorm. De verhouding tussen hartslag en tempo verschuift
# wel met vorm, en daarom draagt de kromme haar eigen leeftijd mee.
HABIT_DAYS = 365
HABIT_MIN_RUNS = 10

CURVE_DAYS = 365
CURVE_BUCKET_BPM = 10
CURVE_MIN_PER_BUCKET = 2

# Boven deze leeftijd beschrijft de kromme een lijf van toen. Bruikbaar om de
# duur van een sessie te schatten, niet om er een tempodoel op te bouwen.
CURVE_STALE_DAYS = 60

WEEKDAY_NAMES = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


def _one(sb: Client, table: str, columns: str = "*", **filters: Any) -> dict | None:
    q = sb.table(table).select(columns)
    for key, value in filters.items():
        q = q.eq(key, value)
    rows = q.limit(1).execute().data
    return rows[0] if rows else None


def _habitual_days(runs: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Op welke dagen loopt hij werkelijk?

    Een schema dat op vrijdag een tempoloop zet terwijl hij in negentig dagen
    twee keer op vrijdag liep, wordt niet gevolgd — en een schema dat niet
    gevolgd wordt, bewaakt niets meer. Dit is een waarneming, geen voorkeur die
    hij ergens heeft ingevuld, dus het model krijgt de cijfers erbij en mag
    ervan afwijken als het dat uitlegt.
    """
    counts = dict.fromkeys(WEEKDAY_NAMES, 0)
    for run in runs:
        day = str(run.get("start_time_local") or "")[:10]
        try:
            counts[WEEKDAY_NAMES[date.fromisoformat(day).weekday()]] += 1
        except ValueError:
            continue

    total = sum(counts.values())
    if total < HABIT_MIN_RUNS:
        return None

    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)
    return {
        "window_days": HABIT_DAYS,
        "runs": total,
        "share_by_day": {day: round(n / total, 3) for day, n in ranked},
        # Gemeten tegen een gelijke verdeling over de week: een dag is een
        # gewoonte als hij minstens zijn deel krijgt, en zeldzaam als hij nog
        # niet de helft daarvan haalt. Relatief, zodat de grens niet verschuift
        # met het aantal runs in het venster.
        "habitual": [day for day, n in ranked if n / total >= 1.0 / 7.0],
        "rare": [day for day, n in ranked if n / total < 0.5 / 7.0],
    }


def _hr_pace_curve(runs: list[dict[str, Any]], today: date) -> dict[str, Any] | None:
    """Wat kost een hartslag hem aan tempo?

    Hiermee weet het model wat een voorschrift in de praktijk betekent: "10 km
    rustig onder 141" is bij deze loper ruim een uur, niet de 55 minuten die je
    zou aannemen uit zijn 5 km-tijd. Zonder deze kromme schat het schema de
    duur van elke rustige sessie structureel te kort in.

    De vorm zegt zelf ook iets: ligt er weinig tempoverschil tussen een lage en
    een hoge hartslag, dan is de aerobe basis dun en is juist volume het middel.
    """
    buckets: dict[int, list[float]] = {}
    newest: date | None = None
    for run in runs:
        hr = run.get("avg_hr")
        distance = float(run.get("distance_m") or 0)
        duration = float(run.get("duration_s") or 0)
        if not hr or distance < 2000 or duration <= 0:
            continue
        pace = duration / (distance / 1000.0)
        if not (180 <= pace <= 600):  # 3:00 tot 10:00 per km
            continue
        buckets.setdefault(int(float(hr) // CURVE_BUCKET_BPM) * CURVE_BUCKET_BPM, []).append(pace)
        try:
            day = date.fromisoformat(str(run.get("start_time_local") or "")[:10])
        except ValueError:
            continue
        newest = max(newest, day) if newest else day

    points = []
    for low, paces in sorted(buckets.items()):
        if len(paces) < CURVE_MIN_PER_BUCKET:
            continue
        paces.sort()
        median = paces[len(paces) // 2]
        points.append(
            {
                "hr_from": low,
                "hr_to": low + CURVE_BUCKET_BPM - 1,
                "median_pace_s_per_km": round(median),
                "runs": len(paces),
            }
        )

    if len(points) < 3:
        return None

    slowest, fastest = points[0], points[-1]
    span_bpm = fastest["hr_from"] - slowest["hr_from"]
    span_pace = slowest["median_pace_s_per_km"] - fastest["median_pace_s_per_km"]
    age_days = (today - newest).days if newest else None
    stale = age_days is not None and age_days > CURVE_STALE_DAYS
    return {
        "window_days": CURVE_DAYS,
        "points": points,
        "s_per_km_per_10bpm": round(span_pace / (span_bpm / 10.0), 1) if span_bpm else None,
        "newest_run": newest.isoformat() if newest else None,
        "age_days": age_days,
        "stale": stale,
        "lowest_measured_hr": slowest["hr_from"],
        "note": (
            "Gemeten uit zijn eigen runs: mediaan tempo per hartslagbucket. Gebruik "
            "dit om de duur van een voorgeschreven sessie realistisch in te schatten "
            "en om te controleren of een tempodoel bij het HR-plafond past. Een vlakke "
            "kromme betekent dat harder lopen weinig tempo oplevert; dat is een reden "
            "voor volume, niet voor intensiteit. Extrapoleer NIET onder "
            f"lowest_measured_hr ({slowest['hr_from']}): daar is niet gemeten. Ligt het "
            "easy-plafond onder die grens, dan is dat zelf de bevinding — hij heeft "
            "in dit venster nooit echt rustig gelopen, en het eerste doel van het "
            "schema is dat wél laten gebeuren."
            + (
                " LET OP: stale is waar. Deze kromme beschrijft een eerdere vorm en "
                "is bijna zeker te optimistisch. Gebruik hem als bovengrens bij het "
                "schatten van duur — reken dus op trager — en nooit als tempobron; "
                "daarvoor blijft fitness.anchor de enige bron."
                if stale
                else ""
            )
        ),
    }


def build_context(
    sb: Client,
    goal: dict[str, Any],
    weeks_to_plan: int,
    *,
    freeze_until: date | None = None,
) -> dict[str, Any]:
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

    # Langer venster dan de rest van de context, en bewust alleen hardlopen:
    # hier gaat het om ritme en om de eigen hartslag-tempoverhouding, en die
    # zijn pas betrouwbaar over maanden.
    long_runs = (
        sb.table("activities")
        .select("start_time_local, distance_m, duration_s, avg_hr")
        .eq("sport", "running")
        .gte("start_time_local", (today - timedelta(days=CURVE_DAYS)).isoformat())
        .order("start_time_local", desc=True)
        .execute()
        .data
    )
    habit_cutoff = (today - timedelta(days=HABIT_DAYS)).isoformat()
    habitual_days = _habitual_days(
        [r for r in long_runs if str(r.get("start_time_local") or "")[:10] >= habit_cutoff]
    )
    if habitual_days:
        habitual_days["note"] = (
            "Geteld uit zijn eigen activiteiten, niet ingevuld. Een weekritme hangt "
            "aan werk en gezin en veroudert traag, dus dit venster is bewust ruim."
        )
    hr_pace_curve = _hr_pace_curve(long_runs, today)

    params = goal.get("params") or {}

    def requested_date(key: str, fallback: date) -> date:
        try:
            value = date.fromisoformat(str(params.get(key) or ""))
        except ValueError:
            return fallback
        return max(value, fallback)

    plan_start = requested_date("plan_start_date", today)

    # De toezeggingshorizon: wat al op het horloge staat voor deze week blijft
    # staan. Een schema dat woensdag zijn eigen donderdag omgooit is geen plan
    # maar een suggestie, en dan valt er niets meer te volgen of te meten.
    if freeze_until and freeze_until >= plan_start:
        plan_start = freeze_until + timedelta(days=1)

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
    frozen_sessions: list[dict[str, Any]] = []
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
        if freeze_until:
            frozen_sessions = [
                session
                for session in active_next_7d
                if str(session["day"]) <= freeze_until.isoformat()
            ]

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

    # De pijnregel stond actief in coach_rules maar werd nergens afgedwongen:
    # het model kreeg de drempel te zien en niets controleerde of het plan zich
    # eraan hield. Deze twee velden maken haar toetsbaar.
    pain_threshold = float(
        (rules_by_key.get("pain_score_override", {}).get("params") or {}).get(
            "pain_threshold", 6
        )
    )
    pain_signal = None
    for row in feedback:
        score = float(row.get("pain_score") or 0)
        if score < pain_threshold:
            continue
        signal_day = date.fromisoformat(str(row["created_at"])[:10])
        rest_until = signal_day + timedelta(days=3)
        if rest_until < today:
            break
        pain_signal = {
            "day": signal_day.isoformat(),
            "pain_score": score,
            "threshold": pain_threshold,
            "no_intensity_until": rest_until.isoformat(),
        }
        break

    readiness_min = float(
        (rules_by_key.get("readiness_gate_quality", {}).get("params") or {}).get(
            "min_readiness", 50
        )
    )
    today_readiness = next(
        (
            float(w["training_readiness_score"])
            for w in wellness
            if str(w["day"]) == today.isoformat()
            and w.get("training_readiness_score") is not None
        ),
        None,
    )
    low_readiness_today = (
        {"score": today_readiness, "threshold": readiness_min}
        if today_readiness is not None and today_readiness < readiness_min
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
        "pain_signal": pain_signal,
        "low_readiness_today": low_readiness_today,
        "habitual_training_days": habitual_days,
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
            "dat bevriest het huidige niveau en is geen terugval naar beginnersvolume. "
            "pain_signal en low_readiness_today zijn deterministisch vastgesteld en "
            "worden na jou opnieuw gecontroleerd; ga er niet overheen. "
            "habitual_training_days is waargenomen gedrag, geen opgegeven voorkeur: "
            "plan op de dagen waarop hij werkelijk loopt, tenzij je uitlegt waarom niet."
        ),
    }

    return {
        "today": today.isoformat(),
        "plan_window": {
            "first_week_start": first_monday.isoformat(),
            "plan_start_date": plan_start.isoformat(),
            "first_training_date": first_training_date.isoformat() if first_training_date else None,
            "weeks": weeks_to_plan,
            "frozen_until": freeze_until.isoformat() if freeze_until else None,
            "frozen_sessions": frozen_sessions,
            "freeze_note": (
                "frozen_sessions staan al vast en worden ongewijzigd overgenomen. "
                "Plan er GEEN sessie op of vóór frozen_until: die dagen zijn niet "
                "van jou. Gebruik ze wel om je eerste week erop te laten aansluiten, "
                "bijvoorbeeld door geen tweede lange duurloop vlak erna te zetten."
            )
            if freeze_until
            else None,
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
            "anchor": estimates.get("anchor"),
            "current": estimates.get("current"),
            "historical": estimates.get("historical"),
            "garmin_predictions": predictions[0] if predictions else None,
            "hr_pace_curve": hr_pace_curve,
            "note": (
                "hr_pace_curve is gemeten aan zijn eigen runs en zegt wat een "
            "hartslagvoorschrift in de praktijk aan tempo en dus aan tijd kost. "
            "anchor is de enige schatting waarop je een tempodoel mag baseren. "
                "Hij kiest zelf de beste bron en verantwoordt dat in basis: source, "
                "evidence_date, evidence_age_days en confidence. Bij confidence "
                "'low' of 'medium' geef je een ruime tempoband en benoem je de "
                "onzekerheid. current telt elke run mee, ook rustige, en "
                "onderschat daardoor; historical is context, nooit een doel."
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
