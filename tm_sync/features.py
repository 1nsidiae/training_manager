"""Feature-laag: deterministische afgeleide metrics.

Dit is de laag waar zowel de guardrails als de lerende regels hun cijfers uit
halen. Er komt geen AI aan te pas — als hier een fout in zit, is elk schema fout.

Drie outputs:
  daily_metrics      per dag: volume, duur, zonetijd, belasting
  weekly_metrics     per week: ACWR, monotonie, easy-aandeel, slaap, HRV, readiness
  fitness_estimates  huidige vorm, expliciet gescheiden van historische vorm
"""

from __future__ import annotations

import logging
import statistics
from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from supabase import Client

log = logging.getLogger(__name__)

# Zonegewichten voor de TRIMP-achtige fallback als Garmin geen trainingload geeft.
ZONE_WEIGHTS = {1: 1.0, 2: 2.0, 3: 3.0, 4: 4.0, 5: 5.0}

RUNNING_SPORTS = {"running"}

# Riegel-exponent voor het omrekenen van prestaties naar andere afstanden.
RIEGEL = 1.06

CURRENT_WINDOW_DAYS = 42
MIN_EFFORT_DISTANCE_M = 2000
DEFAULT_SLEEP_NEED_S = 8 * 3600

# Onder deze chronische belasting is de ACWR-verhouding betekenisloos: na een
# rustperiode levert een enkele run al een ratio van 4+ op, en daar mag geen
# guardrail op ingrijpen. Dan liever expliciet geen waarde.
MIN_CHRONIC_LOAD = 50.0


def _rows(sb: Client, table: str, columns: str = "*") -> list[dict[str, Any]]:
    """Haal een hele tabel op; PostgREST pagineert standaard op 1000 rijen."""
    out: list[dict[str, Any]] = []
    step = 1000
    start = 0
    while True:
        chunk = (
            sb.table(table)
            .select(columns)
            .range(start, start + step - 1)
            .execute()
            .data
        )
        out.extend(chunk)
        if len(chunk) < step:
            return out
        start += step


# --------------------------------------------------------------------------
# daily_metrics
# --------------------------------------------------------------------------


def compute_daily(sb: Client) -> int:
    activities = _rows(
        sb,
        "activities",
        "id, sport, start_time_local, duration_s, moving_duration_s, distance_m, raw",
    )
    zones = _rows(sb, "activity_zones", "activity_id, zone_number, seconds_in_zone")

    zones_by_activity: dict[int, dict[int, float]] = defaultdict(dict)
    for z in zones:
        zones_by_activity[z["activity_id"]][z["zone_number"]] = float(
            z["seconds_in_zone"] or 0
        )

    days: dict[str, dict[str, Any]] = {}

    for a in activities:
        day = str(a["start_time_local"])[:10]
        slot = days.setdefault(
            day,
            {
                "day": day,
                "distance_m": 0.0,
                "duration_s": 0.0,
                "session_count": 0,
                "zone1_s": 0.0,
                "zone2_s": 0.0,
                "zone3_s": 0.0,
                "zone4_s": 0.0,
                "zone5_s": 0.0,
                "load": 0.0,
            },
        )

        slot["session_count"] += 1
        slot["duration_s"] += float(a.get("duration_s") or 0)

        # Volume telt alleen hardlopen: dat is wat de ramp-rate-regel begrenst.
        # Belasting en zonetijd tellen alle sporten mee.
        if a["sport"] in RUNNING_SPORTS:
            slot["distance_m"] += float(a.get("distance_m") or 0)

        act_zones = zones_by_activity.get(a["id"], {})
        for zone, secs in act_zones.items():
            slot[f"zone{zone}_s"] += secs

        raw = a.get("raw") or {}
        garmin_load = raw.get("activityTrainingLoad")
        if garmin_load:
            slot["load"] += float(garmin_load)
        else:
            # Fallback: zonegewogen minuten.
            slot["load"] += sum(
                (secs / 60.0) * ZONE_WEIGHTS[zone] for zone, secs in act_zones.items()
            )

    rows = list(days.values())
    for i in range(0, len(rows), 200):
        sb.table("daily_metrics").upsert(rows[i : i + 200], on_conflict="day").execute()

    log.info("daily_metrics: %d dagen", len(rows))
    return len(rows)


# --------------------------------------------------------------------------
# weekly_metrics
# --------------------------------------------------------------------------


def _sleep_need_s(raw: dict[str, Any] | None) -> int:
    """Garmin's eigen slaapbehoefte, in minuten aangeleverd."""
    if not raw:
        return DEFAULT_SLEEP_NEED_S
    need = (raw.get("values") or {}).get("sleepNeed")
    try:
        minutes = float(need)
    except (TypeError, ValueError):
        return DEFAULT_SLEEP_NEED_S
    if 240 <= minutes <= 780:
        return int(minutes * 60)
    return DEFAULT_SLEEP_NEED_S


def compute_weekly(sb: Client) -> int:
    daily = {
        d["day"]: d for d in _rows(sb, "daily_metrics")
    }
    wellness = {w["day"]: w for w in _rows(sb, "wellness_daily")}

    if not daily:
        log.warning("geen daily_metrics — draai eerst compute_daily")
        return 0

    first = date.fromisoformat(min(daily))
    last = max(date.fromisoformat(max(daily)), date.today())

    def load_on(day: date) -> float:
        row = daily.get(day.isoformat())
        return float(row["load"]) if row else 0.0

    week_start = first - timedelta(days=first.weekday())
    rows: list[dict[str, Any]] = []

    while week_start <= last:
        week_end = week_start + timedelta(days=6)
        week_days = [week_start + timedelta(days=i) for i in range(7)]

        totals = {
            key: sum(float(daily.get(d.isoformat(), {}).get(key, 0) or 0) for d in week_days)
            for key in (
                "distance_m",
                "duration_s",
                "zone1_s",
                "zone2_s",
                "zone3_s",
                "zone4_s",
                "zone5_s",
                "load",
            )
        }
        sessions = sum(
            int(daily.get(d.isoformat(), {}).get("session_count", 0) or 0)
            for d in week_days
        )

        zone_total = sum(totals[f"zone{z}_s"] for z in range(1, 6))
        easy_share = (
            (totals["zone1_s"] + totals["zone2_s"]) / zone_total if zone_total else None
        )

        # ACWR: 7-daagse belasting tegen het weekgemiddelde over 28 dagen.
        acute = sum(load_on(week_end - timedelta(days=i)) for i in range(7))
        chronic_total = sum(load_on(week_end - timedelta(days=i)) for i in range(28))
        chronic = chronic_total / 4.0
        acwr = round(acute / chronic, 3) if chronic >= MIN_CHRONIC_LOAD else None

        # Monotonie: gelijkmatige belasting zonder rustdagen is een risicosignaal.
        day_loads = [load_on(d) for d in week_days]
        spread = statistics.pstdev(day_loads)
        monotony = (
            round(statistics.fmean(day_loads) / spread, 3)
            if spread > 0 and any(day_loads)
            else None
        )
        strain = round(totals["load"] * monotony, 1) if monotony else None

        sleeps = [
            (wellness[d.isoformat()], d)
            for d in week_days
            if d.isoformat() in wellness
            and wellness[d.isoformat()].get("sleep_total_s") is not None
        ]
        avg_sleep = (
            statistics.fmean(float(w["sleep_total_s"]) for w, _ in sleeps)
            if sleeps
            else None
        )
        sleep_debt = (
            sum(
                max(0.0, _sleep_need_s(w.get("raw")) - float(w["sleep_total_s"]))
                for w, _ in sleeps
            )
            if sleeps
            else None
        )

        readiness = [
            float(wellness[d.isoformat()]["training_readiness_score"])
            for d in week_days
            if d.isoformat() in wellness
            and wellness[d.isoformat()].get("training_readiness_score") is not None
        ]
        unbalanced = sum(
            1
            for d in week_days
            if wellness.get(d.isoformat(), {}).get("hrv_status") == "UNBALANCED"
        )

        rows.append(
            {
                "week_start": week_start.isoformat(),
                "distance_m": round(totals["distance_m"], 1),
                "duration_s": round(totals["duration_s"], 1),
                "session_count": sessions,
                "zone1_s": round(totals["zone1_s"], 1),
                "zone2_s": round(totals["zone2_s"], 1),
                "zone3_s": round(totals["zone3_s"], 1),
                "zone4_s": round(totals["zone4_s"], 1),
                "zone5_s": round(totals["zone5_s"], 1),
                "easy_share": round(easy_share, 4) if easy_share is not None else None,
                "acute_load": round(acute, 1),
                "chronic_load": round(chronic, 1),
                "acwr": acwr,
                "monotony": monotony,
                "strain": strain,
                "avg_sleep_s": round(avg_sleep, 0) if avg_sleep else None,
                "sleep_debt_s": round(sleep_debt, 0) if sleep_debt else None,
                "avg_readiness": round(statistics.fmean(readiness), 1)
                if readiness
                else None,
                "hrv_unbalanced_days": unbalanced,
                "adherence": None,  # vereist plan_sessions; nog geen plan
            }
        )

        week_start += timedelta(days=7)

    for i in range(0, len(rows), 200):
        sb.table("weekly_metrics").upsert(
            rows[i : i + 200], on_conflict="week_start"
        ).execute()

    log.info("weekly_metrics: %d weken", len(rows))
    return len(rows)


# --------------------------------------------------------------------------
# fitness_estimates
# --------------------------------------------------------------------------


def _riegel(duration_s: float, from_m: float, to_m: float) -> float:
    """Reken een prestatie om naar een andere afstand."""
    return duration_s * (to_m / from_m) ** RIEGEL


# Riegel is bruikbaar binnen ongeveer een factor 3 rond de gelopen afstand.
# Daarbuiten extrapoleert hij hard de verkeerde kant op: een snelle korte
# training voorspelt dan een marathon die je nooit gaat lopen. Gemeten aan
# Jaspers echte marathon (3:43:40) gaf ongelimiteerde extrapolatie 3:05:49.
RIEGEL_MIN_RATIO = 1 / 3
RIEGEL_MAX_RATIO = 3.0

TARGETS = {
    "5k": 5000.0,
    "10k": 10000.0,
    "half": 21097.5,
    "marathon": 42195.0,
}


def _estimate(
    runs: list[dict[str, Any]], scope: str, window_days: int
) -> dict[str, Any] | None:
    """Schat per afstand vanuit inspanningen van vergelijkbare lengte.

    Geen geschikte inspanning betekent geen schatting. Een expliciete null is
    bruikbaarder dan een getal waar de coach niet op kan plannen.
    """
    efforts = []
    for r in runs:
        dist = float(r.get("distance_m") or 0)
        dur = float(r.get("moving_duration_s") or r.get("duration_s") or 0)
        if dist >= MIN_EFFORT_DISTANCE_M and dur > 0:
            efforts.append((dist, dur, str(r["start_time_local"])[:10]))

    if not efforts:
        return None

    equivalents: dict[str, int | None] = {}
    basis: dict[str, Any] = {}

    for label, target in TARGETS.items():
        usable = [
            (dist, dur, day)
            for dist, dur, day in efforts
            if RIEGEL_MIN_RATIO <= dist / target <= RIEGEL_MAX_RATIO
        ]
        if not usable:
            equivalents[label] = None
            continue

        best = min(usable, key=lambda e: _riegel(e[1], e[0], target))
        dist, dur, day = best
        equivalents[label] = int(round(_riegel(dur, dist, target)))
        basis[label] = {
            "distance_m": round(dist),
            "duration_s": round(dur),
            "date": day,
            "candidates": len(usable),
        }

    fastest = min(efforts, key=lambda e: e[1] / e[0])
    vo2 = [float(r["vo2max"]) for r in runs if r.get("vo2max")]

    return {
        "day": date.today().isoformat(),
        "scope": scope,
        "window_days": window_days,
        "critical_speed_m_per_s": round(fastest[0] / fastest[1], 4),
        "equiv_5k_s": equivalents["5k"],
        "equiv_10k_s": equivalents["10k"],
        "equiv_half_s": equivalents["half"],
        "equiv_marathon_s": equivalents["marathon"],
        "vo2max": max(vo2) if vo2 else None,
        "sample_size": len(efforts),
        "basis": basis,
    }


def compute_fitness_estimates(sb: Client) -> int:
    activities = _rows(
        sb,
        "activities",
        "sport, start_time_local, distance_m, duration_s, moving_duration_s, vo2max",
    )
    runs = [a for a in activities if a["sport"] in RUNNING_SPORTS]

    cutoff = (date.today() - timedelta(days=CURRENT_WINDOW_DAYS)).isoformat()
    recent = [r for r in runs if str(r["start_time_local"])[:10] >= cutoff]

    rows = []
    current = _estimate(recent, "current", CURRENT_WINDOW_DAYS)
    if current:
        rows.append(current)
    else:
        log.warning(
            "geen runs in de laatste %d dagen — huidige vorm niet te schatten",
            CURRENT_WINDOW_DAYS,
        )

    historical = _estimate(runs, "historical", 0)
    if historical:
        rows.append(historical)

    if rows:
        sb.table("fitness_estimates").upsert(rows, on_conflict="day,scope").execute()

    log.info("fitness_estimates: %d rijen", len(rows))
    return len(rows)


def compute_all(sb: Client) -> int:
    total = compute_daily(sb)
    total += compute_weekly(sb)
    total += compute_fitness_estimates(sb)
    return total
