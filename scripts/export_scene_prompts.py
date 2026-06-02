#!/usr/bin/env python3
"""Print full generation prompts from cinema/scenes.manifest.json (master brand set)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "artifacts" / "api-server" / "public" / "cinema" / "scenes.manifest.json"
SUFFIX = "16:9 aspect ratio, 1920x1080, no text, no watermark."


def full_prompt(manifest: dict, scene_id: str, scene: dict) -> str:
    prefix = manifest.get("stylePrefix", "").strip()
    body = scene.get("scenePrompt") or scene.get("prompt", "")
    return f"{prefix}, {body.strip()}, {SUFFIX}"


def main() -> None:
    if not MANIFEST.is_file():
        print(f"Missing manifest: {MANIFEST}", file=sys.stderr)
        sys.exit(1)
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    scenes = data.get("scenes") or {}
    order = [
        "night_drive",
        "petrol_station_2am",
        "sunset_coast",
        "urban_midnight_walk",
        "train_journey",
        "summer_afternoon_drift",
        "rainy_city_interior",
        "memory_road",
        "club_exit_dawn",
        "open_highway_daylight",
    ]
    print("# Kwalify scene prompts — paste into image generator\n")
    print(f"Brand: {data.get('brandConsistency', '')}\n")
    if data.get("avoid"):
        print("Avoid:", ", ".join(data["avoid"]), "\n")
    for sid in order:
        if sid not in scenes:
            continue
        s = scenes[sid]
        print(f"## {sid}")
        print(f"Character: {s.get('character', s.get('emotion', ''))}")
        print(f"Lighting: {s.get('lighting', '')}")
        print(f"Composition: {s.get('composition', '')}")
        print(f"Atmosphere: {s.get('atmosphere', '')}")
        print(f"Key rule: {s.get('keyRule', '')}")
        print(f"Output: cinema/{sid}/still.jpg\n")
        print(full_prompt(data, sid, s))
        print("\n---\n")
    # JSON bundle for tooling
    if "--json" in sys.argv:
        out = {sid: full_prompt(data, sid, scenes[sid]) for sid in order if sid in scenes}
        print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
