/**
 * Place + time phrase bank (batch D) — compound scenes for context matching.
 */

import type { ExtendedVibeKeyword } from "./vibe-keywords-extended";

export const EXTENDED_VIBE_KEYWORDS_PLACES_TIMES: ExtendedVibeKeyword[] = [
  // ── Place + time compounds (longest first) ───────────────────────────────────
  {
    terms: [
      "driving home at 11pm",
      "driving home at 11",
      "drive home at midnight",
      "commute home late",
      "motorway home at night",
    ],
    weights: { energy: -0.15, valence: -0.08, tension: 0.1, nostalgia: 0.32, calm: 0.18 },
    sceneHints: { motionState: "driving", timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: [
      "late night drive alone",
      "solo drive at night",
      "empty motorway at night",
      "highway alone at 2am",
    ],
    weights: { energy: 0.0, valence: -0.1, tension: 0.15, nostalgia: 0.38, calm: 0.12 },
    sceneHints: { motionState: "driving", timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: ["rainy night drive", "driving in the rain at night", "wet road at night"],
    weights: { energy: 0.05, valence: -0.08, tension: 0.18, nostalgia: 0.35, calm: 0.08 },
    sceneHints: { motionState: "driving", timeOfDay: "late_night", environment: "rainy" },
  },
  {
    terms: ["sunrise drive", "early morning drive", "dawn on the road"],
    weights: { energy: 0.1, valence: 0.15, tension: -0.08, nostalgia: 0.2, calm: 0.12 },
    sceneHints: { motionState: "driving", timeOfDay: "morning", environment: "urban" },
  },
  {
    terms: ["golden hour drive", "sunset drive home", "evening commute golden light"],
    weights: { energy: 0.05, valence: 0.25, tension: -0.08, nostalgia: 0.4, calm: 0.1 },
    sceneHints: { motionState: "driving", timeOfDay: "evening", environment: "urban" },
  },
  {
    terms: ["train at night", "night train journey", "late train home"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.08, nostalgia: 0.38, calm: 0.18 },
    sceneHints: { motionState: "transit", timeOfDay: "late_night", environment: "transit" },
  },
  {
    terms: ["morning train commute", "rush hour train", "packed train morning"],
    weights: { energy: 0.05, valence: -0.05, tension: 0.15, nostalgia: 0.08, calm: -0.05 },
    sceneHints: { motionState: "transit", timeOfDay: "morning", environment: "transit" },
  },
  {
    terms: ["airport at dawn", "early flight airport", "departure lounge morning"],
    weights: { energy: 0.0, valence: 0.05, tension: 0.1, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { motionState: "transit", timeOfDay: "morning", environment: "transit" },
  },
  {
    terms: ["red eye flight", "overnight flight", "plane window at night"],
    weights: { energy: -0.15, valence: 0.0, tension: 0.05, nostalgia: 0.3, calm: 0.2 },
    sceneHints: { motionState: "transit", timeOfDay: "late_night", environment: "transit" },
  },
  {
    terms: ["coffee shop rainy afternoon", "café in the rain afternoon", "rainy cafe study"],
    weights: { energy: -0.1, valence: 0.08, tension: -0.05, nostalgia: 0.28, calm: 0.32 },
    sceneHints: { environment: "rainy", timeOfDay: "afternoon" },
  },
  {
    terms: ["late night coffee shop", "cafe at midnight", "24 hour diner"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.12, nostalgia: 0.35, calm: 0.15 },
    sceneHints: { timeOfDay: "late_night", environment: "social_indoor" },
  },
  {
    terms: ["bedroom 2am", "can't sleep bedroom", "awake in bed at night"],
    weights: { energy: -0.25, valence: -0.1, tension: 0.2, nostalgia: 0.25, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "indoor" },
  },
  {
    terms: ["sunday morning kitchen", "lazy sunday kitchen", "breakfast at home slow"],
    weights: { energy: -0.15, valence: 0.2, tension: -0.2, nostalgia: 0.3, calm: 0.35 },
    sceneHints: { timeOfDay: "morning", environment: "indoor" },
  },
  {
    terms: ["friday night out", "saturday night downtown", "city night out"],
    weights: { energy: 0.3, valence: 0.35, tension: 0.1, nostalgia: 0.05, calm: -0.2 },
    sceneHints: { timeOfDay: "night", environment: "urban" },
  },
  {
    terms: ["rooftop sunset", "rooftop evening", "skyline at dusk"],
    weights: { energy: 0.05, valence: 0.28, tension: -0.05, nostalgia: 0.35, calm: 0.12 },
    sceneHints: { timeOfDay: "evening", environment: "urban" },
  },
  {
    terms: ["beach morning", "early beach walk", "shoreline at sunrise"],
    weights: { energy: 0.1, valence: 0.3, tension: -0.15, nostalgia: 0.2, calm: 0.25 },
    sceneHints: { timeOfDay: "morning", environment: "coastal" },
  },
  {
    terms: ["beach sunset", "ocean at golden hour", "waves at dusk"],
    weights: { energy: 0.0, valence: 0.3, tension: -0.1, nostalgia: 0.4, calm: 0.2 },
    sceneHints: { timeOfDay: "evening", environment: "coastal" },
  },
  {
    terms: ["forest morning mist", "woods at dawn", "misty trail morning"],
    weights: { energy: 0.0, valence: 0.15, tension: -0.1, nostalgia: 0.25, calm: 0.35 },
    sceneHints: { timeOfDay: "morning", environment: "nature" },
  },
  {
    terms: ["night walk city", "city streets at night", "neon streets midnight"],
    weights: { energy: 0.08, valence: 0.0, tension: 0.15, nostalgia: 0.3, calm: 0.05 },
    sceneHints: { timeOfDay: "late_night", environment: "urban", motionState: "walking" },
  },
  {
    terms: ["subway late night", "last tube home", "metro after midnight"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.12, nostalgia: 0.32, calm: 0.08 },
    sceneHints: { timeOfDay: "late_night", environment: "transit", motionState: "transit" },
  },
  {
    terms: ["gym early morning", "5am workout", "morning gym session"],
    weights: { energy: 0.35, valence: 0.2, tension: 0.1, calm: -0.2 },
    sceneHints: { timeOfDay: "morning", environment: "gym" },
  },
  {
    terms: ["office after hours", "empty office late", "working late office"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.12, nostalgia: 0.15, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "office" },
  },
  {
    terms: ["library afternoon study", "quiet library daytime", "campus library"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.05, calm: 0.35 },
    sceneHints: { timeOfDay: "afternoon", environment: "library" },
  },
  {
    terms: ["parking lot night", "empty car park fluorescent", "carpark at night"],
    weights: { energy: 0.05, valence: -0.15, tension: 0.22, nostalgia: 0.38, calm: 0.05 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: ["petrol station 2am", "2am petrol station", "gas station at 2am", "service station fluorescent 2am"],
    weights: { energy: 0.05, valence: -0.18, tension: 0.28, nostalgia: 0.42, calm: 0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "urban" },
  },
  {
    terms: [
      "petrol station 10am",
      "10am petrol station",
      "petrol station in the morning",
      "gas station morning city",
    ],
    weights: { energy: 0.08, valence: 0.05, tension: 0.12, nostalgia: 0.22, calm: 0.12 },
    sceneHints: { timeOfDay: "morning", environment: "urban" },
  },
  {
    terms: ["snowy evening walk", "winter street at dusk", "cold evening outside"],
    weights: { energy: -0.1, valence: 0.05, tension: 0.05, nostalgia: 0.35, calm: 0.2 },
    sceneHints: { timeOfDay: "evening", environment: "winter" },
  },
  {
    terms: ["hot summer afternoon", "heat haze afternoon", "lazy humid afternoon"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.1, nostalgia: 0.25, calm: 0.2 },
    sceneHints: { timeOfDay: "afternoon", environment: "coastal" },
  },
  {
    terms: ["blue hour city", "twilight downtown", "dusk city lights"],
    weights: { energy: 0.0, valence: 0.1, tension: 0.1, nostalgia: 0.38, calm: 0.12 },
    sceneHints: { timeOfDay: "evening", environment: "urban" },
  },
  {
    terms: ["after work unwind", "just got home from work", "post shift decompress"],
    weights: { energy: -0.15, valence: 0.1, tension: -0.15, nostalgia: 0.15, calm: 0.3 },
    sceneHints: { timeOfDay: "evening", environment: "indoor" },
  },
  {
    terms: ["before bed wind down", "getting ready for bed", "night routine calm"],
    weights: { energy: -0.25, valence: 0.1, tension: -0.2, calm: 0.4 },
    sceneHints: { timeOfDay: "night", environment: "indoor" },
  },
  {
    terms: ["lunch break outside", "midday break park", "noon sun bench"],
    weights: { energy: 0.05, valence: 0.2, tension: -0.15, calm: 0.2 },
    sceneHints: { timeOfDay: "afternoon", environment: "nature" },
  },
  {
    terms: ["monday morning dread", "monday commute", "start of the week grey"],
    weights: { energy: 0.0, valence: -0.15, tension: 0.2, nostalgia: 0.05, calm: -0.05 },
    sceneHints: { timeOfDay: "morning", environment: "urban" },
  },

  // ── Places (scene hints) ────────────────────────────────────────────────────
  {
    terms: ["rooftop", "on the roof", "skyline view"],
    weights: { energy: 0.05, valence: 0.15, tension: 0.05, nostalgia: 0.2 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["supermarket aisles", "grocery store", "late night shop run"],
    weights: { energy: -0.05, valence: -0.05, tension: 0.08, nostalgia: 0.12 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["hospital corridor", "waiting room", "clinical hallway"],
    weights: { energy: -0.1, valence: -0.15, tension: 0.25, calm: 0.1 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["hotel room", "motel room", "strange hotel bed"],
    weights: { energy: -0.1, valence: 0.0, tension: 0.1, nostalgia: 0.25 },
    sceneHints: { environment: "indoor" },
  },
  {
    terms: ["back garden", "backyard", "garden evening"],
    weights: { energy: -0.05, valence: 0.15, tension: -0.1, calm: 0.25 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["countryside drive", "country road", "rural lane"],
    weights: { energy: 0.05, valence: 0.1, tension: -0.05, nostalgia: 0.35, calm: 0.15 },
    sceneHints: { motionState: "driving", environment: "nature" },
  },
  {
    terms: ["lake shore", "by the lake", "still water reflection"],
    weights: { energy: -0.1, valence: 0.15, tension: -0.15, nostalgia: 0.3, calm: 0.3 },
    sceneHints: { environment: "nature" },
  },
  {
    terms: ["nightclub bathroom", "club toilets", "after the club"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.15, nostalgia: 0.1, calm: -0.1 },
    sceneHints: { timeOfDay: "late_night", environment: "social_indoor" },
  },
  {
    terms: ["warehouse", "empty warehouse", "industrial space"],
    weights: { energy: 0.05, valence: -0.05, tension: 0.2, nostalgia: 0.2 },
    sceneHints: { environment: "urban" },
  },
  {
    terms: ["tunnel drive", "underpass", "road tunnel lights"],
    weights: { energy: 0.1, valence: -0.05, tension: 0.18, nostalgia: 0.25 },
    sceneHints: { motionState: "driving", environment: "urban" },
  },

  // ── Times (clock + day rhythm) ──────────────────────────────────────────────
  {
    terms: ["5am", "5 am", "five am"],
    weights: { energy: -0.1, valence: 0.05, tension: 0.05, calm: 0.15 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["6am", "6 am", "six am"],
    weights: { energy: -0.05, valence: 0.08, tension: 0.0, calm: 0.12 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["7am", "7 am", "seven am"],
    weights: { energy: 0.0, valence: 0.1, tension: 0.0, calm: 0.1 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["8am", "8 am", "eight am", "rush hour morning"],
    weights: { energy: 0.1, valence: 0.0, tension: 0.12, calm: -0.05 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["10am", "10 am", "ten am", "mid morning"],
    weights: { energy: 0.05, valence: 0.12, tension: -0.05, calm: 0.1 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["11am", "11 am", "eleven am"],
    weights: { energy: 0.08, valence: 0.1, tension: -0.05, calm: 0.08 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["1pm", "1 pm", "one pm", "lunch time"],
    weights: { energy: 0.05, valence: 0.1, tension: -0.05, calm: 0.05 },
    sceneHints: { timeOfDay: "afternoon" },
  },
  {
    terms: ["3pm", "3 pm", "three pm", "mid afternoon"],
    weights: { energy: 0.0, valence: 0.1, tension: -0.05, nostalgia: 0.1, calm: 0.1 },
    sceneHints: { timeOfDay: "afternoon" },
  },
  {
    terms: ["5pm", "5 pm", "five pm", "end of workday"],
    weights: { energy: 0.05, valence: 0.08, tension: 0.05, calm: 0.0 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["7pm", "7 pm", "seven pm"],
    weights: { energy: 0.0, valence: 0.12, tension: -0.05, nostalgia: 0.15, calm: 0.1 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["9pm", "9 pm", "nine pm"],
    weights: { energy: -0.05, valence: 0.05, tension: 0.05, nostalgia: 0.2, calm: 0.12 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["10pm", "10 pm", "ten pm"],
    weights: { energy: -0.08, valence: 0.0, tension: 0.08, nostalgia: 0.22, calm: 0.1 },
    sceneHints: { timeOfDay: "night" },
  },
  {
    terms: ["11pm", "11 pm", "eleven pm"],
    weights: { energy: -0.1, valence: -0.05, tension: 0.1, nostalgia: 0.28, calm: 0.08 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["5am still awake", "5 am insomnia", "up all night till dawn"],
    weights: { energy: -0.2, valence: -0.1, tension: 0.25, nostalgia: 0.3, calm: -0.1 },
    sceneHints: { timeOfDay: "late_night" },
  },
  {
    terms: ["twilight", "blue hour", "between day and night"],
    weights: { energy: -0.05, valence: 0.1, tension: 0.08, nostalgia: 0.35, calm: 0.15 },
    sceneHints: { timeOfDay: "evening" },
  },
  {
    terms: ["weekend morning", "saturday morning", "lazy weekend AM"],
    weights: { energy: -0.1, valence: 0.2, tension: -0.15, nostalgia: 0.2, calm: 0.3 },
    sceneHints: { timeOfDay: "morning" },
  },
  {
    terms: ["weeknight", "weekday night", "tuesday night"],
    weights: { energy: -0.05, valence: 0.0, tension: 0.08, nostalgia: 0.15 },
    sceneHints: { timeOfDay: "night" },
  },
];
