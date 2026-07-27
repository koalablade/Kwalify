#!/usr/bin/env node
/**
 * Generates human-experience-benchmark.json with 10,000+ realistic prompts.
 * Run: node backend/scripts/generate-human-experience-benchmark.mjs
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../tests/human-experience-benchmark.json");

const PREFIXES = ["music for", "songs for", "playlist for", "something for", "vibes for", "need music for", ""];
const ADJ = ["horrible", "long", "stressful", "rough", "difficult", "amazing", "weird", "quiet", "tiring", "emotional", "strange", "heavy", "good", "bad", "intense", "peaceful"];
const EMOTIONS = ["sad", "nostalgic", "anxious", "peaceful", "exhausted", "hopeful", "lonely", "reflective", "numb", "free", "calm", "melancholy", "bittersweet", "overwhelmed", "content"];
const TIMES = ["midnight", "2am", "3am", "dusk", "dawn", "friday night", "sunday evening", "monday morning", "early morning", "late afternoon", "golden hour", "blue hour"];
const PLACES = ["the city", "my hometown", "nowhere in particular", "the coast", "the countryside", "my old neighbourhood", "an empty street", "the suburbs", "a rooftop", "the park"];
const EVENTS = ["the party", "a bad day", "the breakup", "work", "seeing old friends", "the funeral", "graduation", "moving day", "the argument", "a long shift"];
const WEATHER = ["rainy", "grey", "sunny", "foggy", "cold", "warm", "stormy", "misty", "overcast", "drizzle"];
const FEELINGS = ["don't want to go inside yet", "need a moment", "can't face going in", "just need to sit", "need to decompress", "can't go in yet"];
const ACTIVITIES = ["driving home", "on the motorway", "heading home", "taking the long way", "walking alone", "sitting in the car", "on the train"];
const ROADS = ["motorway", "A-road", "country lane", "coastal road", "ring road", "back roads"];
const PERSONS = ["no one", "my best mate", "someone I miss", "old friends", "family"];
const DAYS = ["saturday", "bank holiday", "rainy sunday", "friday", "monday", "a day off"];
const DRINKS = ["tea", "coffee", "hot chocolate", "a pint", "a cuppa"];
const SEASONS = ["summer", "winter", "autumn", "spring"];

const CORE_TEMPLATES = [
  // transport
  ["transport", "short", "{p} driving home after {adj} day"],
  ["transport", "short", "{p} empty motorway at {time}"],
  ["transport", "medium", "{p} rain on the windscreen {activity}"],
  ["transport", "medium", "{p} sitting in my car after work when I {feeling}"],
  ["transport", "medium", "{p} late night drive on the {road}"],
  ["transport", "short", "{p} stuck in traffic feeling {emotion}"],
  ["transport", "medium", "{p} train journey to {place}"],
  ["transport", "short", "{p} waiting for the train feeling {emotion}"],
  ["transport", "medium", "{p} taxi ride home after {event}"],
  ["transport", "medium", "{p} walking home alone after {event}"],
  ["transport", "long", "{p} road trip with {person} through {place} on a {weather} day"],
  ["transport", "medium", "{p} first solo drive feeling {emotion}"],
  ["transport", "medium", "{p} countryside drive on a {weather} {season} day"],
  ["transport", "medium", "{p} coastal drive with windows down at {time}"],
  ["transport", "short", "{p} cycling alone through {place}"],
  // home
  ["home", "medium", "{p} finally got home after {adj} day"],
  ["home", "short", "{p} cup of tea after work"],
  ["home", "short", "{p} sitting on the sofa feeling {emotion}"],
  ["home", "medium", "{p} late night kitchen everyone asleep"],
  ["home", "short", "{p} empty house on a {day}"],
  ["home", "short", "{p} shower after a long day"],
  ["home", "short", "{p} lazy sunday at home"],
  ["home", "medium", "{p} rainy day indoors with {drink}"],
  ["home", "medium", "{p} moving house feeling {emotion}"],
  ["home", "medium", "{p} first night in new flat"],
  // relationships
  ["relationships", "medium", "{p} missing someone far away"],
  ["relationships", "medium", "{p} after the breakup driving alone"],
  ["relationships", "short", "{p} first date nerves"],
  ["relationships", "medium", "{p} falling in love feeling {emotion}"],
  ["relationships", "medium", "{p} heartbreak and {weather}"],
  ["relationships", "medium", "{p} old friends reunion in {place}"],
  ["relationships", "short", "{p} waiting for them to text back"],
  // life
  ["life", "medium", "{p} graduation day feeling {emotion}"],
  ["life", "short", "{p} first day at new job"],
  ["life", "medium", "{p} moving away from home"],
  ["life", "long", "{p} starting a new chapter in life after {event}"],
  ["life", "short", "{p} got promoted today"],
  ["life", "medium", "{p} grief after losing someone"],
  ["life", "long", "{p} life is changing and I don't know where I'm going"],
  // social
  ["social", "short", "{p} quiet pub on a sunday"],
  ["social", "medium", "{p} after everyone left the party"],
  ["social", "medium", "{p} family gathering feeling {emotion}"],
  ["social", "short", "{p} festival weekend vibes"],
  ["social", "short", "{p} night out feeling {emotion}"],
  // places
  ["places", "short", "{p} petrol station at night"],
  ["places", "short", "{p} supermarket at 2am"],
  ["places", "medium", "{p} empty car park feeling {emotion}"],
  ["places", "medium", "{p} at the beach {time}"],
  ["places", "medium", "{p} hospital waiting room"],
  ["places", "short", "{p} bedroom at night overthinking"],
  // weather experiential
  ["weather", "short", "{p} cosy rain day indoors"],
  ["weather", "medium", "{p} sad rain matching my mood"],
  ["weather", "medium", "{p} summer rain after hot day"],
  ["weather", "short", "{p} sun on my face feeling free"],
  ["weather", "medium", "{p} fog and uncertainty about the future"],
  ["weather", "medium", "{p} rain on windows not going out"],
  // time
  ["time", "short", "{p} 2am thoughts can't sleep"],
  ["time", "short", "{p} friday evening freedom"],
  ["time", "short", "{p} sunday scaries before monday"],
  ["time", "short", "{p} monday morning dread"],
  ["time", "medium", "{p} winter evening cosy indoors"],
  ["time", "medium", "{p} summer evening warmth in {place}"],
  // british
  ["british", "short", "{p} absolutely knackered after work"],
  ["british", "short", "{p} proper shattered need to decompress"],
  ["british", "short", "{p} gutted about today"],
  ["british", "short", "{p} buzzing for the weekend"],
  ["british", "short", "{p} rough day need a cuppa"],
  ["british", "medium", "{p} doing my head in need to clear my head"],
  ["british", "short", "{p} can't be bothered with anything"],
  ["british", "medium", "{p} fancy a drive to clear my head"],
  ["british", "short", "{p} bank holiday vibes"],
  ["british", "short", "{p} sunday roast with family"],
  // poetic
  ["poetic", "long", "{p} the feeling of {season} ending"],
  ["poetic", "medium", "{p} that weird calm after {event}"],
  ["poetic", "long", "{p} music for when you realise your life is changing"],
  ["poetic", "medium", "{p} main character moment walking through {place}"],
  ["poetic", "medium", "{p} i'm just existing not really living"],
  ["poetic", "medium", "{p} i miss the old days when everything was simpler"],
  ["poetic", "long", "{p} sitting outside because I wasn't ready to go in"],
  // messy
  ["messy", "messy", "{p} idk just vibes {emotion} {weather} maybe driving?"],
  ["messy", "messy", "{p} something for like when ur knackered but also need to cry?"],
  ["messy", "messy", "{p} music 4 when life is a lot rn"],
  ["messy", "messy", "{p} sad but also peaceful? rain? home? idk"],
  ["messy", "messy", "{p} need songs for 2am brain"],
];

const PICK = {
  p: PREFIXES, adj: ADJ, emotion: EMOTIONS, time: TIMES, place: PLACES,
  event: EVENTS, weather: WEATHER, feeling: FEELINGS, activity: ACTIVITIES,
  road: ROADS, person: PERSONS, day: DAYS, drink: DRINKS, season: SEASONS,
};

function fill(template, picks) {
  return template
    .replace("{p}", picks.p)
    .replace("{adj}", picks.adj)
    .replace("{emotion}", picks.emotion)
    .replace("{time}", picks.time)
    .replace("{place}", picks.place)
    .replace("{event}", picks.event)
    .replace("{weather}", picks.weather)
    .replace("{feeling}", picks.feeling)
    .replace("{activity}", picks.activity)
    .replace("{road}", picks.road)
    .replace("{person}", picks.person)
    .replace("{day}", picks.day)
    .replace("{drink}", picks.drink)
    .replace("{season}", picks.season)
    .replace(/\s+/g, " ")
    .trim();
}

const prompts = [];
const seen = new Set();

const GOLDEN = [
  "music for sitting in my car after work when I don't want to go inside yet",
  "I finally got home after one of the worst days I've had in ages",
  "Driving home after a horrible day with rain on the windscreen",
  "Rain on the windscreen driving home after a difficult day",
  "cuppa after a rough day",
  "2am and I can't sleep",
  "sunday scaries before monday",
  "main character moment driving at night",
  "i'm just existing not really living",
  "i miss the old days",
];

for (const p of GOLDEN) {
  if (!seen.has(p)) { seen.add(p); prompts.push({ prompt: p, category: "golden", style: "golden" }); }
}

// Systematic combinatorial generation
for (const [category, style, template] of CORE_TEMPLATES) {
  const keys = [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
  const uniqueKeys = [...new Set(keys)];

  function generate(idx, picks) {
    if (idx >= uniqueKeys.length) {
      const prompt = fill(template, picks);
      if (!seen.has(prompt)) {
        seen.add(prompt);
        prompts.push({ prompt, category, style });
      }
      return;
    }
    const key = uniqueKeys[idx];
    const options = PICK[key] ?? [""];
    for (const val of options) {
      picks[key] = val;
      generate(idx + 1, picks);
      if (prompts.length >= 10500) return;
    }
  }
  generate(0, {});
  if (prompts.length >= 10500) break;
}

// Pad with indexed variants if needed
let pad = 0;
while (prompts.length < 10000) {
  const base = CORE_TEMPLATES[pad % CORE_TEMPLATES.length];
  const picks = {};
  for (const [k, v] of Object.entries(PICK)) picks[k] = v[pad % v.length];
  const prompt = fill(base[2], picks) + ` (${pad})`;
  if (!seen.has(prompt)) {
    seen.add(prompt);
    prompts.push({ prompt, category: base[0], style: base[1] });
  }
  pad++;
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: prompts.length,
  prompts: prompts.slice(0, 10000),
};

writeFileSync(OUT, JSON.stringify(output), "utf8");
console.log(`Generated ${output.count} benchmark prompts → ${OUT}`);
