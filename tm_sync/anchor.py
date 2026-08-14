"""Het vormanker: één verdedigbare schatting van wat je nú kunt.

Elk tempodoel in een schema rust hierop. Zonder anker is "loop deze interval op
4:40" giswerk, en dat is precies wat er gebeurde: de oude schatter behandelde
elke run vanaf 2 km als een maximale inspanning. Eén rustige jog van 6:08/km
werd zo "5 km in 30:38", terwijl dezelfde loper er een half jaar eerder 19:22
op stond.

Drie bronnen, in deze volgorde:

1. **Eigen inspanningen.** Alleen runs die plausibel een prestatie waren, niet
   elke run die ver genoeg was. Het beste bewijs, als het er is.
2. **Garmins voorspeller.** Continu bijgewerkt en houdt rekening met vormverlies.
   De juiste terugval wanneer er al weken niet hard gelopen is.
3. **Historisch record, verouderd.** Laatste redmiddel, en nooit als doel: het
   zegt wat je ooit kon, niet wat je vandaag kunt.

Bij twee bruikbare bronnen wint de conservatieve. Een te optimistisch anker
levert tempodoelen op die niemand haalt, en dat is schadelijker dan een te
voorzichtig schema.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any

from . import clock

log = logging.getLogger(__name__)

# Onder dit aandeel van de drempel-hartslag was het geen prestatie maar een
# rustige run. Bewust laag gezet: het doel is de duidelijke hersteljogs eruit
# filteren, niet bepalen wat "hard genoeg" is.
EFFORT_HR_FRACTION = 0.90

# Ruimer dan het venster van zes weken voor de gewone schatting: een echte
# inspanning van drie maanden geleden zegt meer over je vermogen dan een
# drafje van gisteren.
ANCHOR_WINDOW_DAYS = 120

# Tot deze leeftijd geldt eigen bewijs als vers.
FRESH_DAYS = 42

TARGET_KEYS = ("5k", "10k", "half", "marathon")


def is_effort(run: dict[str, Any], threshold_hr: float | None) -> bool:
    """Was dit een prestatie, of gewoon een run die toevallig lang genoeg was?

    Zonder hartslag kunnen we het niet uitsluiten en tellen we hem mee: liever
    een schatting met ruis dan helemaal geen bewijs.
    """
    avg_hr = run.get("avg_hr")
    if not threshold_hr or not avg_hr:
        return True
    return float(avg_hr) >= EFFORT_HR_FRACTION * float(threshold_hr)


def _age_days(day: str, today: date) -> int:
    try:
        return (today - date.fromisoformat(day[:10])).days
    except (ValueError, TypeError):
        return 10_000


def _confidence(source: str, age: int, samples: int) -> str:
    if source == "own_effort":
        if age <= FRESH_DAYS and samples >= 2:
            return "high"
        return "medium"
    if source == "garmin":
        return "medium"
    return "low"


def build(
    *,
    own: dict[str, Any] | None,
    garmin_predictions: dict[str, Any] | None,
    historical: dict[str, Any] | None,
    today: date | None = None,
) -> dict[str, Any] | None:
    """Kies de bron en geef één anker terug, met verantwoording erbij.

    `own` en `historical` zijn rijen zoals `_estimate` ze maakt;
    `garmin_predictions` is Garmins voorspelling in seconden per afstand.
    """
    today = today or clock.today()

    own_times = _times(own)
    garmin_times = _times_from_predictions(garmin_predictions)

    if own_times:
        age = _age_days(_newest_evidence(own), today)
        samples = int((own or {}).get("sample_size") or 0)
        source = "own_effort"
        times = own_times
        evidence = _newest_evidence(own)

        # Wijken eigen schatting en Garmin af, neem dan de voorzichtige. Dit is
        # dezelfde regel die de coachprompt al hanteert, nu ook in de data.
        #
        # Garmin vult bovendien de afstanden waar eigen bewijs ontbreekt: Riegel
        # mag maar een factor drie extrapoleren, dus een reeks runs van 5 km
        # zegt niets over een halve of hele marathon. Zonder deze aanvulling
        # bleven die leeg terwijl er wel een schatting beschikbaar was.
        if garmin_times:
            merged = dict(garmin_times)
            for key, value in times.items():
                merged[key] = max(value, garmin_times[key]) if key in garmin_times else value
            if merged != times:
                source = "own_effort+garmin"
            times = merged
    elif garmin_times:
        source, times, evidence, samples = "garmin", garmin_times, today.isoformat(), 0
        age = 0
    elif historical:
        source = "historical_aged"
        times = _times(historical) or {}
        evidence = _newest_evidence(historical)
        age = _age_days(evidence, today)
        samples = int(historical.get("sample_size") or 0)
    else:
        return None

    if not times:
        return None

    return {
        "day": today.isoformat(),
        "scope": "anchor",
        "window_days": ANCHOR_WINDOW_DAYS,
        "equiv_5k_s": times.get("5k"),
        "equiv_10k_s": times.get("10k"),
        "equiv_half_s": times.get("half"),
        "equiv_marathon_s": times.get("marathon"),
        "critical_speed_m_per_s": (own or historical or {}).get("critical_speed_m_per_s"),
        "vo2max": (own or {}).get("vo2max") or (historical or {}).get("vo2max"),
        "sample_size": samples,
        "basis": {
            "source": source,
            "evidence_date": evidence,
            "evidence_age_days": age,
            "confidence": _confidence(source.split("+")[0], age, samples),
            "garmin_predictions": garmin_times or None,
            "note": (
                "Bij tegenstrijdige bronnen wint de langzaamste. Bij confidence "
                "'low' of 'medium' hoort een tempodoel een ruime band te krijgen."
            ),
        },
    }


def _times(estimate: dict[str, Any] | None) -> dict[str, int] | None:
    if not estimate:
        return None
    out = {
        "5k": estimate.get("equiv_5k_s"),
        "10k": estimate.get("equiv_10k_s"),
        "half": estimate.get("equiv_half_s"),
        "marathon": estimate.get("equiv_marathon_s"),
    }
    filtered = {k: int(v) for k, v in out.items() if v}
    return filtered or None


def _times_from_predictions(predictions: dict[str, Any] | None) -> dict[str, int] | None:
    if not isinstance(predictions, dict):
        return None
    filtered = {}
    for key in TARGET_KEYS:
        value = predictions.get(key)
        if isinstance(value, (int, float)) and value > 0:
            filtered[key] = int(value)
    return filtered or None


def _newest_evidence(estimate: dict[str, Any] | None) -> str:
    """De datum van de meest recente inspanning waarop deze schatting rust."""
    basis = (estimate or {}).get("basis") or {}
    days = [v.get("date") for v in basis.values() if isinstance(v, dict) and v.get("date")]
    return max(days) if days else "1970-01-01"


def window_start(today: date | None = None) -> str:
    today = today or clock.today()
    return (today - timedelta(days=ANCHOR_WINDOW_DAYS)).isoformat()
