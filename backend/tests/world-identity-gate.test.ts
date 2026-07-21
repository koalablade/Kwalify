import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateWorldMembership,
  inferWorldIdentityIdsFromPrompt,
  isSafetyBlanketOutsideWorld,
  passesWorldIdentity,
  worldIdentityProfilesForLock,
} from "../core/editorial/world-identity-gate";
import { resolveSceneLock } from "../core/scene-lock-mode";
import { resolveWorldBoundary, isTrackInWorld, hardRejectOffWorldTracks } from "../core/world-boundary";
import type { IntentState } from "../core/intent-state-engine";

const emptyIntent = {} as IntentState;

test("goth identity rejects reggae / classic-rock bait under hard lock", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["goth_world"] });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "One Love",
        artistName: "Bob Marley",
        genreFamily: "reggae",
        spotifyArtistGenres: ["reggae"],
        energy: 0.5,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Dirty Little Secret",
        artistName: "The All-American Rejects",
        genreFamily: "rock",
        spotifyArtistGenres: ["pop punk", "emo"],
        energy: 0.7,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "A Forest",
        artistName: "The Cure",
        genreFamily: "rock",
        spotifyArtistGenres: ["gothic rock", "post-punk"],
        energy: 0.55,
        valence: 0.3,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("goth hard lock rejects Queen / Fleetwood Mac / Led Zeppelin without gothic evidence", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["goth_world"], prompt: "goth but danceable" });
  for (const artist of ["Queen", "Fleetwood Mac", "Led Zeppelin", "Blondie"]) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Hit",
          artistName: artist,
          genreFamily: "rock",
          spotifyArtistGenres: ["rock"],
          energy: 0.75,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      `${artist} must not enter goth world`,
    );
  }
});

test("title bait Gotham / bare Goth rejected without scene evidence", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["goth_world"] });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Gotham Love",
        artistName: "Random Pop",
        genreFamily: "pop",
        spotifyArtistGenres: ["dance pop"],
        energy: 0.6,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});

test("boss fight rejects soft folk and requires energy", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["boss_fight"] });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Holocene",
        artistName: "Bon Iver",
        genreFamily: "indie",
        spotifyArtistGenres: ["indie folk"],
        energy: 0.35,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Combat",
        artistName: "Industrial Act",
        genreFamily: "metal",
        spotifyArtistGenres: ["industrial metal"],
        energy: 0.85,
        valence: 0.3,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("world boundary wires identity into isTrackInWorld for goth lock", () => {
  const lock = resolveSceneLock(emptyIntent, "goth darkwave night");
  const world = resolveWorldBoundary({ sceneLock: lock, prompt: "goth darkwave night" });
  assert.equal(world.hardLock, true);
  assert.ok(world.lockAnchors.includes("goth_world"));
  assert.equal(
    isTrackInWorld(
      {
        trackId: "1",
        trackName: "Down Under",
        artistName: "Men At Work",
        genreFamily: "rock",
        genrePrimary: "rock",
        spotifyArtistGenres: ["classic rock"],
        energy: 0.7,
      },
      world,
      "rock",
    ),
    false,
  );
});

test("goth hard lock admits identity-verified tracks despite misclassified genre family", () => {
  const lock = resolveSceneLock(emptyIntent, "goth but danceable late night drive");
  const world = resolveWorldBoundary({ sceneLock: lock, prompt: "goth but danceable late night drive" });
  assert.ok(
    isTrackInWorld(
      {
        trackId: "cure1",
        trackName: "Just Like Heaven",
        artistName: "The Cure",
        genreFamily: "pop",
        genrePrimary: "pop",
        spotifyArtistGenres: ["gothic rock", "new wave"],
        energy: 0.55,
        valence: 0.42,
        danceability: 0.62,
      },
      world,
      "pop",
    ),
  );
});

test("Debbie Harry is treated as Blondie-family safety blanket outside natural worlds", () => {
  assert.equal(
    isSafetyBlanketOutsideWorld("Debbie Harry", ["goth_world"]),
    true,
  );
  assert.equal(
    isSafetyBlanketOutsideWorld("Debbie Harry", ["classic_rock_world"]),
    false,
  );
});

test("danceable goth profile relaxes valence and energy for upbeat darkwave", () => {
  const profiles = worldIdentityProfilesForLock({
    anchors: ["goth_world"],
    prompt: "goth but danceable late night drive",
  });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Just Like Heaven",
        artistName: "The Cure",
        genreFamily: "pop",
        spotifyArtistGenres: ["gothic rock", "new wave"],
        energy: 0.72,
        valence: 0.74,
        danceability: 0.68,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("rave comedown lock is active", () => {
  const lock = resolveSceneLock(emptyIntent, "rave comedown bus home");
  assert.equal(lock.active, true);
  assert.ok(lock.anchors.includes("rave_comedown"));
});

test("grunge keeps Offspring / Green Day but rejects Blondie / Fleetwood Mac", () => {
  const profiles = worldIdentityProfilesForLock({
    anchors: ["grunge_world"],
    prompt: "90s grunge dark cloudy night",
  });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Self Esteem",
        artistName: "The Offspring",
        genreFamily: "rock",
        spotifyArtistGenres: ["punk", "alternative rock"],
        energy: 0.8,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Basket Case",
        artistName: "Green Day",
        genreFamily: "rock",
        spotifyArtistGenres: ["punk", "pop punk"],
        energy: 0.82,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
  for (const artist of ["Blondie", "Men At Work", "Fleetwood Mac"]) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Hit",
          artistName: artist,
          genreFamily: "rock",
          spotifyArtistGenres: ["rock", "classic rock"],
          energy: 0.7,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      `${artist} must not contaminate grunge`,
    );
  }
});

test("safety blankets are blocked outside natural worlds", () => {
  assert.equal(isSafetyBlanketOutsideWorld("Blondie", ["grunge_world"]), true);
  assert.equal(isSafetyBlanketOutsideWorld("Fleetwood Mac", ["angry_rock_world"]), true);
  assert.equal(isSafetyBlanketOutsideWorld("Queen", ["goth_world"]), true);
  assert.equal(isSafetyBlanketOutsideWorld("AC/DC", ["gym_rock_world"]), false);
  assert.equal(isSafetyBlanketOutsideWorld("Fleetwood Mac", ["classic_rock_world"]), false);
  assert.equal(isSafetyBlanketOutsideWorld("Queens of the Stone Age", ["gym_rock_world"]), false);
});

test("energy cannot rescue off-world classic rock into angry rock workout", () => {
  const profiles = worldIdentityProfilesForLock({
    prompt: "angry rock workout",
  });
  assert.ok(profiles.some((p) => p.id === "angry_rock_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Dreams",
        artistName: "Fleetwood Mac",
        genreFamily: "rock",
        spotifyArtistGenres: ["classic rock", "soft rock"],
        energy: 0.92,
        danceability: 0.8,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    estimateWorldMembership(
      {
        trackName: "Dreams",
        artistName: "Fleetwood Mac",
        genreFamily: "rock",
        spotifyArtistGenres: ["classic rock"],
        energy: 0.95,
      },
      profiles,
    ),
    0,
  );
});

test("gym rock rejects dance / soft classic contaminants", () => {
  const lock = resolveSceneLock(emptyIntent, "gym rock");
  const world = resolveWorldBoundary({ sceneLock: lock, prompt: "gym rock" });
  assert.equal(world.hardLock, true);
  const rejected = hardRejectOffWorldTracks(
    [
      {
        trackId: "1",
        trackName: "Look Right Through",
        artistName: "Storm Queen",
        genreFamily: "electronic",
        genrePrimary: "house",
        energy: 0.85,
      },
      {
        trackId: "2",
        trackName: "Dreams",
        artistName: "Fleetwood Mac",
        genreFamily: "rock",
        genrePrimary: "rock",
        spotifyArtistGenres: ["classic rock"],
        energy: 0.7,
      },
      {
        trackId: "3",
        trackName: "Back In Black",
        artistName: "AC/DC",
        genreFamily: "rock",
        genrePrimary: "hard rock",
        spotifyArtistGenres: ["hard rock", "rock"],
        energy: 0.9,
      },
    ],
    world,
  );
  assert.equal(rejected.kept.some((t) => t.artistName === "AC/DC"), true);
  assert.equal(rejected.kept.some((t) => t.artistName === "Storm Queen"), false);
  assert.equal(rejected.kept.some((t) => t.artistName === "Fleetwood Mac"), false);
});

test("gym rock rejects Queen / Led Zeppelin / Blondie even with high energy", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "gym rock workout" });
  for (const artist of ["Queen", "Led Zeppelin", "Blondie", "Fleetwood Mac", "Storm Queen"]) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Hit",
          artistName: artist,
          genreFamily: "rock",
          spotifyArtistGenres: ["rock", "classic rock"],
          energy: 0.92,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      `${artist} must not enter gym rock via energy`,
    );
  }
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Back In Black",
        artistName: "AC/DC",
        genreFamily: "rock",
        spotifyArtistGenres: ["hard rock", "rock"],
        energy: 0.9,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("grunge rejects Blondie even when only genreFamily is passed (no artist)", () => {
  const world = resolveWorldBoundary({ prompt: "90s grunge dark cloudy night" });
  assert.equal(world.hardLock, true);
  assert.equal(
    isTrackInWorld(
      {
        trackId: "x",
        genreFamily: "rock",
        genrePrimary: "rock",
        // No artistName — family-only path used to soft-admit contaminants.
        energy: 0.7,
      },
      world,
      "rock",
    ),
    false,
  );
  assert.equal(
    isTrackInWorld(
      {
        trackId: "y",
        trackName: "Heart-Shaped Box",
        artistName: "Nirvana",
        genreFamily: "rock",
        genrePrimary: "grunge",
        spotifyArtistGenres: ["grunge", "alternative rock"],
        energy: 0.65,
      },
      world,
      "rock",
    ),
    true,
  );
});

test("classic rock world still admits Queen and Fleetwood Mac", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "70s rock evening" });
  assert.ok(profiles.some((p) => p.id === "classic_rock_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Bohemian Rhapsody",
        artistName: "Queen",
        genreFamily: "rock",
        spotifyArtistGenres: ["classic rock", "glam rock"],
        energy: 0.6,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("angry rock workout does not dual-lock gym (AND-identity death)", () => {
  const lock = resolveSceneLock({} as IntentState, "angry rock workout");
  assert.ok(lock.anchors.includes("angry_rock_world"));
  assert.equal(lock.anchors.includes("gym_rock_world"), false);
  const world = resolveWorldBoundary({ sceneLock: lock, prompt: "angry rock workout" });
  assert.equal(
    isTrackInWorld(
      {
        trackId: "1",
        trackName: "Self Esteem",
        artistName: "The Offspring",
        genreFamily: "rock",
        energy: 0.85,
      },
      world,
      "rock",
    ),
    true,
  );
  assert.equal(
    isTrackInWorld(
      {
        trackId: "2",
        trackName: "Dreams",
        artistName: "Fleetwood Mac",
        genreFamily: "rock",
        energy: 0.7,
      },
      world,
      "rock",
    ),
    false,
  );
});

test("inferWorldIdentityIdsFromPrompt covers listening-failure families", () => {
  assert.ok(inferWorldIdentityIdsFromPrompt("90s grunge dark cloudy night").includes("grunge_world"));
  assert.ok(inferWorldIdentityIdsFromPrompt("goth but danceable").includes("goth_world"));
  assert.ok(inferWorldIdentityIdsFromPrompt("angry rock workout").includes("angry_rock_world"));
  assert.ok(inferWorldIdentityIdsFromPrompt("sleepy gym").includes("sleepy_gym_world"));
  assert.ok(inferWorldIdentityIdsFromPrompt("2000s pop punk").includes("pop_punk_world"));
});

test("hard lock rejects rock-family tracks with no positive world evidence", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["goth_world"] });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Generic Riff",
        artistName: "Random Arena Band",
        genreFamily: "rock",
        spotifyArtistGenres: ["rock"],
        energy: 0.8,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});

test("hard lock does not soft-admit artist-only empty-meta into sleepy gym", () => {
  const profiles = worldIdentityProfilesForLock({ anchors: ["sleepy_gym_world"], prompt: "sleepy gym workout" });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Whatever",
        artistName: "Random Band With No Genres",
        energy: 0.4,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Soft Loop",
        artistName: "Bedroom Producer",
        genreFamily: "indie",
        spotifyArtistGenres: ["dream pop", "chillwave"],
        energy: 0.35,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("lofi and comedown identities admit chill-adjacent prototypes", () => {
  const lofi = worldIdentityProfilesForLock({ anchors: ["lofi_world"], prompt: "lofi but not boring" });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Feather",
        artistName: "Nujabes",
        genreFamily: "hip_hop",
        energy: 0.35,
      },
      lofi,
      { hardLock: true },
    ),
    true,
  );
  const comedown = worldIdentityProfilesForLock({ anchors: ["rave_comedown"], prompt: "rave comedown bus home" });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Dayvan Cowboy",
        artistName: "Boards of Canada",
        genreFamily: "electronic",
        energy: 0.4,
      },
      comedown,
      { hardLock: true },
    ),
    true,
  );
});

test("grunge world keeps Nirvana when only artist evidence exists", () => {
  const world = resolveWorldBoundary({
    sceneLock: resolveSceneLock({} as IntentState, "90s grunge dark cloudy night"),
    prompt: "90s grunge dark cloudy night",
  });
  assert.equal(world.hardLock, true);
  assert.equal(
    isTrackInWorld(
      {
        trackId: "n1",
        trackName: "Come As You Are",
        artistName: "Nirvana",
        genreFamily: "rock",
        energy: 0.7,
      },
      world,
      "rock",
    ),
    true,
  );
});

test("delivery API field aliases artist/name still reject Blondie from grunge", () => {
  const world = resolveWorldBoundary({
    sceneLock: resolveSceneLock({} as IntentState, "90s grunge dark cloudy night"),
    prompt: "90s grunge dark cloudy night",
  });
  const purified = hardRejectOffWorldTracks(
    [
      {
        id: "b1",
        name: "Call Me",
        artist: "Blondie",
        genreFamily: "rock",
        energy: 0.7,
      },
      {
        id: "n1",
        name: "Come As You Are",
        artist: "Nirvana",
        genreFamily: "rock",
        energy: 0.7,
      },
      {
        id: "k1",
        name: "Moving",
        artist: "Kate Bush",
        genreFamily: "rock",
        energy: 0.7,
      },
    ],
    world,
  );
  assert.deepEqual(
    purified.kept.map((t) => t.artist),
    ["Nirvana"],
  );
});

test("rainy highway rejects Queen / Highwaymen title bait", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "rainy highway driving" });
  assert.ok(profiles.some((p) => p.id === "rainy_drive_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Princes Of The Universe",
        artistName: "Queen",
        genreFamily: "rock",
        spotifyArtistGenres: ["classic rock", "glam rock"],
        energy: 0.68,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Highwayman",
        artistName: "The Highwaymen",
        genreFamily: "country",
        spotifyArtistGenres: ["country", "outlaw country"],
        energy: 0.61,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Rainy Dayz",
        artistName: "Raekwon",
        genreFamily: "hip_hop",
        spotifyArtistGenres: ["east coast hip hop", "rap"],
        energy: 0.54,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  for (const [artist, genres] of [
    ["Tiësto", ["edm", "trance", "electronic"]],
    ["Meat Loaf", ["classic rock", "arena rock"]],
    ["Joyner Lucas", ["hip hop", "rap"]],
  ] as const) {
    assert.equal(
      passesWorldIdentity(
        {
          trackName: "Hit",
          artistName: artist,
          genreFamily: "electronic",
          spotifyArtistGenres: [...genres],
          energy: 0.55,
        },
        profiles,
        { hardLock: true },
      ),
      false,
      `${artist} must not enter rainy drive`,
    );
  }
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Fake Empire",
        artistName: "The National",
        genreFamily: "indie",
        spotifyArtistGenres: ["indie rock", "chamber pop"],
        energy: 0.42,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("cozy rainy chill rejects DMX", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "cozy rainy night chill" });
  assert.ok(profiles.some((p) => p.id === "chill_rainy_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Where The Hood At",
        artistName: "DMX",
        genreFamily: "hip_hop",
        spotifyArtistGenres: ["east coast hip hop", "hardcore hip hop"],
        energy: 0.42,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Flightless Bird, American Mouth",
        artistName: "Iron & Wine",
        genreFamily: "folk",
        spotifyArtistGenres: ["indie folk", "chamber pop"],
        energy: 0.27,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("heavy lifting gym rejects Storm Queen / Craig David club bleed", () => {
  const world = resolveWorldBoundary({
    sceneLock: resolveSceneLock({} as IntentState, "heavy lifting gym pump aggressive"),
    prompt: "heavy lifting gym pump aggressive",
  });
  assert.equal(world.hardLock, true);
  assert.ok(
    world.lockAnchors.some((a) => a === "gym_rock_world" || a === "angry_rock_world"),
  );
  assert.equal(
    isTrackInWorld(
      {
        trackId: "s1",
        trackName: "Look Right Through",
        artistName: "Storm Queen",
        genreFamily: "electronic",
        spotifyArtistGenres: ["house", "uk garage"],
        energy: 0.85,
      },
      world,
      "electronic",
    ),
    false,
  );
  assert.equal(
    isTrackInWorld(
      {
        trackId: "a1",
        trackName: "T.N.T.",
        artistName: "AC/DC",
        genreFamily: "rock",
        spotifyArtistGenres: ["hard rock", "classic rock"],
        energy: 0.82,
      },
      world,
      "rock",
    ),
    true,
  );
});

test("70s disco rejects Black Sabbath", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "70s disco party dancefloor" });
  assert.ok(profiles.some((p) => p.id === "disco_party_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Rat Salad",
        artistName: "Black Sabbath",
        genreFamily: "metal",
        spotifyArtistGenres: ["metal", "hard rock"],
        energy: 0.91,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Gimme! Gimme! Gimme!",
        artistName: "ABBA",
        genreFamily: "pop",
        spotifyArtistGenres: ["disco", "europop"],
        energy: 0.6,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("deep focus rejects Olivia Rodrigo lyrical pop", () => {
  const profiles = worldIdentityProfilesForLock({
    prompt: "deep focus study session no distractions",
  });
  assert.ok(profiles.some((p) => p.id === "focus_study_world" || p.id === "ambient_world" || p.id === "lofi_world"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "ballad of a homeschooled girl",
        artistName: "Olivia Rodrigo",
        genreFamily: "pop",
        spotifyArtistGenres: ["pop", "singer-songwriter"],
        energy: 0.25,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  // Even if genres are mis-tagged ambient, low instrumentalness = lyrical distraction.
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "drivers license",
        artistName: "Unknown Soft Act",
        genreFamily: "electronic",
        spotifyArtistGenres: ["ambient", "focus"],
        energy: 0.22,
        instrumentalness: 0.02,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Says",
        artistName: "Nils Frahm",
        genreFamily: "classical",
        spotifyArtistGenres: ["modern classical", "ambient"],
        energy: 0.2,
        instrumentalness: 0.92,
      },
      profiles,
      { hardLock: true },
    ),
    true,
  );
});

test("90s neon rejects modern tekkno / French Montana", () => {
  const profiles = worldIdentityProfilesForLock({ prompt: "90s neon night drive" });
  assert.ok(profiles.some((p) => p.id === "neon_tek_drive"));
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "ilomilo tekkno",
        artistName: "TEKKNO",
        genreFamily: "electronic",
        spotifyArtistGenres: ["hard techno", "tekkno"],
        energy: 0.73,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "Unforgettable",
        artistName: "French Montana",
        genreFamily: "hip_hop",
        spotifyArtistGenres: ["hip hop", "rap"],
        energy: 0.71,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});

test("angry rock rejects Paramore ballad exceptions", () => {
  const profiles = worldIdentityProfilesForLock({
    prompt: "angry rock workout no slow songs",
  });
  assert.equal(
    passesWorldIdentity(
      {
        trackName: "The Only Exception",
        artistName: "Paramore",
        genreFamily: "rock",
        spotifyArtistGenres: ["pop punk", "alternative rock"],
        energy: 0.81,
      },
      profiles,
      { hardLock: true },
    ),
    false,
  );
});
