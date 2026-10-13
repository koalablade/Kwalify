// Prompt-vs-cue matching for the world-understanding layer. A cue must start at a word boundary and
// end at one, or continue only with an inflection: "rain" matches "rain", "rainy", "raining" and
// "rains", but not "brain", "brainstorming", "train" or "rainbow". Multi-word cues ("in bed",
// "driving in the rain") keep matching as phrases. The rule only removes matches the old substring
// test made inside other words; it adds none ("drive" still does not match "driving").

const WORD_CHAR = /[a-z0-9]/;
const INFLECTION = /^(?:|s|es|y|ing|ed|d|er|ers|ly)$/;
// After a cue ending in "e": "drive" → "driver", "drivers", "driven". ("driving" drops the "e", and the
// knowledge data lists such forms as cues of their own.)
const E_INFLECTION = /^(?:r|rs|n)$/;

// Closed compounds that do mean their first word ("visiting my hometown" is about home). Spelled out
// so the boundary rule still keeps "rain" out of "brainstorming" and "home" out of "homecoming".
const COMPOUNDS: ReadonlyArray<[RegExp, string]> = [[/\bhometown(s?)\b/g, "home town$1"]];

let lastInput = "";
let lastExpanded = "";

// Callers match hundreds of cues against one prompt, so the last prompt is kept.
function preparedText(text: string): string {
  if (text !== lastInput) {
    lastInput = text;
    lastExpanded = COMPOUNDS.reduce((acc, [re, spelled]) => acc.replace(re, spelled), text.toLowerCase());
  }
  return lastExpanded;
}

// "night" compounds are still night: "midnight drive" is a night drive, "tonight", "overnight".
const NIGHT_COMPOUND_PREFIX = /(?:^|[^a-z0-9])(?:mid|to|over)$/;

function startsWord(text: string, idx: number, needle: string): boolean {
  if (!isWordChar(needle[0]) || !isWordChar(text[idx - 1])) return true;
  return needle.startsWith("night") && NIGHT_COMPOUND_PREFIX.test(text.slice(Math.max(0, idx - 5), idx));
}

function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORD_CHAR.test(ch);
}

function wordTail(text: string, from: number): string {
  let end = from;
  while (end < text.length && isWordChar(text[end])) end += 1;
  return text.slice(from, end);
}

function scan(text: string, needle: string, tailOk: (tail: string) => boolean): number {
  if (!needle) return -1;
  for (let idx = text.indexOf(needle); idx >= 0; idx = text.indexOf(needle, idx + 1)) {
    if (!startsWord(text, idx, needle)) continue;
    if (!isWordChar(needle[needle.length - 1]) || tailOk(wordTail(text, idx + needle.length))) return idx;
  }
  return -1;
}

/**
 * Index of the first whole-word (or inflected) occurrence of `cue` in `text` (case-insensitive), or -1.
 * The index is into the lowercased text with compounds spelled out; compare it only with other
 * indices from the same text.
 */
export function cueIndex(text: string, cue: string): number {
  const lower = preparedText(text);
  const needle = cue.toLowerCase().trim();
  const endsInE = needle.endsWith("e");
  return scan(lower, needle, (tail) => INFLECTION.test(tail) || (endsInE && E_INFLECTION.test(tail)));
}

export function containsCue(text: string, cue: string): boolean {
  return cueIndex(text, cue) >= 0;
}
