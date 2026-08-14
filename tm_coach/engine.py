"""De coach-engine: context -> Claude -> guardrails -> plan in de database."""

from __future__ import annotations

import json
import logging
import time
from datetime import date, timedelta
from typing import Any

import anthropic
from supabase import Client

from tm_sync import clock
from tm_sync.config import Settings

from . import guardrails
from .consistency import require_consistent
from .context import build_context
from .prompt import SYSTEM
from .schema import PLAN_SCHEMA

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3

# Denktokens tellen mee in deze limiet. Een plan van vier weken met tempodoelen
# kwam bij Sonnet net boven de 24k uit en werd stil afgekapt.
MAX_TOKENS = 40000

# Model per trigger. Een nieuw blok bouwen verdient het sterkste model; een
# bestaand blok bijstellen na afdrijving niet.
MODEL_BY_TRIGGER = {
    "goal_created": "claude-opus-5",
    "goal_changed": "claude-opus-5",
    "block_end": "claude-opus-5",
    "weekly_review": "claude-opus-5",
    "alarm": "claude-opus-5",
    "plan_drift": "claude-sonnet-5",
    "manual": "claude-opus-5",
    # Historische triggers; ze worden niet meer gedetecteerd maar kunnen nog in
    # oude `coach_runs`-rijen staan.
    "run_completed": "claude-sonnet-5",
    "activity_completed": "claude-sonnet-5",
    "session_skipped": "claude-haiku-4-5",
}

# Welke triggers de lopende week nog mogen omgooien. Een pijnmelding of een
# ander doel wél: dan klopt wat er vandaag staat gewoon niet meer. Een blok dat
# afloopt of een schema dat afdrijft niet: die beginnen na de toezeggingshorizon,
# zodat de week die al op het horloge staat blijft staan.
FREEZE_EXEMPT_TRIGGERS = {"alarm", "goal_created", "goal_changed", "manual"}

# USD per miljoen tokens (input, output).
PRICING = {
    "claude-opus-5": (5.0, 25.0),
    "claude-sonnet-5": (3.0, 15.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


def _session_sport(session_type: str) -> str:
    """Bewaar niet-hardloopsessies ook als zodanig in het plan.

    Voorheen kregen kracht, cross-training en rust allemaal `running`, waardoor
    Garmin-activiteiten verkeerd konden matchen en de interface ze als run zag.
    """
    if session_type == "strength":
        return "strength"
    if session_type in {"cross_training", "rest"}:
        return "other"
    return "running"


def _cost_usd(model: str, usage: Any) -> float:
    price_in, price_out = PRICING.get(model, (0.0, 0.0))
    cached = getattr(usage, "cache_read_input_tokens", 0) or 0
    fresh = (getattr(usage, "input_tokens", 0) or 0) + (
        getattr(usage, "cache_creation_input_tokens", 0) or 0
    )
    out = getattr(usage, "output_tokens", 0) or 0
    return round(
        (fresh * price_in + cached * price_in * 0.1 + out * price_out) / 1_000_000, 5
    )


def _call_model(
    client: anthropic.Anthropic, model: str, messages: list[dict[str, Any]]
) -> tuple[dict[str, Any], Any]:
    with client.messages.stream(
        model=model,
        max_tokens=MAX_TOKENS,
        system=[
            {"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}
        ],
        output_config={"format": {"type": "json_schema", "schema": PLAN_SCHEMA}},
        messages=messages,
    ) as stream:
        message = stream.get_final_message()

    if message.stop_reason == "refusal":
        raise RuntimeError(f"Model weigerde: {message.stop_details}")

    # Afgekapte JSON geeft anders een onleesbare JSONDecodeError diep in de stack.
    # Denktokens tellen mee in de limiet, dus dit gebeurt bij lange schema's echt.
    if message.stop_reason == "max_tokens":
        raise RuntimeError(
            f"Antwoord afgekapt op {MAX_TOKENS} tokens; plan onvolledig. "
            "Plan minder weken tegelijk of verhoog MAX_TOKENS."
        )

    text = next((b.text for b in message.content if b.type == "text"), None)
    if not text:
        raise RuntimeError("Model gaf geen tekstblok terug")

    return json.loads(text), message.usage


def _override_rules(adjustments: list[dict[str, Any]]) -> set[str]:
    return {
        a["rule"] for a in adjustments if a.get("severity") == "override" and a.get("rule")
    }


def _active_plan_overrides(sb: Client) -> set[str]:
    plan = (
        sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    )
    if not plan:
        return set()
    rows = (
        sb.table("plan_adjustments")
        .select("rule, severity")
        .eq("plan_id", plan[0]["id"])
        .eq("severity", "override")
        .execute()
        .data
    )
    return {r["rule"] for r in rows}


def plan_status_for(
    plan: dict[str, Any],
    previous_overrides: set[str],
    *,
    has_active_plan: bool,
) -> str:
    """Vervang een bestaand schema nooit zonder expliciet akkoord.

    Het eerste plan kan meteen actief worden. Zodra er al een actief plan is,
    blijft iedere nieuwe versie een voorstel tot Jasper ze toepast. De coach
    mag dus autonoom rekenen en adviseren, maar niet stil de planning wisselen.
    """
    _ = plan, previous_overrides
    return "proposed" if has_active_plan else "active"


def commitment_horizon(sb: Client, trigger: str, today: date) -> date | None:
    """Tot en met welke dag ligt het schema vast?

    Zonder deze grens herschrijft elke herplanning ook de dagen die al op het
    horloge staan. Dan is er geen week meer om te volgen, geen sessie om aan af
    te meten, en verdwijnt een training die de atleet vanochtend nog zag staan.
    De horizon loopt tot de eerstvolgende zondag, zodat een nieuw blok altijd op
    een maandag begint — precies de grens waarop de rest van het systeem al rekent.
    """
    if trigger in FREEZE_EXEMPT_TRIGGERS:
        return None
    active = sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    if not active:
        return None
    return today + timedelta(days=6 - today.weekday())


def _frozen_rows(sb: Client, today: date, freeze_until: date) -> list[dict[str, Any]]:
    """De vastgelegde sessies uit het actieve plan, klaar om over te nemen."""
    active = sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    if not active:
        return []
    return (
        sb.table("plan_sessions")
        .select(
            "day, sport, session_type, title, description, structure, targets, "
            "hr_cap, planned_distance_m, planned_duration_s, status"
        )
        .eq("plan_id", active[0]["id"])
        .in_("status", ["planned", "moved"])
        .gte("day", today.isoformat())
        .lte("day", freeze_until.isoformat())
        .order("day")
        .execute()
        .data
    )


def generate_plan(
    sb: Client,
    settings: Settings,
    goal: dict[str, Any],
    *,
    trigger: str = "goal_created",
    weeks: int = 4,
    trigger_key: str | None = None,
    trigger_reason: str | None = None,
    force_active: bool = False,
) -> dict[str, Any]:
    client = anthropic.Anthropic(api_key=settings.require_anthropic())
    model = MODEL_BY_TRIGGER.get(trigger, "claude-opus-5")

    today = clock.today()
    freeze_until = commitment_horizon(sb, trigger, today)
    context = build_context(sb, goal, weeks, freeze_until=freeze_until)

    # Vóór de eerste betaalde aanroep: spreekt de context zichzelf tegen? Een
    # onvervulbare opdracht laat het model oscilleren tot de pogingen op zijn,
    # en dat kost drie Opus-aanroepen zonder dat er een plan uitkomt.
    require_consistent(context)

    if trigger_reason:
        context["trigger_context"] = {
            "trigger": trigger,
            "reason": trigger_reason,
        }
    rules = context["rules"]

    # Vóór het schrijven vastleggen welke overrides al golden, anders vergelijken
    # we straks met het plan dat we net zelf hebben weggezet.
    previous_overrides = _active_plan_overrides(sb)
    has_active_plan = bool(
        sb.table("plans").select("id").eq("status", "active").limit(1).execute().data
    )

    messages: list[dict[str, Any]] = [
        {"role": "user", "content": json.dumps(context, ensure_ascii=False, default=str)}
    ]

    started = time.monotonic()
    total_in = total_out = total_cached = 0
    cost = 0.0
    plan: dict[str, Any] | None = None
    problems: list[guardrails.Violation] = []

    for attempt in range(1, MAX_ATTEMPTS + 1):
        log.info("coach-aanroep %d/%d met %s", attempt, MAX_ATTEMPTS, model)
        plan, usage = _call_model(client, model, messages)

        total_in += getattr(usage, "input_tokens", 0) or 0
        total_out += getattr(usage, "output_tokens", 0) or 0
        total_cached += getattr(usage, "cache_read_input_tokens", 0) or 0
        cost += _cost_usd(model, usage)

        problems = guardrails.validate(plan, context, rules)
        if not problems:
            log.info("plan goedgekeurd door de guardrails")
            break

        log.warning("guardrails: %d bezwaren", len(problems))
        for p in problems:
            log.warning("  [%s] %s", p.rule, p.message)

        messages.append({"role": "assistant", "content": json.dumps(plan, ensure_ascii=False)})
        messages.append({"role": "user", "content": guardrails.as_feedback(problems)})

    duration_ms = int((time.monotonic() - started) * 1000)
    run = (
        sb.table("coach_runs")
        .insert(
            {
                "trigger": trigger,
                "model": model,
                "input_tokens": total_in,
                "output_tokens": total_out,
                "cache_read_tokens": total_cached,
                "cost_usd": cost,
                "guardrail_violations": [
                    {"rule": p.rule, "message": p.message, "where": p.where}
                    for p in problems
                ],
                "retries": attempt - 1,
                "duration_ms": duration_ms,
                "status": "ok" if not problems else "rejected",
                "trigger_key": trigger_key,
            }
        )
        .execute()
        .data[0]
    )

    if problems:
        raise RuntimeError(
            f"Plan na {MAX_ATTEMPTS} pogingen nog steeds afgekeurd; niet opgeslagen. "
            f"Laatste bezwaren: {[p.rule for p in problems]}"
        )

    assert plan is not None
    status = (
        "active"
        if force_active
        else plan_status_for(
            plan,
            previous_overrides,
            has_active_plan=has_active_plan,
        )
    )
    # De bevroren dagen komen niet uit het model maar uit het lopende plan. Ze
    # moeten mee, anders verdwijnen ze zodra dit plan het actieve vervangt.
    carried = _frozen_rows(sb, today, freeze_until) if freeze_until else []
    return _persist(
        sb, goal, plan, trigger, model, run["id"], cost, status, carried=carried
    )


def _persist(
    sb: Client,
    goal: dict[str, Any],
    plan: dict[str, Any],
    trigger: str,
    model: str,
    coach_run_id: int,
    cost: float,
    status: str,
    *,
    carried: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    # Een ouder voorstel is achterhaald zodra er een nieuw plan ligt.
    sb.table("plans").update({"status": "superseded"}).eq("status", "proposed").execute()

    # Het actieve plan blijft staan zolang het nieuwe alleen een voorstel is;
    # anders zou een afgewezen voorstel Jasper zonder schema achterlaten.
    if status == "active":
        sb.table("plans").update({"status": "superseded"}).eq("status", "active").execute()

    existing = (
        sb.table("plans")
        .select("version")
        .eq("goal_id", goal["id"])
        .order("version", desc=True)
        .limit(1)
        .execute()
        .data
    )
    version = (existing[0]["version"] + 1) if existing else 1

    plan_row = (
        sb.table("plans")
        .insert(
            {
                "goal_id": goal["id"],
                "version": version,
                "trigger": trigger,
                "reason": plan["summary"]["nl"],
                "summary": plan["phase"],
                "model": model,
                "status": status,
            }
        )
        .execute()
        .data[0]
    )

    # De vastgelegde dagen eerst, ongewijzigd op inhoud. De Garmin-ids gaan
    # bewust níét mee: die horen bij de rij van het oude plan, en `apply_active_plan`
    # ruimt die op en pusht deze opnieuw.
    sessions = [
        {
            "plan_id": plan_row["id"],
            "day": row["day"],
            "sport": row["sport"],
            "session_type": row["session_type"],
            "title": row["title"],
            "description": row["description"],
            "structure": row["structure"],
            "targets": {**(row.get("targets") or {}), "carried_over": True},
            "hr_cap": row.get("hr_cap"),
            "planned_distance_m": row.get("planned_distance_m"),
            "planned_duration_s": row.get("planned_duration_s"),
            "status": row.get("status") or "planned",
        }
        for row in (carried or [])
    ]
    for week in plan["weeks"]:
        for s in week["sessions"]:
            sessions.append(
                {
                    "plan_id": plan_row["id"],
                    "day": s["date"],
                    "sport": _session_sport(s["session_type"]),
                    "session_type": s["session_type"],
                    "title": s["title"]["nl"],
                    "description": s["description"]["nl"],
                    "structure": {"steps": s["steps"]},
                    "targets": {
                        "title": s["title"],
                        "description": s["description"],
                        "week_focus": week["focus"],
                        "target_type": s.get("target_type", "hr"),
                    },
                    "hr_cap": s["hr_cap"] or None,
                    "planned_distance_m": s["planned_distance_m"] or None,
                    "planned_duration_s": s["planned_duration_s"] or None,
                }
            )
    if sessions:
        sb.table("plan_sessions").insert(sessions).execute()

    stored = (
        sb.table("plan_sessions")
        .select("id, day")
        .eq("plan_id", plan_row["id"])
        .execute()
        .data
    )
    by_day = {row["day"]: row["id"] for row in stored}

    adjustments = [
        {
            "plan_id": plan_row["id"],
            "plan_session_id": by_day.get(a.get("evidence", {}).get("window", "")),
            "rule": a["rule"],
            "severity": a["severity"],
            "explanation": a["explanation"],
            "evidence": a["evidence"],
        }
        for a in plan.get("adjustments", [])
    ]
    if adjustments:
        sb.table("plan_adjustments").insert(adjustments).execute()

    proposed = 0
    for r in plan.get("proposed_rules", []):
        try:
            sb.table("coach_rules").insert(
                {
                    "key": r["key"],
                    "class": "learned",
                    "status": "proposed",
                    "title": r["title"],
                    "rationale": r["rationale"],
                    "condition": {
                        "metric": r["condition_metric"],
                        "op": r["condition_op"],
                        "value": r["condition_value"],
                    },
                    "action": {"type": r["action"]},
                    "evidence": {"observations": r["observations"]},
                    "sample_size": r["observations"],
                    "created_by": "coach",
                }
            ).execute()
            proposed += 1
        except Exception as exc:  # noqa: BLE001 - dubbele key is geen fout
            log.warning("regel %s niet opgeslagen: %s", r.get("key"), exc)

    log.info(
        "plan v%d opgeslagen als %s: %d sessies (%d overgenomen), %d ingrepen, "
        "%d voorgestelde regels, $%.4f",
        version,
        status,
        len(sessions),
        len(carried or []),
        len(adjustments),
        proposed,
        cost,
    )
    if status == "proposed":
        log.info(
            "wacht op akkoord vanwege nieuwe zware ingreep: %s",
            ", ".join(sorted(_override_rules(plan.get("adjustments", [])))) or "onbekend",
        )

    return {
        "plan_id": plan_row["id"],
        "version": version,
        "status": status,
        "sessions": len(sessions),
        "carried_over": len(carried or []),
        "adjustments": len(adjustments),
        "proposed_rules": proposed,
        "cost_usd": cost,
        "coach_run_id": coach_run_id,
    }
