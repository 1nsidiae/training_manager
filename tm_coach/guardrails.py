"""Deterministische controle op het voorstel van de coach.

Deze laag wint altijd van het model. Fouten gaan terug naar de coach voor een
herkansing; blijft het fout, dan wordt het plan niet opgeslagen.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

HR_CAP_REQUIRED = {"easy", "long", "recovery"}
QUALITY_TYPES = {"interval", "tempo", "race"}
INTENSITY_TYPES = QUALITY_TYPES | {"long"}


@dataclass
class Violation:
    rule: str
    message: str
    where: str


def _rule(rules: list[dict[str, Any]], key: str) -> dict[str, Any] | None:
    return next((r for r in rules if r["key"] == key), None)


def _param(rules: list[dict[str, Any]], key: str, param: str, fallback: float) -> float:
    rule = _rule(rules, key)
    if not rule or rule.get("status") != "active":
        return fallback
    try:
        return float((rule.get("params") or {}).get(param, fallback))
    except (TypeError, ValueError):
        return fallback


def _sessions(plan: dict[str, Any]) -> list[dict[str, Any]]:
    return [s for week in plan.get("weeks", []) for s in week.get("sessions", [])]


def _mmss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


# Korte herhalingen mogen sneller dan 5 km-tempo. 8% ruimte komt ruwweg neer op
# 3 km-tempo, en dat is het snelste dat in een trainingsschema thuishoort.
INTERVAL_MARGIN = 0.92


def _pace_ceiling(context: dict[str, Any]) -> float | None:
    """Snelste tempo (s/km) dat nog verdedigbaar is, of None bij te weinig data.

    Neemt bewust de *optimistische* van beide vormschattingen als basis: deze
    regel is een vangnet tegen onzin uit oude vorm, geen fijnregeling.
    """
    fitness = context.get("fitness") or {}
    candidates: list[float] = []

    current = fitness.get("current") or {}
    if current.get("equiv_5k_s"):
        candidates.append(float(current["equiv_5k_s"]) / 5.0)

    predictions = (fitness.get("garmin_predictions") or {}).get("race_predictions") or {}
    if predictions.get("5k"):
        candidates.append(float(predictions["5k"]) / 5.0)

    if not candidates:
        return None
    return min(candidates) * INTERVAL_MARGIN


def validate(
    plan: dict[str, Any],
    context: dict[str, Any],
    rules: list[dict[str, Any]],
) -> list[Violation]:
    problems: list[Violation] = []
    sessions = sorted(_sessions(plan), key=lambda s: s["date"])

    # --- Door de atleet gekozen planstart en eerste trainingsdag -----------
    plan_window = context.get("plan_window") or {}
    plan_start_value = plan_window.get("plan_start_date")
    first_training_value = plan_window.get("first_training_date")
    goal_params = ((context.get("goal") or {}).get("params") or {})
    is_plan_wizard = goal_params.get("created_via") == "plan_wizard"
    if is_plan_wizard and plan_start_value:
        before_start = [s for s in sessions if s["date"] < plan_start_value]
        for session in before_start:
            problems.append(
                Violation(
                    "plan_start_date",
                    f"Sessie op {session['date']} valt vóór de gekozen planstart "
                    f"van {plan_start_value}.",
                    session["date"],
                )
            )

    training_sessions = [s for s in sessions if s.get("session_type") != "rest"]
    if is_plan_wizard and first_training_value and (
        not training_sessions or training_sessions[0]["date"] != first_training_value
    ):
        actual = training_sessions[0]["date"] if training_sessions else "geen sessie"
        problems.append(
            Violation(
                "first_training_date",
                f"De gekozen eerste trainingsdag is {first_training_value}, maar de "
                f"eerste echte sessie staat op {actual}.",
                first_training_value,
            )
        )

    preferred_days = set(goal_params.get("preferred_training_days") or [])
    weekday_names = [
        "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"
    ]
    if is_plan_wizard and preferred_days:
        for session in training_sessions:
            weekday = weekday_names[date.fromisoformat(session["date"]).weekday()]
            if weekday not in preferred_days:
                problems.append(
                    Violation(
                        "preferred_training_days",
                        f"Sessie op {session['date']} staat op {weekday}, maar die dag "
                        "is niet als beschikbare trainingsdag gekozen.",
                        session["date"],
                    )
                )

    # --- HR-bovengrens verplicht op rustige sessies -------------------------
    zones = context["athlete"].get("hr_zones") or []
    zone2_high = next((z["high"] for z in zones if z.get("zone") == 2), None)

    for s in sessions:
        if s["session_type"] in HR_CAP_REQUIRED:
            cap = s.get("hr_cap") or 0
            if cap <= 0:
                problems.append(
                    Violation(
                        "easy_run_hr_cap_required",
                        f"Sessie op {s['date']} ({s['session_type']}) heeft geen hr_cap.",
                        s["date"],
                    )
                )
            elif zone2_high and cap > zone2_high and s["session_type"] != "long":
                problems.append(
                    Violation(
                        "easy_run_hr_cap_required",
                        f"hr_cap {cap} op {s['date']} ligt boven de bovengrens van "
                        f"zone 2 ({zone2_high}); dat is geen rustige sessie.",
                        s["date"],
                    )
                )

    # --- Instapvolume en ramp-rate ------------------------------------------
    # De ramp-rate bepaalt hoe snel je groeit, niet waar je begint. Na een
    # periode van weinig lopen zegt "vorige week" niets over wat de atleet aankan:
    # één run van 4,9 km zou het startvolume op 5,4 km/week zetten terwijl hij
    # 5 km pijnvrij loopt. Het instappunt komt daarom uit aangetoonde capaciteit.
    max_increase = _param(rules, "weekly_volume_ramp_cap", "max_increase_pct", 10.0)
    constraints = context.get("constraints") or {}
    entry_ceiling = float(constraints.get("entry_week_ceiling_m") or 0)

    weeks_planned = plan.get("weeks", [])
    previous = 0.0
    first_week_is_partial = bool(constraints.get("first_week_is_partial"))

    for i, week in enumerate(weeks_planned):
        planned = float(week.get("planned_distance_m") or 0)

        if i == 0:
            if entry_ceiling > 0 and planned > entry_ceiling:
                problems.append(
                    Violation(
                        "weekly_volume_ramp_cap",
                        f"Week {week['week_start']}: {planned / 1000:.1f} km ligt boven "
                        f"het instapplafond van {entry_ceiling / 1000:.1f} km.",
                        week["week_start"],
                    )
                )
        elif i == 1 and first_week_is_partial:
            # Een plan dat op donderdag start heeft in de eerste kalenderweek
            # maar enkele dagen. Die gedeeltelijke week als 10%-basis gebruiken
            # zou alle volgende volledige weken kunstmatig klein houden.
            if entry_ceiling > 0 and planned > entry_ceiling:
                problems.append(
                    Violation(
                        "weekly_volume_ramp_cap",
                        f"Week {week['week_start']}: {planned / 1000:.1f} km ligt boven "
                        f"het plafond voor de eerste volledige week van "
                        f"{entry_ceiling / 1000:.1f} km.",
                        week["week_start"],
                    )
                )
        elif previous > 0 and planned > previous * (1 + max_increase / 100.0):
            problems.append(
                Violation(
                    "weekly_volume_ramp_cap",
                    f"Week {week['week_start']}: {planned / 1000:.1f} km is meer dan "
                    f"{max_increase:.0f}% boven de vorige geplande week "
                    f"({previous / 1000:.1f} km).",
                    week["week_start"],
                )
            )

        if planned > 0:
            previous = planned

    last_actual = float(constraints.get("reference_week_distance_m") or 0)

    # --- Twee zware doelmissers verplichten een lichtere komende week -------
    # Dit is bewust deterministisch: het model mag kiezen hóé het de rustige
    # week invult, maar niet besluiten dat twee gemiste en zwaar ervaren runs
    # toch geen aanpassing nodig hebben.
    if constraints.get("repeated_heavy_target_misses"):
        window_start = date.fromisoformat(context["today"])
        window_end = window_start + timedelta(days=6)
        window_sessions = [
            session
            for session in sessions
            if window_start <= date.fromisoformat(session["date"]) <= window_end
        ]
        planned_distance = sum(
            float(session.get("planned_distance_m") or 0)
            for session in window_sessions
            if session.get("session_type") != "rest"
        )
        ceiling = float(constraints.get("target_miss_next_7d_ceiling_m") or 0)
        if planned_distance > ceiling + 50:
            problems.append(
                Violation(
                    "repeated_heavy_target_miss",
                    f"Twee opeenvolgende trainingen zijn buiten doel en zwaar ervaren; "
                    f"de komende 7 dagen staat {planned_distance / 1000:.1f} km, maar "
                    f"het reductieplafond is {ceiling / 1000:.1f} km.",
                    window_start.isoformat(),
                )
            )

        too_hard = [
            session
            for session in window_sessions
            if session.get("session_type") in INTENSITY_TYPES
        ]
        for session in too_hard:
            problems.append(
                Violation(
                    "repeated_heavy_target_miss",
                    f"Na twee zware doelmissers mag in de komende 7 dagen geen "
                    f"{session['session_type']} staan ({session['date']}).",
                    session["date"],
                )
            )

    # --- Afstand tussen kwaliteitssessies -----------------------------------
    min_hours = _param(rules, "quality_session_spacing", "min_hours", 48.0)
    quality_days = [
        date.fromisoformat(s["date"])
        for s in sessions
        if s["session_type"] in QUALITY_TYPES
    ]
    for earlier, later in zip(quality_days, quality_days[1:]):
        gap_hours = (later - earlier).days * 24
        if gap_hours < min_hours:
            problems.append(
                Violation(
                    "quality_session_spacing",
                    f"Slechts {gap_hours} uur tussen kwaliteitssessies op "
                    f"{earlier} en {later}; minimaal {min_hours:.0f} vereist.",
                    later.isoformat(),
                )
            )

    # --- Terugkeerfase ------------------------------------------------------
    # Wandel-loop is bedoeld voor wie niet aaneengesloten kan lopen. Bij een
    # aangetoonde pijnvrije capaciteit is het geen veiligheid maar tijdverlies.
    # Een trainingspauze kan nog wel rechtvaardigen dat kwaliteit even wacht;
    # "kan lopen" en "klaar voor intervals" zijn twee verschillende claims.
    inactive_days = _param(rules, "return_to_run_phase", "inactive_days", 21.0)
    days_since = context["status"].get("days_since_last_run")
    capacity_m = float((context.get("constraints") or {}).get("stated_capacity_m") or 0)

    if capacity_m >= 3000:
        minimum_continuous_m = max(2000.0, capacity_m * 0.6)
        for session in sessions:
            if session.get("session_type") == "walk_run":
                problems.append(
                    Violation(
                        "demonstrated_continuous_capacity",
                        f"De atleet bevestigt {capacity_m / 1000:.1f} km aaneengesloten "
                        f"te kunnen lopen; wandel-loop op {session['date']} is niet passend.",
                        session["date"],
                    )
                )
            distance_m = float(session.get("planned_distance_m") or 0)
            if (
                session.get("session_type") in {"easy", "long"}
                and 0 < distance_m < minimum_continuous_m
            ):
                problems.append(
                    Violation(
                        "demonstrated_continuous_capacity",
                        f"{distance_m / 1000:.1f} km op {session['date']} ligt ver onder "
                        f"de bevestigde capaciteit van {capacity_m / 1000:.1f} km; "
                        f"plan minstens {minimum_continuous_m / 1000:.1f} km.",
                        session["date"],
                    )
                )

    if days_since is not None and days_since > inactive_days:
        first_week = plan.get("weeks", [{}])[0]
        first_start = first_week.get("week_start")
        if first_start:
            cutoff = date.fromisoformat(first_start) + timedelta(
                days=7 if capacity_m >= 3000 else 14
            )
            blocked_types = QUALITY_TYPES if capacity_m >= 3000 else INTENSITY_TYPES
            too_hard = [
                s
                for s in sessions
                if date.fromisoformat(s["date"]) < cutoff
                and s["session_type"] in blocked_types
            ]
            for s in too_hard:
                problems.append(
                    Violation(
                        "return_to_run_phase",
                        f"{days_since} dagen niet gelopen, maar op {s['date']} staat "
                        f"al een {s['session_type']}-sessie. De eerste twee weken zijn "
                        f"opbouw zonder intensiteit.",
                        s["date"],
                    )
                )

    # --- Variatie bij een prestatiedoel -------------------------------------
    # De enige regel die ondertraining afvangt. Alleen actief als er een basis
    # ligt: tijdens een terugkeerfase is de afwezigheid van intensiteit juist
    # het doel, en dan mag deze regel niets zeggen.
    variety = _rule(rules, "quality_variety_required")
    goal_type = context["goal"].get("type")

    if (
        variety
        and variety.get("status") == "active"
        and goal_type in ("race", "time_target")
    ):
        params = variety.get("params") or {}
        base_needed = float(params.get("base_runs_last_21d", 6))
        min_quality = int(params.get("min_quality_per_week", 1))
        min_long = int(params.get("min_long_per_week", 1))
        runs_recent = float(constraints.get("runs_last_21d") or 0)

        if runs_recent >= base_needed:
            for week in weeks_planned:
                types = [s["session_type"] for s in week.get("sessions", [])]
                quality = sum(1 for t in types if t in QUALITY_TYPES)
                longs = sum(1 for t in types if t == "long")

                if quality < min_quality:
                    problems.append(
                        Violation(
                            "quality_variety_required",
                            f"Week {week['week_start']} heeft {quality} "
                            f"kwaliteitssessies; bij doeltype '{goal_type}' zijn er "
                            f"minimaal {min_quality} nodig (tempo of interval).",
                            week["week_start"],
                        )
                    )
                if longs < min_long:
                    problems.append(
                        Violation(
                            "quality_variety_required",
                            f"Week {week['week_start']} heeft geen lange duurloop; "
                            f"bij doeltype '{goal_type}' hoort er minimaal "
                            f"{min_long} per week.",
                            week["week_start"],
                        )
                    )

    # --- Tempodoelen --------------------------------------------------------
    # Een kwaliteitssessie zonder doel is stuurloos: dan loopt hij op gevoel, en
    # gevoel is precies wat hem in de grijze zone bracht.
    for s in sessions:
        if s["session_type"] not in QUALITY_TYPES:
            continue
        steps = s.get("steps") or []
        has_pace = any(
            (step.get("pace_min_s_per_km") or 0) > 0
            or (step.get("pace_max_s_per_km") or 0) > 0
            for step in steps
        )
        if not has_pace and s.get("target_type") not in ("pace", "both"):
            problems.append(
                Violation(
                    "quality_session_needs_target",
                    f"{s['session_type']}-sessie op {s['date']} heeft geen tempodoel. "
                    f"Hartslag loopt achter bij korte inspanningen, dus zonder tempo "
                    f"is deze sessie niet te sturen.",
                    s["date"],
                )
            )

    # Een tempodoel dat sneller is dan zijn huidige vorm toelaat, komt uit oude
    # vorm of uit de lucht. De ruimste van beide schattingen is de referentie,
    # met marge voor korte herhalingen boven 5 km-tempo.
    ceiling = _pace_ceiling(context)
    if ceiling:
        for s in sessions:
            for step in s.get("steps") or []:
                fastest = step.get("pace_min_s_per_km") or 0
                if 0 < fastest < ceiling:
                    problems.append(
                        Violation(
                            "pace_beyond_current_fitness",
                            f"Tempodoel {_mmss(fastest)}/km op {s['date']} is sneller "
                            f"dan zijn huidige vorm toelaat (ondergrens "
                            f"{_mmss(int(ceiling))}/km, afgeleid uit de 5 km-schatting).",
                            s["date"],
                        )
                    )
                    break

    # --- Slaapdrempel remt groei -------------------------------------------
    sleep_rule = _rule(rules, "sleep_7d_below_threshold")
    if sleep_rule and sleep_rule.get("status") == "active":
        threshold_h = float((sleep_rule.get("params") or {}).get("threshold_h", 6.0))
        sleeps = [
            float(w["sleep_total_s"])
            for w in (context.get("recent_wellness") or [])[-7:]
            if w.get("sleep_total_s")
        ]
        if sleeps:
            avg_h = sum(sleeps) / len(sleeps) / 3600.0
            if avg_h < threshold_h:
                ceiling = float(
                    constraints.get("sleep_volume_ceiling_next_7d_m")
                    or last_actual
                    or 0
                )
                window_start = date.fromisoformat(context["today"])
                window_end = window_start + timedelta(days=6)
                next_7d_distance = sum(
                    float(session.get("planned_distance_m") or 0)
                    for session in sessions
                    if window_start
                    <= date.fromisoformat(session["date"])
                    <= window_end
                )
                if ceiling > 0 and next_7d_distance > ceiling + 50:
                    problems.append(
                        Violation(
                            "sleep_7d_below_threshold",
                            f"Slaap 7d-gemiddelde is {avg_h:.1f} u (drempel "
                            f"{threshold_h:.1f}); de komende 7 dagen staat "
                            f"{next_7d_distance / 1000:.1f} km, boven het huidige "
                            f"plafond van {ceiling / 1000:.1f} km.",
                            window_start.isoformat(),
                        )
                    )

    return problems


def as_feedback(problems: list[Violation]) -> str:
    lines = [
        "Je plan is afgekeurd door de guardrails. Corrigeer deze punten en lever "
        "het volledige plan opnieuw:",
        "",
    ]
    for p in problems:
        lines.append(f"- [{p.rule}] {p.message}")
    return "\n".join(lines)
