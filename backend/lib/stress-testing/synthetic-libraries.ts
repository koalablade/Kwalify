/**
 * Synthetic user libraries for cross-library robustness testing.
 */

import type { SyntheticLibraryProfile } from "./types";
import type { ManifoldTrackInput } from "../user-taste-manifold";

function track(
  id: string,
  name: string,
  artist: string,
  genreFamily: string,
  features: Partial<ManifoldTrackInput>,
): ManifoldTrackInput {
  return {
    trackId: id,
    trackName: name,
    artistName: artist,
    genreFamily,
    energy: 0.5,
    valence: 0.5,
    tempo: 120,
    danceability: 0.5,
    acousticness: 0.3,
    instrumentalness: 0.2,
    ...features,
  };
}

export const SYNTHETIC_LIBRARIES: SyntheticLibraryProfile[] = [
  {
    id: "ultra-narrow-electronic",
    label: "Ultra-narrow (single electronic sub-style)",
    tracks: [
      track("n1", "Archangel", "Burial", "electronic", { energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, instrumentalness: 0.71 }),
      track("n2", "Night", "Burial", "electronic", { energy: 0.38, valence: 0.28, tempo: 130, danceability: 0.58, instrumentalness: 0.75 }),
      track("n3", "Near Dark", "Burial", "electronic", { energy: 0.35, valence: 0.25, tempo: 128, danceability: 0.55, instrumentalness: 0.78 }),
      track("n4", "Ghost Hardware", "Burial", "electronic", { energy: 0.44, valence: 0.3, tempo: 132, danceability: 0.6, instrumentalness: 0.7 }),
      track("n5", "Shell of Light", "Burial", "electronic", { energy: 0.36, valence: 0.32, tempo: 126, danceability: 0.57, instrumentalness: 0.68 }),
    ],
  },
  {
    id: "ultra-diverse",
    label: "Ultra-diverse (many families mixed)",
    tracks: [
      track("d1", "Archangel", "Burial", "electronic", { energy: 0.41, tempo: 134, instrumentalness: 0.71 }),
      track("d2", "Holocene", "Bon Iver", "indie", { energy: 0.32, acousticness: 0.72 }),
      track("d3", "Clair de Lune", "Debussy", "classical", { energy: 0.12, acousticness: 0.98, instrumentalness: 0.95 }),
      track("d4", "SICKO MODE", "Travis Scott", "hip_hop", { energy: 0.78, danceability: 0.72 }),
      track("d5", "Enter Sandman", "Metallica", "rock", { energy: 0.72, valence: 0.42 }),
      track("d6", "Take Five", "Dave Brubeck", "jazz", { energy: 0.35, acousticness: 0.55, instrumentalness: 0.85 }),
      track("d7", "Wagon Wheel", "Old Crow Medicine Show", "country", { energy: 0.58, acousticness: 0.62 }),
      track("d8", "An Ending", "Brian Eno", "electronic", { energy: 0.18, instrumentalness: 0.88 }),
    ],
  },
  {
    id: "classical-only",
    label: "Classical-only library",
    tracks: [
      track("c1", "Clair de Lune", "Debussy", "classical", { energy: 0.12, valence: 0.35, tempo: 68, acousticness: 0.98, instrumentalness: 0.95 }),
      track("c2", "Adagio", "Barber", "classical", { energy: 0.15, valence: 0.28, tempo: 60, acousticness: 0.96, instrumentalness: 0.94 }),
      track("c3", "Nocturne", "Chopin", "classical", { energy: 0.14, valence: 0.32, tempo: 72, acousticness: 0.97, instrumentalness: 0.93 }),
      track("c4", "The Four Seasons", "Vivaldi", "classical", { energy: 0.55, valence: 0.6, tempo: 132, acousticness: 0.9, instrumentalness: 0.92 }),
    ],
  },
  {
    id: "uk-electronic-only",
    label: "UK electronic-only library",
    tracks: [
      track("u1", "Archangel", "Burial", "electronic", { energy: 0.41, valence: 0.22, tempo: 134, danceability: 0.62, instrumentalness: 0.71 }),
      track("u2", "Girl", "Jamie xx", "electronic", { energy: 0.55, valence: 0.35, tempo: 122, danceability: 0.68, instrumentalness: 0.42 }),
      track("u3", "Vessel", "Four Tet", "electronic", { energy: 0.52, valence: 0.38, tempo: 128, danceability: 0.71, instrumentalness: 0.88 }),
      track("u4", "21 Seconds", "So Solid Crew", "hip_hop", { energy: 0.72, valence: 0.55, tempo: 140, danceability: 0.78, instrumentalness: 0.01 }),
      track("u5", "Night", "Burial", "electronic", { energy: 0.38, valence: 0.28, tempo: 130, danceability: 0.58, instrumentalness: 0.75 }),
    ],
  },
  {
    id: "hip-hop-only",
    label: "Hip-hop-only library",
    tracks: [
      track("h1", "SICKO MODE", "Travis Scott", "hip_hop", { energy: 0.78, valence: 0.45, tempo: 155, danceability: 0.72 }),
      track("h2", "HUMBLE.", "Kendrick Lamar", "hip_hop", { energy: 0.68, valence: 0.52, tempo: 150, danceability: 0.75 }),
      track("h3", "Mask Off", "Future", "hip_hop", { energy: 0.62, valence: 0.38, tempo: 150, danceability: 0.82 }),
      track("h4", "Goosebumps", "Travis Scott", "hip_hop", { energy: 0.55, valence: 0.32, tempo: 130, danceability: 0.68 }),
    ],
  },
  {
    id: "empty-cold-start",
    label: "Empty / cold-start library",
    tracks: [],
    coldStart: true,
  },
];

export const ROBUSTNESS_SCENE_PROMPTS = [
  "Reading Agatha Christie",
  "Tokyo at 3am",
  "Warehouse rave at midnight",
  "Paris café in the rain",
  "Driving through rural France",
  "Cyberpunk dystopia",
  "Studying for an exam",
  "Sad indie driving at night",
];
