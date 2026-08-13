"""JSON-schema voor de planoutput van de coach.

Wordt als `output_config.format` meegegeven, zodat het model geen vrije tekst
teruggeeft maar een structuur die de app direct kan renderen en valideren.

Structured outputs ondersteunt geen recursieve schema's en geen numerieke
begrenzingen (minimum/maximum); die controles doen de guardrails.
"""

from __future__ import annotations

from typing import Any

SESSION_TYPES = [
    "rest",
    "recovery",
    "easy",
    "long",
    "tempo",
    "interval",
    "walk_run",
    "race",
    "strength",
    "cross_training",
]

STEP_TYPES = ["warmup", "work", "recover", "rest", "cooldown", "walk", "run"]


def _bilingual(description: str) -> dict[str, Any]:
    return {
        "type": "object",
        "description": description,
        "properties": {
            "nl": {"type": "string"},
            "en": {"type": "string"},
        },
        "required": ["nl", "en"],
        "additionalProperties": False,
    }


_STEP = {
    "type": "object",
    "properties": {
        "type": {"type": "string", "enum": STEP_TYPES},
        "repeat": {
            "type": "integer",
            "description": "Aantal herhalingen van deze stap. 1 als hij eenmalig is.",
        },
        "duration_s": {"type": "integer", "description": "0 als de stap op afstand gaat."},
        "distance_m": {"type": "integer", "description": "0 als de stap op tijd gaat."},
        "hr_min": {"type": "integer", "description": "0 als er geen ondergrens is."},
        "hr_max": {"type": "integer", "description": "0 als er geen bovengrens is."},
        "pace_min_s_per_km": {
            "type": "integer",
            "description": (
                "Snelste kant van het tempodoel in seconden per kilometer "
                "(dus het laagste getal). 0 als er geen tempodoel is."
            ),
        },
        "pace_max_s_per_km": {
            "type": "integer",
            "description": (
                "Langzaamste kant van het tempodoel in seconden per kilometer. "
                "0 als er geen tempodoel is."
            ),
        },
        "note": {"type": "string"},
    },
    "required": [
        "type",
        "repeat",
        "duration_s",
        "distance_m",
        "hr_min",
        "hr_max",
        "pace_min_s_per_km",
        "pace_max_s_per_km",
        "note",
    ],
    "additionalProperties": False,
}

_SESSION = {
    "type": "object",
    "properties": {
        "date": {"type": "string", "description": "YYYY-MM-DD"},
        "session_type": {"type": "string", "enum": SESSION_TYPES},
        "title": _bilingual("Korte titel, bv. 'Rustige duurloop 5 km'."),
        "description": _bilingual(
            "Wat de sessie moet doen en waarop te letten. Twee zinnen, geen preek."
        ),
        "planned_distance_m": {"type": "integer", "description": "0 bij rust."},
        "planned_duration_s": {"type": "integer", "description": "0 bij rust."},
        "hr_cap": {
            "type": "integer",
            "description": (
                "Verplichte HR-bovengrens voor easy, long en recovery. 0 voor rust "
                "en voor sessies waar een bovengrens niet van toepassing is."
            ),
        },
        "target_type": {
            "type": "string",
            "enum": ["hr", "pace", "both", "none"],
            "description": (
                "Waarop de atleet stuurt tijdens deze sessie. easy/long/recovery: "
                "'hr' of 'both'. tempo/interval/race: 'pace' of 'both'. "
                "'none' alleen voor rust en kracht."
            ),
        },
        "steps": {"type": "array", "items": _STEP},
    },
    "required": [
        "date",
        "session_type",
        "title",
        "description",
        "planned_distance_m",
        "planned_duration_s",
        "hr_cap",
        "target_type",
        "steps",
    ],
    "additionalProperties": False,
}

_WEEK = {
    "type": "object",
    "properties": {
        "week_start": {"type": "string", "description": "Maandag, YYYY-MM-DD"},
        "focus": _bilingual("Waar deze week om draait, in een zin."),
        "planned_distance_m": {"type": "integer"},
        "sessions": {"type": "array", "items": _SESSION},
    },
    "required": ["week_start", "focus", "planned_distance_m", "sessions"],
    "additionalProperties": False,
}

_ADJUSTMENT = {
    "type": "object",
    "properties": {
        "rule": {
            "type": "string",
            "description": (
                "Key van de regel uit coach_rules die dit veroorzaakte, of "
                "'repeated_heavy_target_miss' voor de deterministische doelcontrole."
            ),
        },
        "severity": {"type": "string", "enum": ["info", "limit", "override"]},
        "explanation": _bilingual(
            "Uitleg met de concrete getallen erin, niet 'op basis van je herstel'."
        ),
        "evidence": {
            "type": "object",
            "description": "De waarden die de regel activeerden.",
            "properties": {
                "metric": {"type": "string"},
                "value": {"type": "number"},
                "threshold": {"type": "number"},
                "window": {"type": "string"},
            },
            "required": ["metric", "value", "threshold", "window"],
            "additionalProperties": False,
        },
    },
    "required": ["rule", "severity", "explanation", "evidence"],
    "additionalProperties": False,
}

_PROPOSED_RULE = {
    "type": "object",
    "properties": {
        "key": {"type": "string", "description": "snake_case machinenaam"},
        "title": _bilingual("Wat de regel doet."),
        "rationale": _bilingual("Welk patroon in de data hem rechtvaardigt."),
        "condition_metric": {"type": "string"},
        "condition_op": {"type": "string", "enum": ["<", "<=", ">", ">=", "==", "outside"]},
        "condition_value": {"type": "number"},
        "action": {"type": "string"},
        "observations": {
            "type": "integer",
            "description": "Aantal waarnemingen waarop dit gebaseerd is.",
        },
    },
    "required": [
        "key",
        "title",
        "rationale",
        "condition_metric",
        "condition_op",
        "condition_value",
        "action",
        "observations",
    ],
    "additionalProperties": False,
}

PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": _bilingual("Twee zinnen: wat dit plan doet en waarom."),
        "phase": {
            "type": "string",
            "description": "Naam van de fase, bv. 'terugkeer naar lopen, week 1-4'.",
        },
        "fitness_basis": {
            "type": "string",
            "description": (
                "Welke vormschatting gebruikt is en hoe zeker die is. Benoem het "
                "expliciet als de steekproef klein is."
            ),
        },
        "weeks": {"type": "array", "items": _WEEK},
        "adjustments": {
            "type": "array",
            "items": _ADJUSTMENT,
            "description": "Elke ingreep van een regel op dit plan, met bewijs.",
        },
        "proposed_rules": {
            "type": "array",
            "items": _PROPOSED_RULE,
            "description": (
                "Nieuwe regels op basis van patronen in de data. Laat leeg als er "
                "onvoldoende waarnemingen zijn; verzin geen patroon."
            ),
        },
    },
    "required": [
        "summary",
        "phase",
        "fitness_basis",
        "weeks",
        "adjustments",
        "proposed_rules",
    ],
    "additionalProperties": False,
}
