/**
 * Master tag library — time, weather, places, social, life, motion, atmosphere.
 */

import { tagBatch, tagKw } from "./tag-keyword-helpers";
import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

const TIME: ExtendedVibeKeyword[] = [
  tagKw(["sunrise", "at sunrise", "watching the sunrise"], { valence: 0.12, energy: 0.05, calm: 0.1 }, { timeOfDay: "morning" }),
  tagKw(["golden hour", "magic hour"], { valence: 0.2, nostalgia: 0.25, calm: 0.08 }, { timeOfDay: "evening" }),
  tagKw("morning commute", { energy: 0.05, tension: 0.08 }, { timeOfDay: "morning", motionState: "transit" }),
  tagKw("mid-morning", { energy: 0.08, valence: 0.05 }, { timeOfDay: "morning" }),
  tagKw(["lunchtime", "lunch break"], { energy: 0.02, calm: 0.05 }, { timeOfDay: "afternoon" }),
  tagKw("afternoon slump", { energy: -0.15, valence: -0.08, calm: 0.1 }, { timeOfDay: "afternoon" }),
  tagKw(["after work", "post work", "clocking off"], { energy: -0.05, valence: 0.08, calm: 0.12 }, { timeOfDay: "evening" }),
  tagKw(["evening unwind", "winding down evening"], { energy: -0.12, valence: 0.1, calm: 0.25 }, { timeOfDay: "evening" }),
  tagKw("late evening", { energy: -0.1, nostalgia: 0.15, calm: 0.15 }, { timeOfDay: "evening" }),
  tagKw("midnight", { energy: -0.2, tension: 0.15, nostalgia: 0.2 }, { timeOfDay: "late_night" }),
  tagKw(["3am", "3 am"], { energy: -0.25, tension: 0.2, nostalgia: 0.22 }, { timeOfDay: "late_night" }),
  tagKw(["dawn", "pre-dawn"], { energy: -0.05, valence: 0.08, calm: 0.15 }, { timeOfDay: "morning" }),
  tagKw("weekend morning", { valence: 0.15, energy: 0.05, calm: 0.1 }, { timeOfDay: "morning" }),
  tagKw(["sunday evening", "sunday night reset"], { energy: -0.1, nostalgia: 0.2, tension: 0.1 }, { timeOfDay: "evening" }),
  tagKw("friday afternoon", { energy: 0.15, valence: 0.2, tension: -0.05 }, { timeOfDay: "afternoon" }),
  tagKw("last day of summer", { nostalgia: 0.35, valence: 0.1, calm: 0.1 }),
  tagKw("first day of spring", { valence: 0.2, energy: 0.1, calm: 0.05 }),
];

const WEATHER: ExtendedVibeKeyword[] = [
  ...tagBatch(["light rain", "drizzle", "soft rain"], { energy: -0.1, valence: -0.05, calm: 0.15, nostalgia: 0.1 }, { environment: "rainy" }),
  ...tagBatch(["heavy rain", "pouring rain", "torrential"], { energy: -0.05, tension: 0.12, nostalgia: 0.15 }, { environment: "rainy" }),
  ...tagBatch(["storm", "thunderstorm", "thunder"], { tension: 0.25, energy: 0.05 }, { environment: "rainy" }),
  ...tagBatch(["fog", "mist", "misty morning"], { calm: 0.2, nostalgia: 0.2, energy: -0.1 }, { environment: "rainy" }),
  ...tagBatch(["snowfall", "first snow", "snowing"], { calm: 0.15, nostalgia: 0.25, energy: -0.1 }, { environment: "winter" }),
  tagKw("summer heat", { energy: 0.15, valence: 0.1 }),
  tagKw("cold morning", { energy: -0.1, calm: 0.1 }, { timeOfDay: "morning" }),
  tagKw("humid night", { energy: -0.05, tension: 0.08 }, { timeOfDay: "night" }),
  tagKw("windy coast", { energy: 0.08, nostalgia: 0.15 }, { environment: "coastal" }),
  tagKw("overcast day", { valence: -0.1, calm: 0.12, energy: -0.1 }),
  tagKw("sun after rain", { valence: 0.2, energy: 0.05, calm: 0.1 }),
  tagKw("frost", { calm: 0.1, energy: -0.1, nostalgia: 0.12 }, { environment: "winter" }),
];

const DRIVING: ExtendedVibeKeyword[] = [
  tagKw("night drive", { energy: 0.05, nostalgia: 0.3, calm: 0.1 }, { motionState: "driving", timeOfDay: "late_night" }),
  tagKw("motorway drive", { energy: 0.1, nostalgia: 0.2 }, { motionState: "driving" }),
  tagKw("driving nowhere", { nostalgia: 0.35, energy: 0.05, calm: 0.1 }, { motionState: "driving" }),
  tagKw("long drive alone", { nostalgia: 0.3, energy: 0.0, calm: 0.12 }, { motionState: "driving" }),
  tagKw("country roads", { valence: 0.1, nostalgia: 0.25, calm: 0.15 }, { motionState: "driving", environment: "nature" }),
  tagKw("city driving", { energy: 0.08, tension: 0.1 }, { motionState: "driving", environment: "urban" }),
  tagKw("driving after work", { energy: -0.05, calm: 0.15, nostalgia: 0.15 }, { motionState: "driving", timeOfDay: "evening" }),
  tagKw("driving after an argument", { tension: 0.25, valence: -0.15, energy: -0.05 }, { motionState: "driving" }),
  tagKw("driving to see someone", { valence: 0.15, tension: 0.15, energy: 0.05 }, { motionState: "driving" }),
  tagKw("driving away from something", { tension: 0.2, valence: -0.1, nostalgia: 0.15 }, { motionState: "driving" }),
  tagKw(["late petrol station", "service station stop", "motorway services"], { nostalgia: 0.25, energy: -0.05 }, { environment: "urban" }),
  tagKw("windows down", { valence: 0.2, energy: 0.15, nostalgia: 0.2 }, { motionState: "driving" }),
  tagKw(["rain on windscreen", "rain on windshield", "rain on the windscreen"], { nostalgia: 0.3, calm: 0.1 }, { motionState: "driving", environment: "rainy" }),
];

const TRANSIT: ExtendedVibeKeyword[] = [
  tagKw("empty train", { calm: 0.15, nostalgia: 0.2 }, { motionState: "transit" }),
  tagKw("rush hour train", { tension: 0.15, energy: 0.05 }, { motionState: "transit", timeOfDay: "morning" }),
  tagKw("window seat train", { calm: 0.2, nostalgia: 0.25 }, { motionState: "transit" }),
  tagKw(["night bus", "last bus home"], { nostalgia: 0.3, energy: -0.1 }, { motionState: "transit", timeOfDay: "late_night" }),
  tagKw("airport shuttle", { energy: 0.0, tension: 0.1 }, { motionState: "transit", environment: "transit" }),
  tagKw(["underground journey", "tube journey", "subway ride"], { energy: 0.0, tension: 0.08 }, { motionState: "transit", environment: "urban" }),
  tagKw("long flight", { calm: 0.2, nostalgia: 0.15 }, { motionState: "transit" }),
  tagKw("airport waiting area", { tension: 0.12, energy: -0.05 }, { environment: "transit" }),
  tagKw("flight home", { nostalgia: 0.25, valence: 0.08 }, { motionState: "transit" }),
];

const PLACES: ExtendedVibeKeyword[] = [
  ...tagBatch(["rooftop", "rooftop view"], { valence: 0.1, nostalgia: 0.15 }, { environment: "urban" }),
  ...tagBatch(["student accommodation", "student halls", "dorm"], { nostalgia: 0.25, energy: 0.05 }, { environment: "indoor" }),
  ...tagBatch(["warehouse", "factory", "industrial"], { tension: 0.1, energy: 0.05 }, { environment: "urban" }),
  ...tagBatch(["pub", "local pub"], { valence: 0.1, energy: 0.05 }, { environment: "social_indoor" }),
  ...tagBatch(["club", "nightclub"], { energy: 0.35, valence: 0.15 }, { environment: "social_indoor", timeOfDay: "night" }),
  ...tagBatch(["coffee shop", "cafe"], { calm: 0.2, energy: -0.05 }, { environment: "social_indoor" }),
  ...tagBatch(["river walk", "canal walk"], { calm: 0.2, valence: 0.08 }, { environment: "nature", motionState: "walking" }),
  tagKw(["empty streets", "empty street"], { nostalgia: 0.3, energy: -0.1 }, { environment: "urban", timeOfDay: "late_night" }),
  tagKw("motorway services", { energy: 0.0, nostalgia: 0.15 }, { environment: "urban", motionState: "driving" }),
];

const SEASONS: ExtendedVibeKeyword[] = [
  tagKw("summer freedom", { valence: 0.2, energy: 0.12, nostalgia: 0.2 }),
  tagKw("autumn nostalgia", { nostalgia: 0.35, valence: 0.05, calm: 0.1 }),
  tagKw("winter comfort", { calm: 0.25, valence: 0.08, energy: -0.1 }, { environment: "winter" }),
  tagKw("spring optimism", { valence: 0.2, energy: 0.1 }),
  tagKw(["christmas season", "christmas eve"], { nostalgia: 0.35, valence: 0.15, calm: 0.1 }),
  tagKw("new year reflection", { nostalgia: 0.2, calm: 0.15, valence: 0.05 }),
  tagKw("halloween atmosphere", { tension: 0.2, energy: 0.05 }),
  tagKw("festival season", { energy: 0.25, valence: 0.2 }),
];

const SOCIAL: ExtendedVibeKeyword[] = [
  ...tagBatch(["best friend", "with my best friend"], { valence: 0.2, energy: 0.05 }, undefined),
  ...tagBatch(["old friends", "seeing old friends"], { nostalgia: 0.3, valence: 0.15 }),
  ...tagBatch(["new friends", "meeting new people"], { valence: 0.15, tension: 0.1 }),
  ...tagBatch(["small gathering", "intimate gathering"], { calm: 0.15, valence: 0.1 }),
  ...tagBatch(["group holiday", "holiday with friends"], { valence: 0.2, nostalgia: 0.25 }),
  tagKw("social recovery", { calm: 0.3, energy: -0.15 }),
  tagKw("strangers", { tension: 0.1, energy: 0.0 }),
  tagKw("crowd", { energy: 0.15, tension: 0.15 }),
];

const RELATIONSHIPS: ExtendedVibeKeyword[] = [
  ...tagBatch(["crush", "having a crush"], { valence: 0.15, tension: 0.2, energy: 0.1 }),
  ...tagBatch(["situationship", "complicated relationship"], { tension: 0.2, valence: -0.05 }),
  ...tagBatch(["new relationship", "new love"], { valence: 0.25, energy: 0.1 }),
  ...tagBatch(["long-term relationship", "long term partner"], { valence: 0.15, calm: 0.15 }),
  ...tagBatch(["engaged", "engagement"], { valence: 0.25, tension: 0.15 }),
  ...tagBatch(["waiting for a text", "waiting for them to reply"], { tension: 0.25, energy: -0.05 }),
  ...tagBatch(["getting over someone", "moving on"], { valence: 0.05, calm: 0.15, nostalgia: 0.1 }),
  ...tagBatch(["reconnecting", "back in touch"], { nostalgia: 0.25, valence: 0.1 }),
];

const LIFE: ExtendedVibeKeyword[] = [
  ...tagBatch(["new job", "first day at work"], { tension: 0.2, valence: 0.1, energy: 0.1 }),
  ...tagBatch(["last day at work", "leaving job"], { nostalgia: 0.25, valence: 0.05 }),
  ...tagBatch(["moving city", "moved to a new city"], { tension: 0.15, valence: 0.05, nostalgia: 0.15 }),
  ...tagBatch(["birthday", "my birthday"], { valence: 0.2, energy: 0.15 }),
  ...tagBatch(["wedding", "wedding day"], { valence: 0.3, tension: 0.15, energy: 0.1 }),
  ...tagBatch(["funeral", "memorial"], { valence: -0.25, calm: 0.1, nostalgia: 0.2 }),
  ...tagBatch(["becoming a parent", "new parent"], { valence: 0.15, calm: 0.1, tension: 0.1 }),
];

const ENERGY: ExtendedVibeKeyword[] = [
  ...tagBatch(["burnt out", "burnout"], { energy: -0.35, valence: -0.1, calm: 0.1 }),
  ...tagBatch(["locked in", "in the zone", "deep focus"], { energy: 0.1, tension: 0.1, calm: 0.2 }),
  ...tagBatch(["wired", "caffeinated", "too much coffee"], { energy: 0.3, tension: 0.2 }),
  ...tagBatch(["recharged", "recharged energy"], { energy: 0.2, valence: 0.15 }),
  ...tagBatch(["unstoppable", "on fire"], { energy: 0.4, valence: 0.25, tension: 0.1 }),
];

const STUDY: ExtendedVibeKeyword[] = [
  tagKw("exam tomorrow", { tension: 0.3, energy: 0.05, calm: -0.1 }),
  tagKw("revision session", { tension: 0.15, calm: 0.1 }),
  tagKw("late-night studying", { energy: -0.1, tension: 0.2, calm: 0.05 }, { timeOfDay: "late_night" }),
  tagKw("coding session", { calm: 0.2, energy: 0.0, tension: 0.05 }),
  tagKw("creative flow", { valence: 0.1, calm: 0.2, energy: 0.05 }),
  tagKw("deadline pressure", { tension: 0.35, energy: 0.1 }),
  tagKw("all-nighter", { energy: 0.05, tension: 0.25 }, { timeOfDay: "late_night" }),
  tagKw("working from home", { calm: 0.15, energy: -0.05 }, { environment: "indoor" }),
  tagKw("friday finish", { valence: 0.2, energy: 0.15 }, { timeOfDay: "evening" }),
];

const NOSTALGIA: ExtendedVibeKeyword[] = [
  ...tagBatch(["college years", "college nostalgia"], { nostalgia: 0.4 }),
  ...tagBatch(["childhood summer", "childhood summers"], { nostalgia: 0.45, valence: 0.1 }),
  ...tagBatch(["old gaming nights", "late night gaming"], { nostalgia: 0.35, energy: -0.05 }, { timeOfDay: "late_night" }),
  ...tagBatch(["first car", "first car memories"], { nostalgia: 0.4 }, { motionState: "driving" }),
  ...tagBatch(["teenage years"], { nostalgia: 0.4, valence: 0.05 }),
  ...tagBatch(["early internet era", "msn messenger", "bebo"], { nostalgia: 0.45 }),
  ...tagBatch(["summer of 2019", "2019 summer"], { nostalgia: 0.4 }),
  ...tagBatch(["lockdown memories", "lockdown era"], { nostalgia: 0.35, calm: 0.1 }),
];

const CONTRADICTIONS: ExtendedVibeKeyword[] = [
  tagKw("sad but hopeful", { valence: 0.05, tension: 0.2, nostalgia: 0.1 }),
  tagKw("lonely but peaceful", { calm: 0.25, valence: 0.05, nostalgia: 0.15 }),
  tagKw("happy but nostalgic", { valence: 0.2, nostalgia: 0.35 }),
  tagKw("confident but reflective", { valence: 0.15, calm: 0.15, nostalgia: 0.15 }),
  tagKw("excited but nervous", { tension: 0.25, valence: 0.1, energy: 0.15 }),
  tagKw("heartbroken but healing", { valence: -0.05, calm: 0.15, tension: 0.15 }),
  tagKw("tired but determined", { energy: -0.1, tension: 0.2, valence: 0.1 }),
  tagKw("calm but emotional", { calm: 0.2, tension: 0.15, valence: 0.0 }),
  tagKw("lost but optimistic", { valence: 0.1, tension: 0.15, energy: 0.05 }),
];

const MOMENTS: ExtendedVibeKeyword[] = [
  tagKw(["can't sleep", "cannot sleep"], { energy: -0.2, tension: 0.2 }, { timeOfDay: "late_night" }),
  tagKw("waiting for someone", { tension: 0.2, calm: -0.05 }),
  tagKw("walking home alone", { nostalgia: 0.2, calm: 0.1 }, { motionState: "walking" }),
  tagKw("watching city lights", { nostalgia: 0.3, calm: 0.15 }, { environment: "urban", timeOfDay: "night" }),
  tagKw("looking out the window", { calm: 0.2, nostalgia: 0.2 }),
  tagKw("thinking about the past", { nostalgia: 0.35, valence: -0.05 }),
  tagKw("thinking about the future", { tension: 0.1, valence: 0.1 }),
  tagKw("packing to leave", { tension: 0.15, nostalgia: 0.2 }),
  tagKw("arriving somewhere new", { valence: 0.15, tension: 0.15, energy: 0.1 }),
  tagKw("coming home", { valence: 0.15, calm: 0.15, nostalgia: 0.2 }),
  tagKw("one more drink before leaving", { nostalgia: 0.2, energy: 0.05 }),
  tagKw("journey home after a good night", { valence: 0.2, nostalgia: 0.2 }, { motionState: "transit" }),
  tagKw("journey home after a bad night", { valence: -0.15, tension: 0.15, nostalgia: 0.15 }, { motionState: "transit" }),
];

const ARCHAEOLOGY: ExtendedVibeKeyword[] = [
  ...tagBatch(
    [
      "music you forgot you loved",
      "lost summer soundtrack",
      "old obsessions",
      "artists you abandoned",
      "songs from another life",
      "comfort songs from years ago",
      "forgotten road trip songs",
      "songs you used to play constantly",
      "your old soundtrack",
      "the hidden corners of your library",
      "music tied to old memories",
      "songs from your previous era",
    ],
    { nostalgia: 0.3, valence: 0.05 }
  ),
];

const MOTION: ExtendedVibeKeyword[] = [
  ...tagBatch(["cycling", "bike ride"], { energy: 0.15 }, { motionState: "running" }),
  ...tagBatch(["flying", "on a plane"], { calm: 0.1 }, { motionState: "transit" }),
  ...tagBatch(["wandering", "exploring"], { valence: 0.1, energy: 0.05 }, { motionState: "walking" }),
  ...tagBatch(["working out", "lifting", "cooling down"], { energy: 0.2 }, { environment: "gym" }),
];

const ATMOSPHERE: ExtendedVibeKeyword[] = [
  ...tagBatch(["cinematic", "film score vibes"], { nostalgia: 0.15, tension: 0.1 }),
  ...tagBatch(["dreamlike", "ethereal"], { calm: 0.25, energy: -0.1, valence: 0.05 }),
  ...tagBatch(["melancholic", "melancholy"], { valence: -0.15, nostalgia: 0.25, calm: 0.1 }),
  ...tagBatch(["euphoric", "euphoria"], { valence: 0.3, energy: 0.25 }),
  ...tagBatch(["neon", "neon lights"], { energy: 0.1, nostalgia: 0.2 }, { environment: "urban", timeOfDay: "late_night" }),
  ...tagBatch(["intimate", "intimacy"], { calm: 0.25, valence: 0.1 }),
  ...tagBatch(["open-road", "open road feeling"], { valence: 0.15, energy: 0.1 }, { motionState: "driving" }),
  ...tagBatch(["coastal", "by the sea"], { calm: 0.15, valence: 0.1 }, { environment: "coastal" }),
  ...tagBatch(["sunlit", "sun-drenched"], { valence: 0.2, energy: 0.1 }),
];

export const MASTER_TAG_KEYWORDS: ExtendedVibeKeyword[] = [
  ...TIME,
  ...WEATHER,
  ...DRIVING,
  ...TRANSIT,
  ...PLACES,
  ...SEASONS,
  ...SOCIAL,
  ...RELATIONSHIPS,
  ...LIFE,
  ...ENERGY,
  ...STUDY,
  ...NOSTALGIA,
  ...CONTRADICTIONS,
  ...MOMENTS,
  ...ARCHAEOLOGY,
  ...MOTION,
  ...ATMOSPHERE,
];
