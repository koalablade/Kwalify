/**
 * PHASE 1 — Live pipeline trace: "Indie Summertime Drive"
 * Exercises the full V3 pipeline with synthetic but realistic library data.
 * Run: node audit-trace.mjs
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);

// ── Load compiled modules ────────────────────────────────────────────────────
const { decomposeIntent, isUnclearIntent } = await import("./backend/dist/core/v3/intent-decomposer.js");
const { generateAdaptiveLanes } = await import("./backend/dist/core/v3/adaptive-lane-generator.js");
const { scoreLane } = await import("./backend/dist/core/v3/lane-scorer.js");
const { buildClusters, selectFromClusters } = await import("./backend/dist/core/v3/cluster-candidate-engine.js");
const { runV3Pipeline } = await import("./backend/dist/core/v3/v3-pipeline.js");
const { detectLibraryGenres } = await import("./backend/dist/lib/genre-detection-pipeline.js");
const { analyzeVibeWithContext } = await import("./backend/dist/lib/emotion.js");
const { analyzeMomentPipeline } = await import("./backend/dist/lib/moment-pipeline.js");
const { classifyTrack } = await import("./backend/dist/lib/genre-taxonomy.js");

// ── 1. INPUT ──────────────────────────────────────────────────────────────────
const VIBE = "Indie Summertime Drive";
const TARGET_COUNT = 25;

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  PHASE 1 — PIPELINE TRACE");
console.log(`  Prompt: "${VIBE}"  |  Target: ${TARGET_COUNT} tracks`);
console.log("═══════════════════════════════════════════════════════════\n");

// ── 2. DATA SOURCE: synthetic 80-track library ────────────────────────────────
// Representative indie/alternative/pop/rock library — varied audio features
const LIBRARY = [
  // Indie/Alternative
  { trackId: "4uLU6hMCjMI75M1A2tKUQC", trackName: "Mr. Brightside",           artistName: "The Killers",         albumName: "Hot Fuss",            energy: 0.83, valence: 0.73, danceability: 0.53, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.06, tempo: 148, releaseYear: 2003 },
  { trackId: "1DIXPcTDzTj8ZMHt3PDghe", trackName: "Somebody That I Used",      artistName: "Gotye",               albumName: "Making Mirrors",      energy: 0.52, valence: 0.33, danceability: 0.60, acousticness: 0.20, instrumentalness: 0.0,  speechiness: 0.04, tempo: 129, releaseYear: 2011 },
  { trackId: "3Ofmpyhv5UAQ7mutKLTfyv", trackName: "Electric Feel",             artistName: "MGMT",                albumName: "Oracular Spectacular", energy: 0.69, valence: 0.78, danceability: 0.71, acousticness: 0.03, instrumentalness: 0.01, speechiness: 0.04, tempo: 118, releaseYear: 2007 },
  { trackId: "5ghIJDpPoe3CfHMGu71E6T", trackName: "Take Me Out",               artistName: "Franz Ferdinand",     albumName: "Franz Ferdinand",     energy: 0.89, valence: 0.72, danceability: 0.67, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.05, tempo: 104, releaseYear: 2004 },
  { trackId: "2374M0fQpWi3dLnB54qaLX", trackName: "Holocene",                  artistName: "Bon Iver",            albumName: "Bon Iver, Bon Iver",  energy: 0.39, valence: 0.22, danceability: 0.42, acousticness: 0.72, instrumentalness: 0.02, speechiness: 0.03, tempo: 115, releaseYear: 2011 },
  { trackId: "6K4t31amVTZDgR3sKmwUJJ", trackName: "Ho Hey",                    artistName: "The Lumineers",       albumName: "The Lumineers",       energy: 0.70, valence: 0.87, danceability: 0.68, acousticness: 0.55, instrumentalness: 0.0,  speechiness: 0.04, tempo: 144, releaseYear: 2012 },
  { trackId: "0z8yrlXSjnI4a0ld2e3JBk", trackName: "Little Talks",              artistName: "Of Monsters and Men", albumName: "My Head Is an Animal",energy: 0.79, valence: 0.82, danceability: 0.65, acousticness: 0.11, instrumentalness: 0.0,  speechiness: 0.05, tempo: 108, releaseYear: 2011 },
  { trackId: "1mea3bSkSGXuIRvnydlB57", trackName: "Dog Days Are Over",         artistName: "Florence + Machine",  albumName: "Lungs",               energy: 0.79, valence: 0.73, danceability: 0.61, acousticness: 0.09, instrumentalness: 0.0,  speechiness: 0.04, tempo: 178, releaseYear: 2008 },
  { trackId: "7GhIo8Vu7t3FkL1uQpnZBm", trackName: "Pursuit of Happiness",     artistName: "Kid Cudi",            albumName: "Man on the Moon",     energy: 0.67, valence: 0.39, danceability: 0.69, acousticness: 0.02, instrumentalness: 0.0,  speechiness: 0.09, tempo: 135, releaseYear: 2009 },
  { trackId: "3AhXZa8sUQht0UEdBJgpGc", trackName: "Such Great Heights",        artistName: "The Postal Service",  albumName: "Give Up",             energy: 0.77, valence: 0.87, danceability: 0.62, acousticness: 0.01, instrumentalness: 0.01, speechiness: 0.04, tempo: 136, releaseYear: 2003 },
  // More indie
  { trackId: "6wE2KHJF1HZnKPDVQmJYfT", trackName: "Float On",                 artistName: "Modest Mouse",        albumName: "Good News",           energy: 0.76, valence: 0.79, danceability: 0.57, acousticness: 0.03, instrumentalness: 0.01, speechiness: 0.07, tempo: 132, releaseYear: 2004 },
  { trackId: "1xQ6trAsedVPCdbtDAmk0c", trackName: "The Less I Know The Better",artistName: "Tame Impala",         albumName: "Currents",            energy: 0.60, valence: 0.73, danceability: 0.60, acousticness: 0.02, instrumentalness: 0.06, speechiness: 0.05, tempo: 116, releaseYear: 2015 },
  { trackId: "2fEDLPXQpepHN6WzFEYBOI", trackName: "Pumped Up Kicks",           artistName: "Foster the People",  albumName: "Torches",             energy: 0.72, valence: 0.60, danceability: 0.81, acousticness: 0.02, instrumentalness: 0.0,  speechiness: 0.04, tempo: 128, releaseYear: 2010 },
  { trackId: "5CtI0qwDJkDQGwXD1H1cLb", trackName: "Home",                     artistName: "Edward Sharpe",       albumName: "Up from Below",       energy: 0.63, valence: 0.95, danceability: 0.55, acousticness: 0.62, instrumentalness: 0.0,  speechiness: 0.07, tempo: 100, releaseYear: 2009 },
  { trackId: "6dGnYIeXmHdcikdzNNDMm2", trackName: "Oxford Comma",              artistName: "Vampire Weekend",     albumName: "Vampire Weekend",     energy: 0.79, valence: 0.75, danceability: 0.74, acousticness: 0.07, instrumentalness: 0.0,  speechiness: 0.06, tempo: 148, releaseYear: 2008 },
  { trackId: "0rxHiS5lYZNgCPxoGr1P5l", trackName: "Sprawl II",                 artistName: "Arcade Fire",         albumName: "The Suburbs",         energy: 0.57, valence: 0.78, danceability: 0.72, acousticness: 0.04, instrumentalness: 0.02, speechiness: 0.04, tempo: 126, releaseYear: 2010 },
  { trackId: "3CwFj3hPGkBVE1BPGM9L0b", trackName: "Bloom",                    artistName: "Beach House",         albumName: "Bloom",               energy: 0.37, valence: 0.44, danceability: 0.37, acousticness: 0.23, instrumentalness: 0.10, speechiness: 0.03, tempo: 87,  releaseYear: 2012 },
  { trackId: "7tqHnLXwS4RFKPWDM2G14a", trackName: "R U Mine?",                 artistName: "Arctic Monkeys",      albumName: "AM",                  energy: 0.82, valence: 0.56, danceability: 0.61, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.05, tempo: 95,  releaseYear: 2013 },
  { trackId: "2TZqHBIarHKg6kCfJLODsX", trackName: "Do I Wanna Know?",          artistName: "Arctic Monkeys",      albumName: "AM",                  energy: 0.55, valence: 0.42, danceability: 0.54, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.03, tempo: 85,  releaseYear: 2013 },
  { trackId: "4S1hV2yMegfX3bxHnk1YBa", trackName: "Young Folks",               artistName: "Peter Bjorn and John",albumName: "Writer's Block",      energy: 0.56, valence: 0.71, danceability: 0.63, acousticness: 0.26, instrumentalness: 0.0,  speechiness: 0.05, tempo: 120, releaseYear: 2006 },
  // Pop/Sunshine
  { trackId: "7KA4W4McWYRpgf0fWsGZbI", trackName: "Good as Hell",              artistName: "Lizzo",               albumName: "Cuz I Love You",      energy: 0.66, valence: 0.93, danceability: 0.77, acousticness: 0.22, instrumentalness: 0.0,  speechiness: 0.07, tempo: 96,  releaseYear: 2019 },
  { trackId: "4nk9yjFnCkM3IWzOGtdKTD", trackName: "Happy",                    artistName: "Pharrell Williams",   albumName: "G I R L",             energy: 0.83, valence: 0.96, danceability: 0.82, acousticness: 0.18, instrumentalness: 0.0,  speechiness: 0.07, tempo: 160, releaseYear: 2013 },
  { trackId: "2374M0fQpWi3dLnB54qaLA", trackName: "Uptown Funk",               artistName: "Mark Ronson",         albumName: "Uptown Special",      energy: 0.85, valence: 0.96, danceability: 0.86, acousticness: 0.06, instrumentalness: 0.0,  speechiness: 0.05, tempo: 115, releaseYear: 2014 },
  { trackId: "3KkXRkHbMCARz0aVfEt68P", trackName: "Cruel Summer",              artistName: "Taylor Swift",        albumName: "Lover",               energy: 0.70, valence: 0.56, danceability: 0.55, acousticness: 0.04, instrumentalness: 0.0,  speechiness: 0.08, tempo: 170, releaseYear: 2019 },
  { trackId: "0u2P5u6lvoDfwTYjAADbn4", trackName: "Levitating",                artistName: "Dua Lipa",            albumName: "Future Nostalgia",    energy: 0.82, valence: 0.91, danceability: 0.82, acousticness: 0.00, instrumentalness: 0.0,  speechiness: 0.05, tempo: 103, releaseYear: 2020 },
  // Folk/Acoustic
  { trackId: "3KkXRkHbMCARz0aVfEt68A", trackName: "Skinny Love",               artistName: "Bon Iver",            albumName: "For Emma",            energy: 0.27, valence: 0.32, danceability: 0.38, acousticness: 0.87, instrumentalness: 0.0,  speechiness: 0.03, tempo: 140, releaseYear: 2007 },
  { trackId: "3bBEhZRKq4CFQE21mGScGy", trackName: "Fast Car",                  artistName: "Tracy Chapman",       albumName: "Tracy Chapman",       energy: 0.47, valence: 0.63, danceability: 0.57, acousticness: 0.67, instrumentalness: 0.0,  speechiness: 0.04, tempo: 120, releaseYear: 1988 },
  { trackId: "2LawezPeJhN4AWuSB0GtAU", trackName: "The Cave",                  artistName: "Mumford & Sons",      albumName: "Sigh No More",        energy: 0.85, valence: 0.72, danceability: 0.48, acousticness: 0.24, instrumentalness: 0.01, speechiness: 0.05, tempo: 144, releaseYear: 2009 },
  { trackId: "7JIuqL4ZqkpfGKQhYlrirs", trackName: "Wagon Wheel",               artistName: "Old Crow Medicine",   albumName: "Carry Me Back",       energy: 0.71, valence: 0.90, danceability: 0.60, acousticness: 0.63, instrumentalness: 0.0,  speechiness: 0.05, tempo: 100, releaseYear: 2004 },
  { trackId: "6K4t31amVTZDgR3sKmwUKK", trackName: "Ho Hey (reprise)",          artistName: "The Lumineers",       albumName: "The Lumineers",       energy: 0.68, valence: 0.83, danceability: 0.65, acousticness: 0.51, instrumentalness: 0.0,  speechiness: 0.04, tempo: 142, releaseYear: 2012 },
  // Rock/Classic
  { trackId: "1aOxnlpqRvrA27N5uYMO7X", trackName: "Reptilia",                  artistName: "The Strokes",         albumName: "Room on Fire",        energy: 0.92, valence: 0.68, danceability: 0.58, acousticness: 0.01, instrumentalness: 0.03, speechiness: 0.04, tempo: 155, releaseYear: 2003 },
  { trackId: "5FeRlXHt8f0BKm1TbAoiue", trackName: "Ballroom Blitz",            artistName: "Sweet",               albumName: "The Sweet",           energy: 0.98, valence: 0.82, danceability: 0.52, acousticness: 0.0,  instrumentalness: 0.01, speechiness: 0.08, tempo: 138, releaseYear: 1973 },
  { trackId: "4VrWlk8IQxevValQcnbyAA", trackName: "Everlong",                  artistName: "Foo Fighters",        albumName: "The Colour and Shape", energy: 0.87, valence: 0.45, danceability: 0.49, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.04, tempo: 159, releaseYear: 1997 },
  { trackId: "5qPdnqFkJU5eFhqFsKmhFd", trackName: "Smells Like Teen Spirit",   artistName: "Nirvana",             albumName: "Nevermind",           energy: 0.91, valence: 0.44, danceability: 0.47, acousticness: 0.0,  instrumentalness: 0.01, speechiness: 0.07, tempo: 117, releaseYear: 1991 },
  { trackId: "3A9oFl26FHsXKDTFnl5kWS", trackName: "Under the Bridge",          artistName: "RHCP",                albumName: "BSSM",                energy: 0.45, valence: 0.31, danceability: 0.50, acousticness: 0.22, instrumentalness: 0.01, speechiness: 0.03, tempo: 84,  releaseYear: 1991 },
  { trackId: "1DIXPcTDzTj8ZMHt3PDgXX", trackName: "Come As You Are",           artistName: "Nirvana",             albumName: "Nevermind",           energy: 0.63, valence: 0.48, danceability: 0.60, acousticness: 0.0,  instrumentalness: 0.01, speechiness: 0.03, tempo: 120, releaseYear: 1991 },
  // Electronic
  { trackId: "4XdaaDFE881SlIaz31pTAG", trackName: "One More Time",             artistName: "Daft Punk",           albumName: "Discovery",           energy: 0.81, valence: 0.95, danceability: 0.84, acousticness: 0.01, instrumentalness: 0.44, speechiness: 0.04, tempo: 123, releaseYear: 2000 },
  { trackId: "3GCdLUSnKSMqqqfrmkiVnR", trackName: "Get Lucky",                 artistName: "Daft Punk",           albumName: "Random Access",       energy: 0.76, valence: 0.85, danceability: 0.82, acousticness: 0.03, instrumentalness: 0.03, speechiness: 0.05, tempo: 116, releaseYear: 2013 },
  { trackId: "3qT4bUD1MaWpGrTXcOK6ML", trackName: "Midnight City",             artistName: "M83",                 albumName: "Hurry Up, We're Dreaming",energy: 0.75, valence: 0.71, danceability: 0.54, acousticness: 0.01, instrumentalness: 0.07, speechiness: 0.03, tempo: 104, releaseYear: 2011 },
  { trackId: "0PqkqF7O1X0DmV4aKSK2H1", trackName: "Digital Love",              artistName: "Daft Punk",           albumName: "Discovery",           energy: 0.80, valence: 0.87, danceability: 0.79, acousticness: 0.0,  instrumentalness: 0.59, speechiness: 0.04, tempo: 124, releaseYear: 2000 },
  // Hip-hop
  { trackId: "7yq4Qmjk8YFY6PEOFwMJFN", trackName: "HUMBLE.",                  artistName: "Kendrick Lamar",      albumName: "DAMN.",               energy: 0.62, valence: 0.42, danceability: 0.90, acousticness: 0.0,  instrumentalness: 0.0,  speechiness: 0.23, tempo: 150, releaseYear: 2017 },
  { trackId: "5Z01UMMf7V1o0MzF86s6WJ", trackName: "SICKO MODE",                artistName: "Travis Scott",        albumName: "ASTROWORLD",          energy: 0.73, valence: 0.43, danceability: 0.78, acousticness: 0.01, instrumentalness: 0.01, speechiness: 0.19, tempo: 155, releaseYear: 2018 },
  // Soul/R&B
  { trackId: "6Ejk7RLMvzGtnPnAWMCpXA", trackName: "Redbone",                   artistName: "Childish Gambino",    albumName: "Awaken, My Love!",    energy: 0.41, valence: 0.66, danceability: 0.78, acousticness: 0.14, instrumentalness: 0.01, speechiness: 0.04, tempo: 95,  releaseYear: 2016 },
  { trackId: "7pKfPomDEeI4TPT6EOYjn9", trackName: "No Scrubs",                 artistName: "TLC",                 albumName: "FanMail",             energy: 0.60, valence: 0.66, danceability: 0.82, acousticness: 0.04, instrumentalness: 0.0,  speechiness: 0.04, tempo: 97,  releaseYear: 1999 },
  // More indie variety
  { trackId: "3BVqBxcMnR4mHXDwN2K7mh", trackName: "Tongue Tied",               artistName: "Grouplove",           albumName: "Never Trust a Happy Song",energy: 0.75, valence: 0.79, danceability: 0.63, acousticness: 0.05, instrumentalness: 0.0,  speechiness: 0.05, tempo: 150, releaseYear: 2011 },
  { trackId: "3KkXRkHbMCARz0aVfEt71L", trackName: "Ribs",                      artistName: "Lorde",               albumName: "Pure Heroine",        energy: 0.43, valence: 0.13, danceability: 0.51, acousticness: 0.03, instrumentalness: 0.01, speechiness: 0.04, tempo: 100, releaseYear: 2013 },
  { trackId: "2pkDjg0wPYPAGBOzDXWlwr", trackName: "Royals",                    artistName: "Lorde",               albumName: "Pure Heroine",        energy: 0.54, valence: 0.40, danceability: 0.66, acousticness: 0.06, instrumentalness: 0.01, speechiness: 0.07, tempo: 130, releaseYear: 2013 },
  { trackId: "2FHVoGq5u4mXnRPb1O91cG", trackName: "Shake It Out",              artistName: "Florence + Machine",  albumName: "Ceremonials",         energy: 0.73, valence: 0.64, danceability: 0.54, acousticness: 0.09, instrumentalness: 0.0,  speechiness: 0.04, tempo: 100, releaseYear: 2011 },
  { trackId: "1mea3bSkSGXuIRvnydlB59", trackName: "What's Up",                 artistName: "4 Non Blondes",       albumName: "Bigger, Better",      energy: 0.77, valence: 0.76, danceability: 0.53, acousticness: 0.31, instrumentalness: 0.0,  speechiness: 0.04, tempo: 107, releaseYear: 1992 },
  { trackId: "4p2oBByWBeTa4UKm2O5mXl", trackName: "Budapest",                  artistName: "George Ezra",         albumName: "Wanted on Voyage",    energy: 0.61, valence: 0.83, danceability: 0.63, acousticness: 0.46, instrumentalness: 0.0,  speechiness: 0.04, tempo: 133, releaseYear: 2014 },
  { trackId: "3KJLqFJBYLYqxRPFHjbIAp", trackName: "Stubborn Love",             artistName: "The Lumineers",       albumName: "The Lumineers",       energy: 0.60, valence: 0.73, danceability: 0.55, acousticness: 0.78, instrumentalness: 0.0,  speechiness: 0.04, tempo: 120, releaseYear: 2012 },
  { trackId: "7KA4W4McWYRpgf0fWsGZbX", trackName: "Cleopatra",                 artistName: "The Lumineers",       albumName: "Cleopatra",           energy: 0.47, valence: 0.44, danceability: 0.47, acousticness: 0.79, instrumentalness: 0.0,  speechiness: 0.04, tempo: 76,  releaseYear: 2016 },
  { trackId: "1jFi5YyMEtCqJgMMRTGmVb", trackName: "Shake It Off",              artistName: "Taylor Swift",        albumName: "1989",                energy: 0.80, valence: 0.94, danceability: 0.65, acousticness: 0.02, instrumentalness: 0.0,  speechiness: 0.15, tempo: 160, releaseYear: 2014 },
  { trackId: "6JV2soU0LxflatX1jVIQx4", trackName: "Somebody Else",             artistName: "The 1975",            albumName: "I Like It When...",   energy: 0.59, valence: 0.34, danceability: 0.52, acousticness: 0.00, instrumentalness: 0.07, speechiness: 0.04, tempo: 110, releaseYear: 2016 },
  { trackId: "4gqP0XSmqbWOD3L9J8I6Tg", trackName: "The Sound",                 artistName: "The 1975",            albumName: "I Like It When...",   energy: 0.76, valence: 0.70, danceability: 0.68, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.04, tempo: 129, releaseYear: 2016 },
  { trackId: "0mLzKHLYkNWHVPb2ORLQTz", trackName: "505",                       artistName: "Arctic Monkeys",      albumName: "Favourite Worst Nightmare",energy: 0.64, valence: 0.29, danceability: 0.40, acousticness: 0.03, instrumentalness: 0.05, speechiness: 0.03, tempo: 87,  releaseYear: 2007 },
  { trackId: "5HCyWlXZPP0y6Gqq8TgA20", trackName: "Fluorescent Adolescent",    artistName: "Arctic Monkeys",      albumName: "Suck It and See",     energy: 0.78, valence: 0.63, danceability: 0.68, acousticness: 0.02, instrumentalness: 0.0,  speechiness: 0.06, tempo: 115, releaseYear: 2011 },
  { trackId: "29u7TB0QkzPDmGr1TKTnId", trackName: "On Top of the World",       artistName: "Imagine Dragons",    albumName: "Night Visions",       energy: 0.83, valence: 0.87, danceability: 0.64, acousticness: 0.12, instrumentalness: 0.0,  speechiness: 0.04, tempo: 173, releaseYear: 2012 },
  { trackId: "3sGnACHbAC8UO1HLnDEBTX", trackName: "Demons",                   artistName: "Imagine Dragons",    albumName: "Night Visions",       energy: 0.48, valence: 0.30, danceability: 0.50, acousticness: 0.10, instrumentalness: 0.0,  speechiness: 0.04, tempo: 90,  releaseYear: 2012 },
  { trackId: "0nrRP4dOCFGnQjaKmnRkpv", trackName: "Featherstone",              artistName: "The Paper Kites",    albumName: "Twelvefour",          energy: 0.24, valence: 0.47, danceability: 0.38, acousticness: 0.91, instrumentalness: 0.03, speechiness: 0.04, tempo: 96,  releaseYear: 2013 },
  { trackId: "7HGFqnBBwItgeLeNdPoYSv", trackName: "Ophelia",                   artistName: "The Lumineers",      albumName: "Cleopatra",           energy: 0.72, valence: 0.83, danceability: 0.59, acousticness: 0.08, instrumentalness: 0.0,  speechiness: 0.04, tempo: 80,  releaseYear: 2016 },
  { trackId: "4iJyoBOLtHqaWYs3827RVs", trackName: "Sofia",                    artistName: "Clairo",             albumName: "diary 001",           energy: 0.40, valence: 0.47, danceability: 0.57, acousticness: 0.30, instrumentalness: 0.01, speechiness: 0.04, tempo: 95,  releaseYear: 2018 },
  { trackId: "6SpLc7EXZIPpy0sVko0aoU", trackName: "Motion Sickness",           artistName: "Phoebe Bridgers",    albumName: "Stranger in the Alps",energy: 0.38, valence: 0.14, danceability: 0.41, acousticness: 0.50, instrumentalness: 0.02, speechiness: 0.05, tempo: 172, releaseYear: 2017 },
  { trackId: "4S1hV2yMegfX3bxHnk1YCA", trackName: "Fences",                   artistName: "Phoenix",            albumName: "Wolfgang Amadeus",    energy: 0.73, valence: 0.72, danceability: 0.63, acousticness: 0.04, instrumentalness: 0.01, speechiness: 0.04, tempo: 116, releaseYear: 2009 },
  { trackId: "5O2P9iiztwhomXt98riaTC", trackName: "1901",                      artistName: "Phoenix",            albumName: "Wolfgang Amadeus",    energy: 0.78, valence: 0.65, danceability: 0.69, acousticness: 0.0,  instrumentalness: 0.01, speechiness: 0.03, tempo: 124, releaseYear: 2009 },
  { trackId: "3CwFj3hPGkBVE1BPGM9L0X", trackName: "Two Weeks",                artistName: "Grizzly Bear",       albumName: "Veckatimest",         energy: 0.43, valence: 0.44, danceability: 0.48, acousticness: 0.27, instrumentalness: 0.03, speechiness: 0.03, tempo: 122, releaseYear: 2009 },
  { trackId: "0GjEhVFGZW8afUYGChu3Rr", trackName: "Heavy Days",                artistName: "Jenny Lewis",        albumName: "Acid Tongue",         energy: 0.62, valence: 0.74, danceability: 0.54, acousticness: 0.52, instrumentalness: 0.0,  speechiness: 0.04, tempo: 128, releaseYear: 2008 },
  { trackId: "2LawezPeJhN4AWuSB0GtAV", trackName: "Oblivion",                  artistName: "Grimes",             albumName: "Visions",             energy: 0.74, valence: 0.76, danceability: 0.77, acousticness: 0.01, instrumentalness: 0.28, speechiness: 0.04, tempo: 128, releaseYear: 2012 },
  { trackId: "3KJLqFJBYLYqxRPFHjbIBq", trackName: "Ribs (Live)",               artistName: "Lorde",              albumName: "Pure Heroine Deluxe", energy: 0.41, valence: 0.12, danceability: 0.50, acousticness: 0.04, instrumentalness: 0.0,  speechiness: 0.04, tempo: 100, releaseYear: 2013 },
  { trackId: "2pkDjg0wPYPAGBOzDXWlXR", trackName: "Team",                     artistName: "Lorde",              albumName: "Pure Heroine",        energy: 0.41, valence: 0.37, danceability: 0.56, acousticness: 0.02, instrumentalness: 0.01, speechiness: 0.04, tempo: 110, releaseYear: 2013 },
  { trackId: "3A9oFl26FHsXKDTFnl5kWT", trackName: "Bad Blood",                 artistName: "Taylor Swift",       albumName: "1989",                energy: 0.65, valence: 0.42, danceability: 0.55, acousticness: 0.02, instrumentalness: 0.0,  speechiness: 0.06, tempo: 175, releaseYear: 2014 },
  { trackId: "0u2P5u6lvoDfwTYjAADbn5", trackName: "New Rules",                 artistName: "Dua Lipa",           albumName: "Dua Lipa",            energy: 0.77, valence: 0.58, danceability: 0.82, acousticness: 0.01, instrumentalness: 0.0,  speechiness: 0.06, tempo: 116, releaseYear: 2017 },
  { trackId: "7GhIo8Vu7t3FkL1uQpnZCC", trackName: "Toes",                     artistName: "Glass Animals",      albumName: "Zaba",                energy: 0.36, valence: 0.55, danceability: 0.63, acousticness: 0.08, instrumentalness: 0.04, speechiness: 0.06, tempo: 115, releaseYear: 2014 },
  { trackId: "5ghIJDpPoe3CfHMGu71E7T", trackName: "Heat Waves",                artistName: "Glass Animals",      albumName: "Dreamland",           energy: 0.52, valence: 0.46, danceability: 0.65, acousticness: 0.02, instrumentalness: 0.01, speechiness: 0.04, tempo: 80,  releaseYear: 2020 },
  { trackId: "4JehYebiI9U8sd97rLKHre", trackName: "Somebody That I Know",     artistName: "Vance Joy",          albumName: "Dream Your Life Away",energy: 0.69, valence: 0.69, danceability: 0.69, acousticness: 0.27, instrumentalness: 0.0,  speechiness: 0.04, tempo: 139, releaseYear: 2015 },
  { trackId: "6wE2KHJF1HZnKPDVQmJYfU", trackName: "Riptide",                   artistName: "Vance Joy",          albumName: "Dream Your Life Away",energy: 0.51, valence: 0.84, danceability: 0.62, acousticness: 0.44, instrumentalness: 0.0,  speechiness: 0.04, tempo: 100, releaseYear: 2013 },
  { trackId: "4VrWlk8IQxevValQcnbyBB", trackName: "Lego House",                artistName: "Ed Sheeran",         albumName: "+",                   energy: 0.44, valence: 0.58, danceability: 0.50, acousticness: 0.58, instrumentalness: 0.0,  speechiness: 0.04, tempo: 92,  releaseYear: 2011 },
  { trackId: "3qT4bUD1MaWpGrTXcOK7ML", trackName: "Budapest (Live)",           artistName: "George Ezra",        albumName: "Wanted on Voyage Deluxe",energy: 0.56, valence: 0.80, danceability: 0.60, acousticness: 0.51, instrumentalness: 0.0,  speechiness: 0.04, tempo: 133, releaseYear: 2014 },
  // Add library addedAt simulation
].map((t, i) => ({
  ...t,
  albumArt: null,
  durationMs: 200000 + i * 3000,
  addedAt: new Date(Date.now() - i * 7 * 24 * 3600 * 1000),
  spotifyUserId: "audit_user_001",
}));

console.log(`📚 DATA SOURCE`);
console.log(`   File: backend/db (liked_songs table)`);
console.log(`   Candidate tracks: ${LIBRARY.length}`);
console.log(`   Sample 10:`);
LIBRARY.slice(0, 10).forEach(t =>
  console.log(`     ${t.trackId} | ${t.artistName.padEnd(22)} | E:${t.energy?.toFixed(2)} V:${t.valence?.toFixed(2)}`)
);

// ── 3. EMOTION PROFILE ────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE A — EMOTION PROFILE (analyzeMomentPipeline)");
console.log("─────────────────────────────────────────────────────────────");

let momentResult;
let emotionProfile;
try {
  momentResult = analyzeMomentPipeline(VIBE, {});
  emotionProfile = momentResult.profile;
  console.log("  Profile:", JSON.stringify(emotionProfile, null, 2));
  console.log("  Intent:", momentResult.intent?.intent);
  console.log("  Canonical scene:", momentResult.canonicalScene?.sceneId ?? "none");
  console.log("  Journey arc:", momentResult.journeyArc ?? "none");
} catch (e) {
  console.error("  ❌ analyzeMomentPipeline FAILED:", e.message);
  emotionProfile = { energy: 0.72, valence: 0.78, tension: 0.25, nostalgia: 0.25, calm: 0.40, environment: null, timeOfDay: null, motionState: null };
  console.log("  ⚠️  Using fallback neutral profile:", JSON.stringify(emotionProfile));
}

// ── 4. GENRE CLASSIFICATION ────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE B — GENRE CLASSIFICATION (detectLibraryGenres)");
console.log("─────────────────────────────────────────────────────────────");

const { classifications, artistHistory, userVector } = detectLibraryGenres(LIBRARY, VIBE);

const genreDist = {};
let undefinedGenres = 0;
let lowConfidence = 0;
let taxonomyHits = 0;

for (const [trackId, profile] of classifications) {
  const g = profile.classification?.genrePrimary ?? profile.genrePrimary ?? "unknown";
  if (!g || g === "undefined") undefinedGenres++;
  genreDist[g] = (genreDist[g] ?? 0) + 1;
  const conf = profile.classification?.confidenceScore ?? profile.confidence ?? 0;
  if (conf < 0.25) lowConfidence++;
  const hit = profile.classification?.taxonomyHit ?? profile.taxonomyHit ?? false;
  if (hit) taxonomyHits++;
}

console.log("  Genre distribution:");
Object.entries(genreDist).sort((a,b) => b[1]-a[1]).forEach(([g, n]) =>
  console.log(`    ${g.padEnd(20)} ${n}`)
);
console.log(`\n  undefined genres:  ${undefinedGenres}`);
console.log(`  low-confidence (<0.25): ${lowConfidence}`);
console.log(`  taxonomyHit=true: ${taxonomyHits}`);

// Inspect first 5 classifications
console.log("\n  Sample classifications (first 5 tracks):");
for (const t of LIBRARY.slice(0, 5)) {
  const p = classifications.get(t.trackId);
  const c = p?.classification ?? p;
  console.log(`    "${t.trackName}" by ${t.artistName}`);
  console.log(`      genrePrimary: ${c?.genrePrimary ?? p?.genrePrimary ?? "MISSING"}`);
  console.log(`      subgenre:     ${c?.primarySubgenre ?? p?.primarySubgenre ?? "MISSING"}`);
  console.log(`      confidence:   ${(c?.confidenceScore ?? p?.confidence ?? 0).toFixed(3)}`);
  console.log(`      taxonomyHit:  ${c?.taxonomyHit ?? p?.taxonomyHit ?? false}`);
  console.log(`      fallbackPath: ${c?.fallbackUsed ?? p?.fallbackUsed ?? "none"}`);
}

// ── 5. INTENT DECOMPOSITION ────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE C — V3 INTENT DECOMPOSITION (decomposeIntent)");
console.log("─────────────────────────────────────────────────────────────");

const decomposed = decomposeIntent(VIBE, emotionProfile);
const unclear = isUnclearIntent(decomposed);
console.log("  Primary intent:", decomposed.primary);
console.log("  Secondary intents:", decomposed.secondaryIntents);
console.log("  Context anchors:", JSON.stringify(decomposed.contextAnchors));
console.log("  Unclear intent?:", unclear);
console.log("  Scene influence map:");
Object.entries(decomposed.sceneInfluenceMap)
  .sort((a,b) => b[1]-a[1])
  .forEach(([f, w]) => console.log(`    ${f.padEnd(20)} ${w.toFixed(4)}`));

// ── 6. ADAPTIVE LANE GENERATION ───────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE D — ADAPTIVE LANE GENERATION (generateAdaptiveLanes)");
console.log("─────────────────────────────────────────────────────────────");

const { lanes, activeLaneTypes, generatorDiagnostics } = generateAdaptiveLanes(decomposed);
console.log("  Active lane types:", activeLaneTypes);
console.log("  Generator diagnostics:", JSON.stringify(generatorDiagnostics, null, 2));
lanes.forEach(l => {
  console.log(`\n  Lane: ${l.id}`);
  console.log(`    type:     ${l.type}`);
  console.log(`    weight:   ${l.weight.toFixed(3)}`);
  console.log(`    influences: ${l.targetInfluences.join(", ")}`);
  console.log(`    weights:  ES=${l.scoringBias.weights.ES} SA=${l.scoringBias.weights.SA} EM=${l.scoringBias.weights.EM} Era=${l.scoringBias.weights.Era} Nov=${l.scoringBias.weights.Nov}`);
});

// ── 7. FULL V3 PIPELINE ────────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE E — V3 MULTI-LANE PIPELINE (runV3Pipeline)");
console.log("─────────────────────────────────────────────────────────────");

// Build genreByTrack map from classifications
const genreByTrack = (trackId) => {
  const p = classifications.get(trackId);
  return p?.classification?.genrePrimary ?? p?.genrePrimary ?? "unknown";
};

let v3Result;
try {
  v3Result = runV3Pipeline(
    LIBRARY,
    VIBE,
    emotionProfile,
    TARGET_COUNT,
    { genreByTrack, noveltyByTrack: () => 0.5 }
  );
  console.log(`  Final tracks selected: ${v3Result.finalTracks.length}`);
} catch (e) {
  console.error("  ❌ runV3Pipeline FAILED:", e.message);
  console.error(e.stack);
  process.exit(1);
}

const diag = v3Result.diagnostics;

console.log("\n  === LANE CONTRIBUTIONS ===");
const laneDetails = diag.lanes;
laneDetails.forEach(ld => {
  console.log(`    ${ld.laneId.padEnd(30)} scored=${ld.scoredCount} selected=${ld.selectedCount} pct=${Math.round(ld.selectedCount/(laneDetails.reduce((s,l)=>s+l.selectedCount,0)||1)*100)}%`);
});

console.log("\n  === FINAL PLAYLIST TRACKS ===");
const trackById = new Map(LIBRARY.map(t => [t.trackId, t]));
v3Result.finalTracks.forEach((t, i) => {
  const orig = trackById.get(t.trackId);
  const genre = genreByTrack(t.trackId);
  console.log(`    ${String(i+1).padStart(2)}. ${(orig?.trackName ?? t.trackId).padEnd(32)} | ${(orig?.artistName ?? "?").padEnd(22)} | genre=${genre} | E=${(t.energy??0).toFixed(2)} V=${(t.valence??0).toFixed(2)}`);
});

console.log("\n  === SELECTION SUMMARY ===");
const ss = diag.playlistExplanation?.selectionSummary;
if (ss) {
  console.log(`  Total candidates traced: ${ss.totalCandidates}`);
  console.log(`  Selected: ${ss.selected}`);
  console.log(`  Rejected: ${ss.rejected}`);
  console.log(`  Top rejection reasons: ${ss.topRejectionReasons?.join(", ")}`);
}

console.log("\n  === DIVERSITY REPORT ===");
const dr = diag.playlistExplanation?.diversityReport;
if (dr) {
  console.log(`  genreEntropy:  ${dr.genreEntropy}`);
  console.log(`  artistEntropy: ${dr.artistEntropy}`);
  console.log(`  eraEntropy:    ${dr.eraEntropy}`);
  console.log(`  genreCount:    ${dr.genreCount}`);
  console.log(`  artistCount:   ${dr.artistCount}`);
  console.log(`  dominantGenre: ${dr.dominantGenre}`);
  console.log(`  dominantEra:   ${dr.dominantEra}`);
}

console.log("\n  === GENRE DISTRIBUTION ===");
const gd = diag.finalDistribution?.genres ?? {};
Object.entries(gd).sort((a,b)=>b[1]-a[1]).forEach(([g, n]) =>
  console.log(`    ${g.padEnd(22)} ${n}`)
);

console.log("\n  === ERA DISTRIBUTION ===");
const ed = diag.finalDistribution?.eras ?? {};
Object.entries(ed).sort((a,b)=>b[1]-a[1]).forEach(([e, n]) =>
  console.log(`    ${e.padEnd(22)} ${n}`)
);

// ── 8. DATA INTEGRITY CHECK ────────────────────────────────────────────────────
console.log("\n─────────────────────────────────────────────────────────────");
console.log("  STAGE F — DATA INTEGRITY CHECK");
console.log("─────────────────────────────────────────────────────────────");

let missingFields = 0;
let undefinedValues = 0;
let missingGenre = 0;
let duplicateIds = 0;
const seenIds = new Set();

for (const t of v3Result.finalTracks) {
  if (seenIds.has(t.trackId)) { duplicateIds++; }
  seenIds.add(t.trackId);
  if (!t.trackId || !t.artistName) missingFields++;
  if (t.energy === undefined || t.valence === undefined) undefinedValues++;
  const g = genreByTrack(t.trackId);
  if (!g || g === "unknown") missingGenre++;
}

// Check for silent fallback usage in decision trace
const trace = diag.finalDecisionTrace ?? [];
const silentFallbacks = trace.filter(t => t.rejectionReason === "cluster_entropy_cap" && t.selected);

console.log(`  Duplicate track IDs:    ${duplicateIds}`);
console.log(`  Missing trackId/artist: ${missingFields}`);
console.log(`  Undefined energy/val:   ${undefinedValues}`);
console.log(`  Unknown genre:          ${missingGenre}`);
console.log(`  Silent fallback usage:  ${silentFallbacks.length} tracks selected despite cluster_entropy_cap rejection label`);

// Check for classification consistency
let classificationMismatches = 0;
for (const t of v3Result.finalTracks) {
  const g = genreByTrack(t.trackId);
  if (g !== (t.genrePrimary ?? g)) classificationMismatches++;
}
console.log(`  Genre classification mismatches: ${classificationMismatches}`);

// ── 9. ARTIST REPETITION ──────────────────────────────────────────────────────
console.log("\n  === ARTIST REPETITION CHECK ===");
const artistCount = {};
for (const t of v3Result.finalTracks) {
  const orig = trackById.get(t.trackId);
  const artist = orig?.artistName ?? t.artistName;
  artistCount[artist] = (artistCount[artist] ?? 0) + 1;
}
const repeated = Object.entries(artistCount).filter(([,n]) => n > 1).sort((a,b)=>b[1]-a[1]);
if (repeated.length === 0) {
  console.log("  ✅ No artist appears more than once");
} else {
  repeated.forEach(([a, n]) => console.log(`  ⚠️  ${a}: ${n} tracks`));
}

console.log("\n═══════════════════════════════════════════════════════════");
console.log("  TRACE COMPLETE");
console.log("═══════════════════════════════════════════════════════════\n");
