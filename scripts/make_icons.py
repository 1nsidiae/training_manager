"""Genereer de PWA-iconen.

Draaien met:  uv run --with pillow scripts/make_icons.py

Bewust een eigen script en geen dependency in pyproject: dit hoeft één keer per
ontwerpwijziging te draaien, niet bij elke sync.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

BG = (8, 8, 11)
BRAND = (184, 255, 60)
TRACK = (26, 26, 33)

OUT = Path(__file__).resolve().parent.parent / "web" / "public" / "icons"


def draw_icon(size: int) -> Image.Image:
    # 4x oversampling, daarna verkleinen: goedkope anti-aliasing.
    scale = 4
    s = size * scale
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)

    # Maskable icons hebben een veilige zone van ~80%; houd het beeldmerk binnen.
    pad = s * 0.26
    box = (pad, pad, s - pad, s - pad)
    width = int(s * 0.085)

    d.arc(box, start=0, end=360, fill=TRACK, width=width)
    # Open ring van 270 graden: voortgang, niet voltooiing.
    d.arc(box, start=-90, end=180, fill=BRAND, width=width)

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512, 180):
        name = "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
        path = OUT / name
        draw_icon(size).save(path, "PNG")
        print(f"{path.relative_to(OUT.parent.parent.parent)}  ({size}x{size})")


if __name__ == "__main__":
    main()
