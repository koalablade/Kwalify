#!/usr/bin/env node
/**
 * Generate journal-style long narrative prompts for human experience benchmarking.
 * Run: node backend/scripts/generate-human-experience-benchmark-long.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "tests/human-experience-benchmark.json");
const OUT = join(ROOT, "tests/human-experience-benchmark-long.json");

const NARRATIVE_FRAMES = [
  (m) =>
    `I don't usually write this down but ${m}. Everything feels suspended tonight and I need music that understands without me having to explain every detail.`,
  (m) =>
    `It's been one of those days where the small things stack up. ${m}. I'm looking for a soundtrack that sits with me in it rather than trying to fix anything.`,
  (m) =>
    `I keep replaying the last few hours in my head. ${m}. The world outside feels distant and I want songs that match this private moment.`,
  (m) =>
    `Not sure why this memory surfaced but ${m}. There's a specific feeling I can't name and I'm hoping the right music finds it for me.`,
  (m) =>
    `Everyone else has gone to bed and I'm still here thinking. ${m}. I need something that feels like company without being loud about it.`,
  (m) =>
    `I thought I'd feel different by now but ${m}. Maybe if I put the right songs on I can finally let the day settle.`,
  (m) =>
    `There's a version of me from a few years ago who would have handled this differently. ${m}. Tonight I just want to be honest about where I actually am.`,
  (m) =>
    `The weather matches my mood more than I'd like to admit. ${m}. Looking for music that holds space for reflection without rushing me forward.`,
];

const GOLDEN_LONG = [
  {
    prompt:
      "I've been sitting in my car in the driveway for twenty minutes because I can't face walking through the front door yet. Rain on the windscreen, the streetlights blurring, work still sitting on my chest. I don't need hype — I need music that understands what it feels like to be alone in a moving stillness, decompressing before I have to be a person again at home.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "Today was genuinely one of the worst days I've had in ages and I'm only just starting to feel it now that the noise has stopped. I finally got home, made tea I haven't touched, and I'm sitting in the kitchen while everyone else sleeps. I want a soundtrack for that hollow relief when you're safe but not okay yet.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "Driving home after midnight with rain on the windscreen and the motorway almost empty. I'm not in a rush to get anywhere — I'm using the drive as a room to think. The city is behind me and I need music that feels like miles of quiet road and thoughts you don't say out loud.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "Everyone left the party an hour ago and the flat feels too big suddenly. I'm sat outside on the step because going inside means the night is really over. There's a bittersweet quiet I don't want to break — music for the emotional hangover when the good part is finished.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "Found a box of old photos while clearing out the spare room and now I'm on the floor at 11pm going through years I can't get back. Some of the people in these pictures aren't in my life anymore. I want something nostalgic but warm, not cruel — music for remembering without drowning in it.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "Finished my last exam today and everyone keeps asking how it went. I don't have words yet — just this strange mix of exhaustion and disbelief that it's actually over. Walking home through the campus at dusk feeling like my body doesn't know whether to collapse or celebrate.",
    category: "golden",
    style: "long_narrative",
  },
  {
    prompt:
      "I'm knackered in that deep way where your brain won't switch off even though your body is done. Parked up round the corner from my flat because I need five minutes before I go in and become available to everyone again. Cup of tea going cold. Music for the transition space between work-me and home-me.",
    category: "british",
    style: "long_narrative",
  },
  {
    prompt:
      "Sunday evening and the dread is creeping in already. The weekend didn't fix anything and Monday is waiting like a door I don't want to open. I'm on the sofa with the curtains half closed, not ready to think about emails or alarms. Need something that acknowledges the scaries without making them worse.",
    category: "british",
    style: "long_narrative",
  },
];

function stripMetaPrefix(prompt) {
  return prompt
    .replace(/^(music|songs|playlist|something|vibes|need music) for\s+/i, "")
    .replace(/^\s+/, "")
    .replace(/\s*\(\d+\)\s*$/, "");
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function coreMoment(prompt) {
  const stripped = stripMetaPrefix(prompt);
  const lower = stripped.toLowerCase();
  if (/^(driving|sitting|walking|rain|after|finally|late|empty|waiting)/i.test(stripped)) {
    return stripped.charAt(0).toLowerCase() + stripped.slice(1);
  }
  return lower;
}

const source = JSON.parse(readFileSync(SOURCE, "utf8"));
const seen = new Set();
const prompts = [...GOLDEN_LONG];

const sourceStyles = new Set(["long", "medium", "poetic", "messy", "golden"]);
for (const entry of source.prompts) {
  if (!sourceStyles.has(entry.style)) continue;
  const moment = coreMoment(entry.prompt);
  for (let fi = 0; fi < NARRATIVE_FRAMES.length; fi++) {
    const frame = NARRATIVE_FRAMES[fi];
    const prompt = frame(moment);
    if (wordCount(prompt) < 28) continue;
    if (seen.has(prompt)) continue;
    seen.add(prompt);
    prompts.push({
      prompt,
      category: entry.category,
      style: "long_narrative",
    });
  }
}

// Pad with combined two-moment narratives from long-style seeds
const longSeeds = source.prompts.filter((p) => p.style === "long").slice(0, 800);
for (let i = 0; i < longSeeds.length - 1; i += 2) {
  const a = coreMoment(longSeeds[i].prompt);
  const b = coreMoment(longSeeds[i + 1].prompt);
  const prompt = `Two things are true at once tonight: ${a}, and also ${b}. I'm trying to find music that holds both without flattening either into something generic.`;
  if (wordCount(prompt) >= 28 && !seen.has(prompt)) {
    seen.add(prompt);
    prompts.push({
      prompt,
      category: longSeeds[i].category,
      style: "long_narrative",
    });
  }
}

const counts = prompts.map((p) => wordCount(p.prompt));
const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  count: prompts.length,
  wordStats: {
    min: Math.min(...counts),
    max: Math.max(...counts),
    avg: Math.round(counts.reduce((a, b) => a + b, 0) / counts.length),
    p50: counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)],
  },
  prompts,
};

writeFileSync(OUT, JSON.stringify(output), "utf8");
console.log(
  `Generated ${output.count} long narrative prompts (avg ${output.wordStats.avg} words, p50 ${output.wordStats.p50}) → ${OUT}`,
);
