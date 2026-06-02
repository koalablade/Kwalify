#!/usr/bin/env python3
"""Validate Kwalify cinema library assets against scenes.manifest.json."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CINEMA = ROOT / "artifacts" / "api-server" / "public" / "cinema"
MANIFEST = CINEMA / "scenes.manifest.json"


def main() -> int:
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    scenes = data["scenes"]
    video_scenes = set(data.get("videoScenes", []))
    errors: list[str] = []

    for scene_id, meta in scenes.items():
        still = CINEMA / scene_id / "still.jpg"
        if not still.is_file():
            errors.append(f"missing required still: {still}")
        elif still.stat().st_size < 20_000:
            errors.append(f"still too small (likely placeholder): {still}")

        if meta.get("videoAllowed") and scene_id not in video_scenes:
            errors.append(f"manifest mismatch: {scene_id} videoAllowed but not in videoScenes")

        for ext in (".mp4",):
            for candidate in (CINEMA / f"{scene_id}{ext}", CINEMA / scene_id / "base.mp4"):
                if candidate.is_file() and scene_id not in video_scenes:
                    errors.append(f"video present but scene not in videoScenes: {candidate}")

    if errors:
        print("Cinema asset validation FAILED:")
        for e in errors:
            print(f"  - {e}")
        return 1

    print(f"OK: {len(scenes)} scenes with still.jpg; video allowed: {sorted(video_scenes)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
