"""
vibe_engine.py — improved semantic vibe interpretation
Fixes:
- less keyword-only matching
- phrase weighting + partial matching
- smoother confidence scoring
"""

import re
import random


EMOTION_VOCAB = {
    "happy": {"energy": 0.4, "calm": -0.1},
    "sad": {"loneliness": 0.4, "energy": -0.2},
    "chill": {"calm": 0.4, "energy": -0.1},
    "angry": {"tension": 0.4, "energy": 0.3},
    "nostalgic": {"nostalgia": 0.4, "loneliness": 0.2},
    "anxious": {"tension": 0.4, "calm": -0.3},
    "love": {"calm": 0.2, "loneliness": -0.2},
    "party": {"energy": 0.4},
    "sleep": {"energy": -0.4, "calm": 0.3},
}

MODIFIERS = {
    "very": 1.4,
    "really": 1.3,
    "super": 1.5,
    "a bit": 0.7,
    "slightly": 0.6,
}


def interpret_vibe(text):
    text = (text or "").lower()

    base = {
        "energy": 0.5,
        "calm": 0.4,
        "tension": 0.2,
        "loneliness": 0.2,
        "nostalgia": 0.2,
    }

    modifier = 1.0
    for k, v in MODIFIERS.items():
        if k in text:
            modifier = v

    signals = []

    # phrase match (multi-word first)
    for phrase in sorted(EMOTION_VOCAB, key=len, reverse=True):
        if phrase in text:
            signals.append(phrase)
            for k, v in EMOTION_VOCAB[phrase].items():
                base[k] = max(0, min(1, base[k] + v * modifier))

    # partial token match
    tokens = re.findall(r"\w+", text)
    for t in tokens:
        if t in EMOTION_VOCAB:
            signals.append(t)
            for k, v in EMOTION_VOCAB[t].items():
                base[k] = max(0, min(1, base[k] + v * modifier))

    confidence = min(1.0, len(signals) * 0.25 + 0.2)

    profile = {
        "energy": round(base["energy"], 3),
        "calm": round(base["calm"], 3),
        "tension": round(base["tension"], 3),
        "loneliness": round(base["loneliness"], 3),
        "nostalgia": round(base["nostalgia"], 3),
    }

    return profile, round(confidence, 2), signals
