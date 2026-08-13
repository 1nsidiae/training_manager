"""Google encoded-polyline encoder.

Een run van 8 km is als encoded polyline ~20 KB in plaats van ~200 KB ruwe
punten, en zowel Leaflet als MapLibre kunnen het met een paar regels decoderen.
Geen externe dependency nodig — het algoritme is een pagina code.
"""

from __future__ import annotations

from collections.abc import Iterable


def _encode_value(value: int) -> str:
    value = ~(value << 1) if value < 0 else (value << 1)
    chunks = []
    while value >= 0x20:
        chunks.append((0x20 | (value & 0x1F)) + 63)
        value >>= 5
    chunks.append(value + 63)
    return "".join(chr(c) for c in chunks)


def encode(points: Iterable[tuple[float, float]], precision: int = 5) -> str:
    """Codeer (lat, lon)-paren naar een encoded polyline."""
    factor = 10**precision
    prev_lat = prev_lon = 0
    out: list[str] = []

    for lat, lon in points:
        lat_i = round(lat * factor)
        lon_i = round(lon * factor)
        out.append(_encode_value(lat_i - prev_lat))
        out.append(_encode_value(lon_i - prev_lon))
        prev_lat, prev_lon = lat_i, lon_i

    return "".join(out)
