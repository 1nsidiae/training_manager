"""Controleer de context vóór er een model wordt aangeroepen.

Een tegenstrijdige context levert een onvervulbare opdracht op: guardrails die
elkaar uitsluiten, waarop het model blijft oscilleren tot de pogingen op zijn.
Dat kost drie Opus-aanroepen en levert niets — de duurste manier om te ontdekken
dat de invoer niet klopte.

Dit is bewust géén guardrail. Guardrails beoordelen wat het model *maakt*; dit
beoordeelt wat het model te zien *krijgt*. Het draait vóór de eerste aanroep en
kost niets.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any

log = logging.getLogger(__name__)

INACTIVE_DAYS = 21


class InconsistentContext(ValueError):
    """De context spreekt zichzelf tegen; een aanroep zou geld verspillen."""


def _as_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (ValueError, TypeError):
        return None


def check(context: dict[str, Any]) -> list[str]:
    """Geef de tegenstrijdigheden terug; een lege lijst betekent bruikbaar."""
    problems: list[str] = []

    constraints = context.get("constraints") or {}
    status = context.get("status") or {}
    plan_window = context.get("plan_window") or {}
    fitness = context.get("fitness") or {}

    runs_recent = constraints.get("runs_last_21d")
    days_since = status.get("days_since_last_run")

    # De tegenstrijdigheid die dit bestand bestaansrecht geeft: je kunt niet
    # tegelijk recent gelopen hebben en al weken stilliggen. quality_variety
    # eist dan intensiteit terwijl return_to_run die verbiedt, en het model
    # blijft daartussen heen en weer springen tot de pogingen op zijn.
    if runs_recent and days_since is not None and float(days_since) > INACTIVE_DAYS:
        problems.append(
            f"runs_last_21d is {runs_recent} maar days_since_last_run is {days_since}: "
            "recent gelopen en langer dan drie weken inactief kan niet allebei. "
            "quality_variety_required en return_to_run_phase sluiten elkaar dan uit."
        )

    ceiling = constraints.get("entry_week_ceiling_m")
    if ceiling is not None and float(ceiling) <= 0:
        problems.append("entry_week_ceiling_m is nul of negatief; er is geen ruimte om te plannen.")

    hr_cap = constraints.get("easy_hr_cap")
    if hr_cap is not None and not (80 <= float(hr_cap) <= 200):
        problems.append(f"easy_hr_cap van {hr_cap} ligt buiten elk plausibel bereik.")

    goal = context.get("goal") or {}
    target = _as_date(goal.get("target_date"))
    today = _as_date(context.get("today"))
    if target and today and target < today:
        problems.append(f"doeldatum {target} ligt in het verleden.")

    start = _as_date(plan_window.get("plan_start_date"))
    if start and today and start < today:
        problems.append(f"plan_start_date {start} ligt vóór vandaag ({today}).")

    anchor = fitness.get("anchor")
    if anchor and not (anchor.get("basis") or {}).get("confidence"):
        problems.append("fitness.anchor mist basis.confidence; tempodoelen worden dan giswerk.")

    return problems


def require_consistent(context: dict[str, Any]) -> None:
    """Stop vóór de eerste betaalde aanroep als de context niet klopt."""
    problems = check(context)
    if not problems:
        return
    for p in problems:
        log.error("context inconsistent: %s", p)
    raise InconsistentContext(
        "De context spreekt zichzelf tegen, dus een planaanvraag zou alleen geld "
        "kosten:\n- " + "\n- ".join(problems)
    )
