import { readFileSync } from "node:fs";
import {
  PLAYLIST_EVAL_PROMPTS,
  auditPlaylistAgainstPrompt,
  type PlaylistEvalTrack,
} from "../lib/playlist-quality-eval";

type EvalFixture = {
  promptId: string;
  tracks: PlaylistEvalTrack[];
};

function usage(): never {
  console.error("Usage: node backend/dist/scripts/playlist-quality-eval.js --fixtures path/to/fixtures.json");
  console.error("Fixture shape: [{ \"promptId\": \"country-red-dirt\", \"tracks\": [...] }]");
  process.exit(2);
}

function fixturePathFromArgs(args: string[]): string {
  const idx = args.indexOf("--fixtures");
  const value = idx >= 0 ? args[idx + 1] : process.env.PLAYLIST_EVAL_FIXTURES;
  if (!value) usage();
  return value;
}

function asFixtures(raw: unknown): EvalFixture[] {
  if (!Array.isArray(raw)) {
    throw new Error("Eval fixtures must be an array");
  }
  return raw.map((item, index) => {
    const row = item as Partial<EvalFixture>;
    if (typeof row.promptId !== "string" || !Array.isArray(row.tracks)) {
      throw new Error(`Invalid fixture at index ${index}`);
    }
    return { promptId: row.promptId, tracks: row.tracks };
  });
}

function main(): void {
  const fixturePath = fixturePathFromArgs(process.argv.slice(2));
  const fixtures = asFixtures(JSON.parse(readFileSync(fixturePath, "utf8")));
  const promptsById = new Map(PLAYLIST_EVAL_PROMPTS.map((prompt) => [prompt.id, prompt]));
  const results = fixtures.map((fixture) => {
    const prompt = promptsById.get(fixture.promptId);
    if (!prompt) {
      throw new Error(`Unknown eval prompt id: ${fixture.promptId}`);
    }
    return auditPlaylistAgainstPrompt(prompt, fixture.tracks);
  });
  const failed = results.filter((result) => result["pass"] !== true);
  console.log(JSON.stringify({ pass: failed.length === 0, results }, null, 2));
  if (failed.length > 0) process.exit(1);
}

main();
