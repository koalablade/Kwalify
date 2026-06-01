/**
 * Context batch C — emotional states, mental/social context, weather, seasons, activities.
 * Merged in emotion.ts after extended A/B.
 */

import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

export const EXTENDED_VIBE_KEYWORDS_C: ExtendedVibeKeyword[] = [
  // ── Emotional states ────────────────────────────────────────────────────────
  {
    terms: ["pure happiness", "so happy", "blissful", "bliss", "joyful", "joyous"],
    weights: { energy: 0.2, valence: 0.45, tension: -0.15, calm: 0.1 },
  },
  {
    terms: ["excited", "buzzing", "pumped", "thrilled", "can't wait"],
    weights: { energy: 0.35, valence: 0.35, tension: 0.1, calm: -0.2 },
  },
  {
    terms: ["hopeful", "hopefulness", "looking forward", "things will get better"],
    weights: { energy: 0.1, valence: 0.35, tension: -0.15, nostalgia: 0.1 },
  },
  {
    terms: ["lonely", "loneliness", "feel alone", "isolated", "by myself sad"],
    weights: { energy: -0.15, valence: -0.3, tension: 0.2, nostalgia: 0.25, calm: 0.05 },
  },
  {
    terms: ["grief", "grieving", "mourning", "passed away", "loss of"],
    weights: { energy: -0.2, valence: -0.35, tension: 0.2, nostalgia: 0.4, calm: 0.15 },
  },
  {
    terms: ["angry", "anger", "furious", "rage", "pissed off"],
    weights: { energy: 0.35, valence: -0.35, tension: 0.45, calm: -0.3 },
  },
  {
    terms: ["frustrated", "frustration", "annoyed", "irritated"],
    weights: { energy: 0.2, valence: -0.25, tension: 0.4, calm: -0.2 },
  },
  {
    terms: ["anxious", "anxiety", "panic", "panicky", "on edge", "nervous"],
    weights: { energy: 0.1, valence: -0.25, tension: 0.4, calm: -0.25 },
  },
  {
    terms: ["relief", "relieved", "weight off", "finally calm"],
    weights: { energy: -0.1, valence: 0.25, tension: -0.3, calm: 0.35 },
  },
  {
    terms: ["comfort", "comforting", "need comfort", "soft blanket energy"],
    weights: { energy: -0.1, valence: 0.2, tension: -0.2, nostalgia: 0.15, calm: 0.35 },
  },
  {
    terms: ["content", "contentment", "at peace", "peaceful mind"],
    weights: { energy: -0.05, valence: 0.25, tension: -0.25, calm: 0.4 },
  },
  {
    terms: ["euphoria", "euphoric", "floating", "on another level"],
    weights: { energy: 0.4, valence: 0.5, tension: 0.05, calm: -0.2 },
  },
  {
    terms: ["determined", "determination", "won't give up", "grit"],
    weights: { energy: 0.25, valence: 0.15, tension: 0.15, calm: 0.05 },
  },
  {
    terms: ["curious", "curiosity", "wonder", "exploring feeling"],
    weights: { energy: 0.1, valence: 0.15, tension: 0.05, calm: 0.1 },
  },
  {
    terms: ["romantic", "romance", "in love", "love songs"],
    weights: { energy: 0.05, valence: 0.3, tension: 0.05, nostalgia: 0.2, calm: 0.15 },
  },
  {
    terms: ["vulnerable", "vulnerability", "raw emotions", "open heart"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.2, nostalgia: 0.25, calm: 0.1 },
  },
  {
    terms: ["reflective", "reflection", "looking back", "thinking about life"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.1, nostalgia: 0.4, calm: 0.2 },
  },
  {
    terms: ["melancholy", "melancholic", "wistful", "blue mood"],
    weights: { energy: -0.15, valence: -0.25, tension: 0.1, nostalgia: 0.35, calm: 0.15 },
  },

  // ── Mental state ──────────────────────────────────────────────────────────
  {
    terms: ["overstimulated", "sensory overload", "too loud", "brain fried"],
    weights: { energy: 0.05, valence: -0.15, tension: 0.3, calm: -0.25 },
  },
  {
    terms: ["burnt out", "burnout", "burned out", "done with everything"],
    weights: { energy: -0.35, valence: -0.15, tension: 0.1, calm: 0.2 },
  },
  {
    terms: ["mentally exhausted", "brain tired", "cognitive fatigue", "can't think"],
    weights: { energy: -0.3, valence: -0.1, tension: 0.05, calm: 0.25 },
  },
  {
    terms: ["focused", "in focus", "concentration", "deep concentration"],
    weights: { energy: 0.05, valence: 0.05, tension: 0.05, calm: 0.3 },
  },
  {
    terms: ["distracted", "can't focus", "scattered mind", "all over the place"],
    weights: { energy: 0.1, valence: -0.05, tension: 0.2, calm: -0.15 },
  },
  {
    terms: ["creative mode", "feeling creative", "inspiration hit", "ideas flowing"],
    weights: { energy: 0.15, valence: 0.2, tension: 0.05, nostalgia: 0.1, calm: 0.05 },
  },
  {
    terms: ["dreamy", "daydream", "spaced out", "head in the clouds"],
    weights: { energy: -0.15, valence: 0.1, tension: -0.1, nostalgia: 0.25, calm: 0.25 },
  },
  {
    terms: ["flow state", "in the flow", "zone", "locked in flow"],
    weights: { energy: 0.15, valence: 0.15, tension: 0.0, calm: 0.25 },
  },
  {
    terms: ["deep thinking", "philosophical", "existential", "big thoughts"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.15, nostalgia: 0.3, calm: 0.2 },
  },
  {
    terms: ["productive", "getting things done", "on a roll", "in my groove"],
    weights: { energy: 0.2, valence: 0.2, tension: 0.0, calm: 0.1 },
  },

  // ── Social context ────────────────────────────────────────────────────────
  {
    terms: ["alone time", "by myself", "solo night", "just me"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.05, nostalgia: 0.2, calm: 0.2 },
  },
  {
    terms: ["with friends", "friends hanging", "mate vibes", "crew energy"],
    weights: { energy: 0.2, valence: 0.3, tension: 0.05, calm: -0.1 },
  },
  {
    terms: ["party mode", "turn up", "club night", "dance floor"],
    weights: { energy: 0.45, valence: 0.35, tension: 0.1, calm: -0.3 },
  },
  {
    terms: ["family dinner", "family vibes", "with family", "relatives visiting"],
    weights: { energy: 0.05, valence: 0.25, tension: -0.05, nostalgia: 0.35, calm: 0.15 },
  },
  {
    terms: ["date night", "romantic date", "dinner date"],
    weights: { energy: 0.05, valence: 0.3, tension: 0.08, calm: 0.15 },
    sceneHints: { timeOfDay: "evening", environment: "social_indoor" },
  },
  {
    terms: ["social recovery", "recharge alone", "after socializing", "introvert reset"],
    weights: { energy: -0.2, valence: 0.05, tension: -0.15, calm: 0.35 },
  },
  {
    terms: ["celebrating", "celebration mode", "something to celebrate", "cheers"],
    weights: { energy: 0.3, valence: 0.4, tension: 0.05, calm: -0.15 },
  },
  {
    terms: ["missing someone", "miss them", "wish they were here"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.15, nostalgia: 0.45, calm: 0.1 },
  },

  // ── Environment (extra) ───────────────────────────────────────────────────
  {
    terms: ["bedroom late night", "in my room", "bedroom vibes"],
    weights: { energy: -0.15, valence: 0.0, tension: 0.1, nostalgia: 0.2, calm: 0.25 },
    sceneHints: { environment: "indoor", timeOfDay: "late_night" },
  },
  {
    terms: ["gym", "working out", "lifting", "leg day"],
    weights: { energy: 0.4, valence: 0.1, tension: 0.2, calm: -0.25 },
  },
  {
    terms: ["office", "at work", "workplace", "desk job"],
    weights: { energy: 0.05, valence: 0.0, tension: 0.08, calm: 0.15 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["coffee shop study", "cafe work", "laptop cafe"],
    weights: { energy: 0.0, valence: 0.1, tension: 0.05, calm: 0.2 },
    sceneHints: { environment: "social_indoor" },
  },

  // ── Time (extra phrases) ────────────────────────────────────────────────────
  {
    terms: ["sunrise", "dawn breaking", "first light"],
    weights: { energy: 0.05, valence: 0.2, tension: -0.1, nostalgia: 0.1, calm: 0.15 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["golden hour", "magic hour", "before sunset glow"],
    weights: { energy: 0.05, valence: 0.3, tension: -0.1, nostalgia: 0.35, calm: 0.1 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["midnight", "stroke of midnight", "witching hour"],
    weights: { energy: -0.15, valence: -0.05, tension: 0.2, nostalgia: 0.25, calm: 0.05 },
    sceneHints: { timeOfDay: "late_night" },
  },

  // ── Weather & season ──────────────────────────────────────────────────────
  {
    terms: ["sunny afternoon", "bright sun", "clear sky warm"],
    weights: { energy: 0.15, valence: 0.35, tension: -0.15, calm: -0.05 },
    sceneHints: { timeOfDay: "afternoon", environment: "coastal" },
  },
  {
    terms: ["cloudy", "overcast", "grey sky", "dull weather"],
    weights: { energy: -0.1, valence: -0.1, tension: 0.05, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["foggy", "mist", "misty morning", "fog atmosphere"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.15, nostalgia: 0.25, calm: 0.2 },
  },
  {
    terms: ["thunderstorm", "thunder and lightning", "stormy night"],
    weights: { energy: 0.1, valence: -0.05, tension: 0.35, nostalgia: 0.15, calm: -0.1 },
    sceneHints: { environment: "rainy" },
  },
  {
    terms: ["snow falling", "snowy day", "winter snow quiet"],
    weights: { energy: -0.15, valence: 0.1, tension: -0.1, nostalgia: 0.3, calm: 0.3 },
    sceneHints: { environment: "winter" },
  },
  {
    terms: ["spring vibes", "springtime", "blooming spring"],
    weights: { energy: 0.1, valence: 0.3, tension: -0.15, nostalgia: 0.15, calm: 0.1 },
  },
  {
    terms: ["summer vibes", "hot summer", "heatwave lazy"],
    weights: { energy: 0.1, valence: 0.25, tension: -0.1, nostalgia: 0.2, calm: 0.05 },
  },
  {
    terms: ["autumn", "fall season", "autumn leaves"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.0, nostalgia: 0.4, calm: 0.15 },
  },
  {
    terms: ["winter blues", "cold winter", "dark winter"],
    weights: { energy: -0.15, valence: -0.15, tension: 0.1, nostalgia: 0.25, calm: 0.2 },
    sceneHints: { environment: "winter" },
  },

  // ── Activities ────────────────────────────────────────────────────────────
  {
    terms: ["coding", "programming", "writing code", "developer mode"],
    weights: { energy: 0.1, valence: 0.05, tension: 0.05, calm: 0.25 },
    sceneHints: { environment: "indoor" },
  },
  {
    terms: ["studying", "revision", "exam prep", "homework grind"],
    weights: { energy: 0.0, valence: 0.0, tension: 0.1, calm: 0.3 },
  },
  {
    terms: ["reading", "book in hand", "novel time", "chapter time"],
    weights: { energy: -0.15, valence: 0.1, tension: -0.15, nostalgia: 0.25, calm: 0.35 },
  },
  {
    terms: ["driving", "behind the wheel", "on the road"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.08, nostalgia: 0.15, calm: 0.0 },
    sceneHints: { motionState: "driving" },
  },
  {
    terms: ["running", "jogging", "sprint", "cardio run"],
    weights: { energy: 0.4, valence: 0.2, tension: 0.05, calm: -0.2 },
    sceneHints: { motionState: "running" },
  },
  {
    terms: ["walking", "stroll", "long walk", "wandering"],
    weights: { energy: 0.05, valence: 0.05, tension: -0.05, calm: 0.2 },
    sceneHints: { motionState: "walking" },
  },
  {
    terms: ["travelling", "travel day", "road trip", "on a trip"],
    weights: { energy: 0.1, valence: 0.15, tension: 0.05, nostalgia: 0.3, calm: 0.05 },
    sceneHints: { motionState: "transit" },
  },
  {
    terms: ["cleaning", "tidy up", "housework", "chores"],
    weights: { energy: 0.2, valence: 0.15, tension: -0.05, calm: 0.0 },
  },
  {
    terms: ["gaming", "video games", "gaming session"],
    weights: { energy: 0.25, valence: 0.15, tension: 0.1, calm: -0.1 },
  },
  {
    terms: ["relaxing", "unwind", "decompress", "veg out"],
    weights: { energy: -0.2, valence: 0.15, tension: -0.2, calm: 0.35 },
  },
  {
    terms: ["falling asleep", "sleepy", "drowsy", "bedtime"],
    weights: { energy: -0.35, valence: 0.05, tension: -0.25, calm: 0.45 },
    sceneHints: { timeOfDay: "late_night", environment: "indoor" },
  },
  {
    terms: ["waking up", "morning wake", "just woke up"],
    weights: { energy: 0.05, valence: 0.15, tension: -0.1, calm: 0.15 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["cooking", "in the kitchen", "making food"],
    weights: { energy: 0.05, valence: 0.2, tension: -0.1, calm: 0.2 },
    sceneHints: { environment: "indoor" },
  },

  // ── Destination phrasing (boost; parser in emotion-destination.ts) ────────
  {
    terms: ["want to feel calm", "need to feel calm", "want calm"],
    weights: { energy: -0.1, valence: 0.1, tension: -0.25, calm: 0.35 },
  },
  {
    terms: ["want to feel motivated", "need motivation", "want energy"],
    weights: { energy: 0.3, valence: 0.2, tension: 0.0, calm: -0.15 },
  },
  {
    terms: ["want to feel lighter", "feel lighter", "leave feeling better"],
    weights: { energy: 0.05, valence: 0.3, tension: -0.2, calm: 0.15 },
  },
  {
    terms: ["mentally drained", "brain drained", "emotionally drained"],
    weights: { energy: -0.3, valence: -0.1, tension: 0.08, nostalgia: 0.15, calm: 0.15 },
  },
  {
    terms: ["driving home at 11pm", "driving home at 11", "commute home late"],
    weights: { energy: -0.15, valence: -0.08, tension: 0.1, nostalgia: 0.3, calm: 0.18 },
    sceneHints: { motionState: "driving", timeOfDay: "late_night" },
  },
];
