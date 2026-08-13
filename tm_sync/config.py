"""Configuratie uit environment variabelen."""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    supabase_service_key: str
    garmin_tokenstore: str
    fit_bucket: str
    throttle_s: float
    anthropic_api_key: str

    def require_anthropic(self) -> str:
        if not self.anthropic_api_key:
            sys.exit(
                "ANTHROPIC_API_KEY ontbreekt. Zet hem in .env — de coach-engine "
                "kan zonder niet draaien."
            )
        return self.anthropic_api_key


def load_settings() -> Settings:
    missing = [
        name
        for name in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")
        if not os.environ.get(name)
    ]
    if missing:
        sys.exit(
            "Ontbrekende environment variabelen: "
            + ", ".join(missing)
            + "\nKopieer .env.example naar .env en vul ze aan."
        )

    return Settings(
        supabase_url=os.environ["SUPABASE_URL"],
        supabase_service_key=os.environ["SUPABASE_SERVICE_ROLE_KEY"],
        garmin_tokenstore=os.environ.get("GARMIN_TOKENSTORE", "~/.garminconnect"),
        fit_bucket=os.environ.get("FIT_BUCKET", "garmin-fit"),
        throttle_s=float(os.environ.get("GARMIN_THROTTLE_S", "0.7")),
        anthropic_api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
    )
