import assert from "node:assert/strict";
import test from "node:test";
import { classifyTrack } from "../lib/genre-taxonomy";
import { identityProfileForWorld, passesWorldIdentity } from "../core/editorial/world-identity-gate";

// A real Spotify tag the taxonomy did not know made the classifier fall back to audio features: a
// very acoustic doo-wop or chanson song became "deep acoustic folk" and passed the folk worlds'
// genre check ("reading a book" served The Flamingos; Sunday chill served Dalida).

// Audio features of The Flamingos, "I Only Have Eyes for You".
const acoustic = { energy: 0.313, valence: 0.303, danceability: 0.552, acousticness: 0.916, instrumentalness: 0.0017, speechiness: 0.03, tempo: 88 };

test("doo-wop and chanson tags classify by the tag, not the audio guess", () => {
  const doowop = classifyTrack({ trackName: "I Only Have Eyes for You", artistName: "The Flamingos", albumName: "Flamingo Serenade", spotifyArtistGenres: ["doo-wop"], ...acoustic });
  assert.equal(doowop.genreFamily, "soul");
  assert.equal(doowop.primarySubgenre, "doo_wop");
  const chanson = classifyTrack({ trackName: "Love In Portofino", artistName: "Dalida", albumName: "x", spotifyArtistGenres: ["variété française", "chanson"], ...acoustic });
  assert.equal(chanson.genreFamily, "world");
  assert.equal(chanson.primarySubgenre, "chanson");
});

test("folk worlds no longer accept them; real folk and untagged acoustic songs are unaffected", () => {
  const withClass = (t: Parameters<typeof classifyTrack>[0]) => {
    const c = classifyTrack(t);
    return { ...t, genreFamily: c.genreFamily, genrePrimary: c.genrePrimary, genres: c.subGenres };
  };
  const flamingos = withClass({ trackName: "I Only Have Eyes for You", artistName: "The Flamingos", albumName: "x", spotifyArtistGenres: ["doo-wop"], ...acoustic });
  const nickDrake = withClass({ trackName: "Place To Be", artistName: "Nick Drake", albumName: "Pink Moon", spotifyArtistGenres: ["folk", "singer-songwriter"], ...acoustic });
  // Untagged songs have only their audio to go on; that path is unchanged.
  const untagged = withClass({ trackName: "Demo", artistName: "Someone", albumName: "Demo", spotifyArtistGenres: [], ...acoustic });
  for (const world of ["rainy_reading_world", "sunday_chill_world"]) {
    const profile = [identityProfileForWorld(world)!];
    assert.equal(passesWorldIdentity(flamingos, profile, { hardLock: true }), false, world);
    assert.equal(passesWorldIdentity(nickDrake, profile, { hardLock: true }), true, world);
    assert.equal(passesWorldIdentity(untagged, profile, { hardLock: true }), true, world);
  }
});

test("existing tag routes are unchanged", () => {
  assert.equal(classifyTrack({ trackName: "x", artistName: "y", albumName: "z", spotifyArtistGenres: ["motown"] }).primarySubgenre, "motown");
  assert.equal(classifyTrack({ trackName: "x", artistName: "y", albumName: "z", spotifyArtistGenres: ["french pop"] }).genreFamily, "pop");
});
