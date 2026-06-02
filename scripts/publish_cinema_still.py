#!/usr/bin/env python3
"""Resize and publish a generated still into cinema/{scene_id}/still.jpg (1920x1080)."""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_BASE = ROOT / "artifacts" / "api-server" / "public" / "cinema"
TARGET_W, TARGET_H = 1920, 1080

MAPPING = {
    "petrol_station_2am_still.png": "petrol_station_2am",
    "night_drive_still.png": "night_drive",
    "sunset_coast_still.png": "sunset_coast",
    "urban_midnight_walk_still.png": "urban_midnight_walk",
    "train_journey_still.png": "train_journey",
    "summer_afternoon_drift_still.png": "summer_afternoon_drift",
    "rainy_city_interior_still.png": "rainy_city_interior",
    "memory_road_still.png": "memory_road",
    "club_exit_dawn_still.png": "club_exit_dawn",
    "open_highway_daylight_still.png": "open_highway_daylight",
}


def publish(src: Path, scene_id: str) -> Path:
    img = Image.open(src).convert("RGB")
    img = img.resize((TARGET_W, TARGET_H), Image.Resampling.LANCZOS)
    dest_dir = OUT_BASE / scene_id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / "still.jpg"
    img.save(dest, "JPEG", quality=93, optimize=True)
    return dest


def main() -> None:
    assets = Path.home() / ".cursor" / "projects" / "c-Users-Kwalah-Projects-Kwalify" / "assets"
    if len(sys.argv) >= 3:
        publish(Path(sys.argv[1]), sys.argv[2])
        return
    if not assets.is_dir():
        print("Usage: publish_cinema_still.py <src> <scene_id>  OR run from repo with assets in .cursor/.../assets")
        sys.exit(1)
    for name, scene_id in MAPPING.items():
        src = assets / name
        if not src.is_file():
            print(f"skip missing {src}")
            continue
        dest = publish(src, scene_id)
        print(f"{scene_id} -> {dest} ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
