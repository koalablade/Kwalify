#!/usr/bin/env python3
"""
DEV ONLY: procedural 1920x1080 placeholders for layout / routing tests.

Production stills must be photorealistic per cinema/scenes.manifest.json prompts.
Run: python scripts/validate_cinema_assets.py
"""
from __future__ import annotations

import math
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "api-server" / "public" / "cinema"
W, H = 1920, 1080


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _rgb(r: int, g: int, b: int) -> tuple[int, int, int]:
    return (max(0, min(255, r)), max(0, min(255, g)), max(0, min(255, b)))


def _vignette(img: Image.Image, strength: float = 0.55) -> Image.Image:
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    cx, cy = W / 2, H / 2
    for y in range(0, H, 8):
        for x in range(0, W, 8):
            dx = (x - cx) / cx
            dy = (y - cy) / cy
            d = min(1.0, math.sqrt(dx * dx + dy * dy))
            a = int(255 * strength * (d**1.8))
            draw.rectangle([x, y, x + 7, y + 7], fill=(0, 0, 0, a))
    base = img.convert("RGBA")
    return Image.alpha_composite(base, overlay).convert("RGB")


def _horizon_band(
    draw: ImageDraw.ImageDraw,
    y0: int,
    top: tuple[int, int, int],
    bottom: tuple[int, int, int],
    steps: int = 120,
) -> None:
    for i in range(steps):
        t = i / max(1, steps - 1)
        c = _rgb(
            int(_lerp(top[0], bottom[0], t)),
            int(_lerp(top[1], bottom[1], t)),
            int(_lerp(top[2], bottom[2], t)),
        )
        y1 = y0 + int((H - y0) * (i / steps))
        y2 = y0 + int((H - y0) * ((i + 1) / steps))
        draw.rectangle([0, y1, W, y2], fill=c)


def _road_perspective(draw: ImageDraw.ImageDraw, vanish_y: int, color: tuple[int, int, int]) -> None:
    pts = [(0, H), (W, H), (W * 0.62, vanish_y), (W * 0.38, vanish_y)]
    draw.polygon(pts, fill=color)
    for i in range(14):
        t = i / 13
        y = int(_lerp(H - 40, vanish_y + 30, t))
        half = int(_lerp(W * 0.48, 12, t**1.15))
        cx = W // 2
        shade = _rgb(color[0] + 18, color[1] + 18, color[2] + 22)
        draw.line([(cx - half, y), (cx + half, y)], fill=shade, width=max(2, int(6 * (1 - t) + 1)))


def draw_petrol_station_2am() -> Image.Image:
    """Reference scene: fluorescent forecourt, pumps, wet concrete — structured, not gradients."""
    img = Image.new("RGB", (W, H), (5, 7, 12))
    draw = ImageDraw.Draw(img)

    # Night sky — flat bands, not radial blobs
    for i in range(36):
        t = i / 35
        c = _rgb(int(6 + 8 * t), int(8 + 10 * t), int(14 + 12 * t))
        draw.rectangle([0, int(H * 0.02 * t), W, int(H * 0.02 * (t + 0.03) + 4)], fill=c)

    draw.rectangle([0, int(H * 0.4), W, int(H * 0.5)], fill=(10, 12, 18))

    canopy_y = int(H * 0.2)
    # Canopy deck + fascia lights
    draw.rectangle([int(W * 0.1), canopy_y, int(W * 0.9), canopy_y + 36], fill=(225, 235, 245))
    for lx in range(int(W * 0.12), int(W * 0.88), 48):
        draw.rectangle([lx, canopy_y + 6, lx + 32, canopy_y + 14], fill=(255, 255, 255))

    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glow)
    gdraw.rectangle([int(W * 0.06), canopy_y - 20, int(W * 0.94), canopy_y + 140], fill=(200, 230, 255, 55))
    gdraw.rectangle([int(W * 0.15), int(H * 0.48), int(W * 0.85), H], fill=(255, 245, 220, 28))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")
    draw = ImageDraw.Draw(img)

    for x in (0.2, 0.35, 0.5, 0.65, 0.8):
        px = int(W * x)
        draw.rectangle([px - 12, canopy_y + 32, px + 12, int(H * 0.74)], fill=(24, 26, 34))

    _road_perspective(draw, int(H * 0.46), (20, 22, 28))
    # Forecourt lane paint
    cx = W // 2
    for i in range(6):
        y = int(H * (0.56 + i * 0.06))
        half = int(_lerp(220, 40, i / 5))
        draw.line([(cx - half, y), (cx + half, y)], fill=(55, 60, 70), width=3)

    for i in range(10):
        y = int(H * (0.54 + i * 0.042))
        draw.rectangle([int(W * 0.22), y, int(W * 0.78), y + 5], fill=(48, 56, 68))

    for x, accent, sign in ((0.32, (255, 70, 30), (255, 200, 80)), (0.68, (50, 170, 255), (180, 220, 255))):
        px = int(W * x)
        draw.rectangle([px - 38, int(H * 0.36), px + 38, int(H * 0.8)], fill=(8, 10, 14))
        draw.rectangle([px - 26, int(H * 0.4), px + 26, int(H * 0.54)], fill=accent)
        draw.rectangle([px - 10, int(H * 0.56), px + 10, int(H * 0.76)], fill=(32, 36, 46))
        draw.rectangle([px - 18, int(H * 0.33), px + 18, int(H * 0.38)], fill=sign)

    # Shop window strip (lit interior)
    draw.rectangle([int(W * 0.42), int(H * 0.3), int(W * 0.58), int(H * 0.36)], fill=(255, 230, 160))
    draw.rectangle([int(W * 0.44), int(H * 0.31), int(W * 0.56), int(H * 0.35)], fill=(40, 90, 70))

    img = img.filter(ImageFilter.GaussianBlur(radius=0.45))
    return _vignette(img, 0.5)


def draw_night_drive() -> Image.Image:
    img = Image.new("RGB", (W, H), (4, 6, 12))
    draw = ImageDraw.Draw(img)
    _horizon_band(draw, 0, (6, 8, 16), (10, 14, 22), 60)
    _road_perspective(draw, int(H * 0.46), (18, 20, 28))
    # Dashboard glow bottom
    draw.polygon([(0, H), (W, H), (W, int(H * 0.72)), (0, int(H * 0.78))], fill=(30, 22, 12))
    draw.rectangle([0, int(H * 0.82), W, H], fill=(255, 160, 60))
    # Tunnel lights streak
    for i in range(16):
        x = int(W * (0.15 + i * 0.045))
        draw.rectangle([x, int(H * 0.35), x + 8, int(H * 0.75)], fill=(255, 230, 180))
    # Rain streaks
    rng = [(int(W * 0.1 * k), int(H * 0.2 + (k * 37) % int(H * 0.6))) for k in range(120)]
    for x, y in rng:
        draw.line([(x, y), (x + 2, y + 28)], fill=(140, 170, 210), width=1)
    return _vignette(img, 0.5)


def draw_sunset_coast() -> Image.Image:
    img = Image.new("RGB", (W, H), (24, 16, 12))
    draw = ImageDraw.Draw(img)
    for i in range(100):
        t = i / 99
        c = _rgb(int(255 * (1 - t) * 0.9 + 40 * t), int(120 * (1 - t) + 30 * t), int(40 * (1 - t) + 20 * t))
        draw.rectangle([0, int(H * 0.08 * t), W, int(H * 0.08 * (t + 0.01) + 8)], fill=c)
    draw.rectangle([0, int(H * 0.55), W, H], fill=(12, 28, 42))  # sea
    for i in range(12):
        y = int(H * 0.58 + i * 22)
        draw.rectangle([0, y, W, y + 8], fill=(20, 50, 68))
    # Sun disc
    draw.ellipse([int(W * 0.38), int(H * 0.18), int(W * 0.62), int(H * 0.34)], fill=(255, 190, 90))
    # Shore line
    draw.polygon([(0, int(H * 0.72)), (W, int(H * 0.68)), (W, H), (0, H)], fill=(18, 14, 10))
    return _vignette(img, 0.42)


def draw_urban_midnight_walk() -> Image.Image:
    img = Image.new("RGB", (W, H), (8, 10, 18))
    draw = ImageDraw.Draw(img)
    _road_perspective(draw, int(H * 0.5), (16, 18, 26))
    # Building blocks
    for i, (x, h, tone) in enumerate(
        [
            (0.05, 0.55, (18, 22, 34)),
            (0.18, 0.7, (22, 26, 40)),
            (0.35, 0.48, (14, 18, 28)),
            (0.55, 0.75, (24, 28, 44)),
            (0.72, 0.6, (20, 24, 36)),
            (0.88, 0.52, (16, 20, 30)),
        ]
    ):
        bx = int(W * x)
        bh = int(H * h)
        draw.rectangle([bx, H - bh, bx + int(W * 0.14), H], fill=tone)
        for w in range(4):
            draw.rectangle(
                [bx + 12 + w * 28, H - bh + 40, bx + 28 + w * 28, H - bh + 70],
                fill=(255, 200, 120) if (i + w) % 3 else (80, 160, 255),
            )
    # Wet street reflection
    draw.rectangle([0, int(H * 0.78), W, H], fill=(30, 40, 60))
    return _vignette(img, 0.52)


def draw_train_journey() -> Image.Image:
    img = Image.new("RGB", (W, H), (20, 22, 28))
    draw = ImageDraw.Draw(img)
    # Window frame
    draw.rectangle([int(W * 0.08), int(H * 0.12), int(W * 0.92), int(H * 0.88)], fill=(32, 34, 42))
    draw.rectangle([int(W * 0.14), int(H * 0.18), int(W * 0.86), int(H * 0.82)], fill=(50, 70, 90))
    # Motion blur outside
    for i in range(40):
        y = int(H * 0.2 + i * 18)
        draw.rectangle([int(W * 0.16), y, int(W * 0.84), y + 10], fill=(70 + i, 90 + i, 110 + i))
    # Interior warm seat edge
    draw.rectangle([0, int(H * 0.65), int(W * 0.22), H], fill=(55, 38, 28))
    draw.rectangle([int(W * 0.78), int(H * 0.6), W, H], fill=(48, 32, 24))
    # Reflection on glass
    draw.polygon(
        [
            (int(W * 0.55), int(H * 0.2)),
            (int(W * 0.82), int(H * 0.35)),
            (int(W * 0.7), int(H * 0.75)),
            (int(W * 0.4), int(H * 0.55)),
        ],
        fill=(90, 95, 105),
    )
    return _vignette(img, 0.45)


def draw_summer_afternoon_drift() -> Image.Image:
    img = Image.new("RGB", (W, H), (72, 58, 38))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, int(H * 0.45)], fill=(130, 170, 220))
    draw.rectangle([0, int(H * 0.45), W, H], fill=(88, 72, 48))
    # Suburban roofline
    for x in range(0, W, 180):
        draw.polygon([(x, int(H * 0.5)), (x + 90, int(H * 0.38)), (x + 180, int(H * 0.5)), (x + 180, int(H * 0.62)), (x, int(H * 0.62))], fill=(62, 50, 36))
    # Haze
    haze = Image.new("RGBA", (W, H), (255, 230, 180, 40))
    img = Image.alpha_composite(img.convert("RGBA"), haze).convert("RGB")
    return _vignette(img, 0.38)


def draw_rainy_city_interior() -> Image.Image:
    img = Image.new("RGB", (W, H), (14, 16, 22))
    draw = ImageDraw.Draw(img)
    # Room interior
    draw.rectangle([0, 0, int(W * 0.55), H], fill=(22, 20, 18))
    # Window pane (right)
    draw.rectangle([int(W * 0.52), int(H * 0.08), W, int(H * 0.92)], fill=(30, 45, 60))
    for i in range(90):
        x = int(W * 0.55 + (i * 17) % int(W * 0.4))
        y = int(H * 0.1 + (i * 23) % int(H * 0.8))
        draw.line([(x, y), (x + 1, y + 22)], fill=(160, 190, 220))
    # Lamp glow
    draw.ellipse([int(W * 0.08), int(H * 0.25), int(W * 0.22), int(H * 0.42)], fill=(255, 200, 120))
    draw.rectangle([int(W * 0.11), int(H * 0.55), int(W * 0.16), int(H * 0.72)], fill=(40, 32, 24))
    return _vignette(img, 0.5)


def draw_memory_road() -> Image.Image:
    img = Image.new("RGB", (W, H), (48, 42, 32))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, int(H * 0.5)], fill=(90, 70, 50))
    _road_perspective(draw, int(H * 0.52), (36, 32, 26))
    # Fields
    draw.rectangle([0, int(H * 0.48), int(W * 0.35), int(H * 0.7)], fill=(50, 70, 40))
    draw.rectangle([int(W * 0.65), int(H * 0.48), W, int(H * 0.72)], fill=(45, 65, 38))
    # Fading light band
    draw.rectangle([0, int(H * 0.2), W, int(H * 0.32)], fill=(200, 160, 100))
    return _vignette(img, 0.44)


def draw_club_exit_dawn() -> Image.Image:
    img = Image.new("RGB", (W, H), (36, 52, 82))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, int(H * 0.35), W, H], fill=(16, 18, 24))
    _road_perspective(draw, int(H * 0.55), (20, 22, 30))
    # Blue hour sky
    for i in range(60):
        t = i / 59
        c = _rgb(int(60 + 80 * t), int(90 + 50 * t), int(130 - 40 * t))
        draw.rectangle([0, int(H * 0.12 * t), W, int(H * 0.12 * (t + 0.02) + 6)], fill=c)
    # Street lamp
    draw.rectangle([int(W * 0.62), int(H * 0.28), int(W * 0.64), int(H * 0.7)], fill=(30, 32, 40))
    draw.ellipse([int(W * 0.58), int(H * 0.24), int(W * 0.68), int(H * 0.32)], fill=(255, 230, 180))
    return _vignette(img, 0.48)


def draw_open_highway_daylight() -> Image.Image:
    img = Image.new("RGB", (W, H), (100, 150, 200))
    draw = ImageDraw.Draw(img)
    draw.rectangle([0, 0, W, int(H * 0.42)], fill=(120, 175, 230))
    _road_perspective(draw, int(H * 0.48), (48, 50, 54))
    # Lane markings
    cx = W // 2
    for i in range(10):
        y = int(H * (0.52 + i * 0.045))
        draw.rectangle([cx - 6, y, cx + 6, y + int(30 - i * 2)], fill=(230, 230, 220))
    # Guardrails
    draw.line([(int(W * 0.18), H), (int(W * 0.32), int(H * 0.5))], fill=(180, 185, 195), width=6)
    draw.line([(int(W * 0.82), H), (int(W * 0.68), int(H * 0.5))], fill=(180, 185, 195), width=6)
    return _vignette(img, 0.35)


SCENE_DRAWERS = {
    "petrol_station_2am": draw_petrol_station_2am,
    "night_drive": draw_night_drive,
    "sunset_coast": draw_sunset_coast,
    "urban_midnight_walk": draw_urban_midnight_walk,
    "train_journey": draw_train_journey,
    "summer_afternoon_drift": draw_summer_afternoon_drift,
    "rainy_city_interior": draw_rainy_city_interior,
    "memory_road": draw_memory_road,
    "club_exit_dawn": draw_club_exit_dawn,
    "open_highway_daylight": draw_open_highway_daylight,
}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for scene_id, drawer in SCENE_DRAWERS.items():
        scene_dir = OUT / scene_id
        scene_dir.mkdir(parents=True, exist_ok=True)
        path = scene_dir / "still.jpg"
        img = drawer()
        img.save(path, "JPEG", quality=92, optimize=True)
        print(f"wrote {path} ({path.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
