"""CLI voor de coach.

    uv run -m tm_coach goal --type return_to_run --name "Terug naar lopen"
    uv run -m tm_coach plan --weeks 4
    uv run -m tm_coach show
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from tm_sync.clients import supabase_client
from tm_sync.config import load_settings

from .context import build_context
from .engine import generate_plan


def _active_goal(sb):
    rows = sb.table("goals").select("*").eq("status", "active").limit(1).execute().data
    return rows[0] if rows else None


def cmd_goal(sb, args) -> int:
    log = logging.getLogger("tm_coach")

    current = _active_goal(sb)
    if current and not args.replace:
        log.error(
            "Er is al een actief doel: %s (%s). Gebruik --replace om het te vervangen.",
            current["name"],
            current["goal_type"],
        )
        return 1

    if current:
        sb.table("goals").update({"status": "archived"}).eq("id", current["id"]).execute()
        log.info("vorig doel gearchiveerd: %s", current["name"])

    goal = (
        sb.table("goals")
        .insert(
            {
                "goal_type": args.type,
                "name": args.name,
                "status": "active",
                "target_date": args.date,
                "target_distance_m": args.distance,
                "target_time_s": args.time,
                "params": json.loads(args.params) if args.params else {},
            }
        )
        .execute()
        .data[0]
    )
    log.info("doel aangemaakt: %s (id %d)", goal["name"], goal["id"])
    return 0


def cmd_plan(sb, settings, args) -> int:
    log = logging.getLogger("tm_coach")

    goal = _active_goal(sb)
    if not goal:
        log.error("Geen actief doel. Maak er eerst een met: uv run -m tm_coach goal ...")
        return 1

    log.info("plannen voor doel: %s (%s)", goal["name"], goal["goal_type"])
    try:
        result = generate_plan(
            sb,
            settings,
            goal,
            trigger=args.trigger,
            weeks=args.weeks,
            trigger_reason=args.reason,
        )
    except Exception as exc:  # noqa: BLE001
        log.error("%s: %s", type(exc).__name__, exc)
        return 1

    log.info("klaar: %s", json.dumps(result, ensure_ascii=False))
    return 0


def cmd_show(sb, args) -> int:
    goal = _active_goal(sb)
    if not goal:
        print("Geen actief doel.")
        return 1

    if args.context:
        print(json.dumps(build_context(sb, goal, args.weeks), indent=2, ensure_ascii=False, default=str))
        return 0

    plan = (
        sb.table("plans").select("*").eq("status", "active").limit(1).execute().data
    )
    if not plan:
        print(f"Doel: {goal['name']} — nog geen plan.")
        return 0

    sessions = (
        sb.table("plan_sessions")
        .select("day, session_type, title, planned_distance_m, hr_cap")
        .eq("plan_id", plan[0]["id"])
        .order("day")
        .execute()
        .data
    )
    print(f"Doel: {goal['name']}")
    print(f"Plan v{plan[0]['version']} — {plan[0]['summary']}")
    print(f"{plan[0]['reason']}\n")
    for s in sessions:
        dist = f"{(s['planned_distance_m'] or 0) / 1000:.1f} km" if s["planned_distance_m"] else "-"
        cap = f"HR<{s['hr_cap']}" if s["hr_cap"] else ""
        print(f"  {s['day']}  {s['session_type']:<14} {dist:>8}  {cap:<8} {s['title']}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tm_coach")
    sub = parser.add_subparsers(dest="command", required=True)

    g = sub.add_parser("goal", help="doel aanmaken of vervangen")
    g.add_argument(
        "--type",
        required=True,
        choices=["return_to_run", "race", "time_target", "maintenance"],
    )
    g.add_argument("--name", required=True)
    g.add_argument("--date", help="doeldatum YYYY-MM-DD")
    g.add_argument("--distance", type=float, help="doelafstand in meter")
    g.add_argument("--time", type=int, help="doeltijd in seconden")
    g.add_argument("--params", help="extra velden als JSON")
    g.add_argument("--replace", action="store_true", help="archiveer het huidige doel")

    p = sub.add_parser("plan", help="plan genereren")
    p.add_argument("--weeks", type=int, default=4)
    p.add_argument(
        "--trigger",
        default="goal_created",
        choices=[
            "goal_created",
            "goal_changed",
            "run_completed",
            "activity_completed",
            "session_skipped",
            "weekly_review",
            "alarm",
            "manual",
        ],
    )
    p.add_argument(
        "--reason",
        help="concrete aanleiding die de coach aantoonbaar in het voorstel verwerkt",
    )

    s = sub.add_parser("show", help="huidig doel en plan tonen")
    s.add_argument("--context", action="store_true", help="toon de coach-context als JSON")
    s.add_argument("--weeks", type=int, default=4)

    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s  %(levelname)-7s %(message)s",
        datefmt="%H:%M:%S",
    )

    settings = load_settings()
    sb = supabase_client(settings)

    if args.command == "goal":
        return cmd_goal(sb, args)
    if args.command == "plan":
        return cmd_plan(sb, settings, args)
    return cmd_show(sb, args)


if __name__ == "__main__":
    sys.exit(main())
