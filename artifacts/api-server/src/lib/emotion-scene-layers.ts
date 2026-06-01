/**
 * Layered scene detection — time, place, atmosphere, and motion are resolved
 * independently so "10am petrol station in a city" ≠ "2am petrol station in a city".
 */

export interface LayeredSceneContext {
  environment: string | null;
  timeOfDay: string | null;
  motionState: string | null;
  intensityBoost: number;
}

type ScoredMatch = { value: string; score: number };

function hourToTimeOfDay(h24: number): string {
  if (h24 >= 0 && h24 < 5) return "late_night";
  if (h24 < 12) return "morning";
  if (h24 < 17) return "afternoon";
  if (h24 < 21) return "evening";
  return "night";
}

/** Clock times and phrases — highest score wins (not first-match). */
export function detectTimeOfDay(text: string): string | null {
  const lower = text.toLowerCase();
  const candidates: ScoredMatch[] = [];

  const clockRe = /\b(\d{1,2})\s*(am|pm)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = clockRe.exec(lower)) !== null) {
    let hour = parseInt(m[1]!, 10);
    const ampm = m[2]!.toLowerCase();
    if (ampm === "pm" && hour !== 12) hour += 12;
    if (ampm === "am" && hour === 12) hour = 0;
    if (hour === 12 && ampm === "pm") hour = 12;
    candidates.push({ value: hourToTimeOfDay(hour), score: 95 });
  }

  const phraseRules: Array<{ pattern: RegExp; value: string; score: number }> = [
    { pattern: /\blate night\b|\bafter midnight\b|\bdead of night\b|\bdeep night\b/i, value: "late_night", score: 85 },
    { pattern: /\b2\s*am\b|\b3\s*am\b|\b4\s*am\b|\b1\s*am\b/i, value: "late_night", score: 90 },
    { pattern: /\bmidnight\b|\bwitching hour\b/i, value: "late_night", score: 88 },
    { pattern: /\bsunrise\b|\bdawn\b|\bpre-?dawn\b|\bearly morning\b|\bweekend morning\b/i, value: "morning", score: 82 },
    { pattern: /\bgolden hour\b/i, value: "evening", score: 86 },
    { pattern: /\bmorning commute\b|\brush hour\b/i, value: "morning", score: 84 },
    { pattern: /\blunchtime\b|\blunch break\b/i, value: "afternoon", score: 80 },
    { pattern: /\bafternoon slump\b/i, value: "afternoon", score: 82 },
    { pattern: /\bafter work\b|\bevening unwind\b/i, value: "evening", score: 83 },
    { pattern: /\blate evening\b/i, value: "evening", score: 81 },
    { pattern: /\bfriday afternoon\b/i, value: "afternoon", score: 80 },
    { pattern: /\bsunday evening\b|\bsunday night\b/i, value: "evening", score: 82 },
    { pattern: /\bfirst day of spring\b/i, value: "morning", score: 75 },
    { pattern: /\b5\s*am\b|\b6\s*am\b|\b7\s*am\b|\b8\s*am\b|\brush hour\b/i, value: "morning", score: 88 },
    { pattern: /\b9\s*am\b|\b10\s*am\b|\b11\s*am\b|\bmid-?morning\b/i, value: "morning", score: 90 },
    { pattern: /\bnoon\b|\bmidday\b|\b1\s*pm\b|\b2\s*pm\b|\b3\s*pm\b|\blunch\b/i, value: "afternoon", score: 88 },
    { pattern: /\bafternoon\b|\bmid-?afternoon\b/i, value: "afternoon", score: 75 },
    { pattern: /\bgolden hour\b|\bsunset\b|\bdusk\b|\btwilight\b|\bblue hour\b/i, value: "evening", score: 85 },
    { pattern: /\b5\s*pm\b|\b6\s*pm\b|\bafter work\b|\bevening\b/i, value: "evening", score: 80 },
    { pattern: /\b9\s*pm\b|\b10\s*pm\b|\b11\s*pm\b/i, value: "night", score: 88 },
    { pattern: /\bnight out\b|\bfriday night\b|\bsaturday night\b/i, value: "night", score: 78 },
    { pattern: /\bnight\b|\bnight time\b/i, value: "night", score: 55 },
    { pattern: /\bmorning\b/i, value: "morning", score: 60 },
    { pattern: /\bweekend morning\b|\bsunday morning\b|\bsaturday morning\b/i, value: "morning", score: 82 },
    { pattern: /\bsunday afternoon\b|\blazy afternoon\b/i, value: "afternoon", score: 80 },
  ];

  for (const { pattern, value, score } of phraseRules) {
    if (pattern.test(lower)) candidates.push({ value, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.value;
}

/** Weather/atmosphere beats generic "city". */
export function detectEnvironment(text: string): string | null {
  const lower = text.toLowerCase();
  const candidates: ScoredMatch[] = [];

  const rules: Array<{ pattern: RegExp; value: string; score: number }> = [
    { pattern: /\blight rain\b|\bsoft rain\b|\bdrizzle\b/i, value: "rainy", score: 88 },
    { pattern: /\bheavy rain\b|\bpouring\b|\btorrential\b/i, value: "rainy", score: 92 },
    { pattern: /\brainy?\b|\brain(fall)?\b|\bstorm\b|\bthunderstorm\b|\bthunder\b/i, value: "rainy", score: 90 },
    { pattern: /\bfoggy\b|\bfog\b|\bmisty\b|\bmist\b|\bhazy\b/i, value: "rainy", score: 85 },
    { pattern: /\bsnowfall\b|\bfirst snow\b|\bsnow\b|\bblizzard\b|\bfrost\b/i, value: "winter", score: 90 },
    { pattern: /\bovercast\b/i, value: "rainy", score: 70 },
    { pattern: /\bsun after rain\b/i, value: "coastal", score: 72 },
    { pattern: /\bsummer heat\b|\bheatwave\b/i, value: "coastal", score: 68 },
    { pattern: /\bcold morning\b/i, value: "winter", score: 75 },
    { pattern: /\bwindy coast\b/i, value: "coastal", score: 78 },
    { pattern: /\bneon\b/i, value: "urban", score: 72 },
    { pattern: /\bbeach\b|\bocean\b|\bsea\b|\bcoast\b|\bwaves?\b|\bharbour\b|\bharbor\b/i, value: "coastal", score: 75 },
    { pattern: /\bforest\b|\bwoods\b|\btrail\b|\bhike\b|\bmountain\b|\bsummit\b/i, value: "nature", score: 72 },
    { pattern: /\bpetrol station\b|\bgas station\b|\bforecourt\b|\bservice station\b/i, value: "urban", score: 78 },
    { pattern: /\blaundromat\b|\blaundrette\b/i, value: "urban", score: 70 },
    { pattern: /\blibrary\b|\bcampus\b|\bclassroom\b/i, value: "library", score: 75 },
    { pattern: /\boffice\b|\bworkplace\b|\bcubicle\b/i, value: "office", score: 75 },
    { pattern: /\bgym\b|\bfitness\b|\bworkout\b/i, value: "gym", score: 75 },
    { pattern: /\bclub\b|\bnightclub\b|\bdance floor\b/i, value: "social_indoor", score: 72 },
    { pattern: /\bcafe\b|\bcoffee shop\b|\bbar\b|\brestaurant\b/i, value: "social_indoor", score: 68 },
    { pattern: /\btrain\b|\bsubway\b|\bmetro\b|\bunderground\b|\bairport\b|\bplatform\b|\bterminal\b|\bbus\b/i, value: "transit", score: 72 },
    { pattern: /\bmountains?\b|\brooftop\b|\bpark\b|\briver\b/i, value: "nature", score: 70 },
    { pattern: /\bpub\b|\bbar\b|\bclub\b|\bnightclub\b/i, value: "social_indoor", score: 74 },
    { pattern: /\bbedroom\b|\bkitchen\b|\bliving room\b|\bhome\b|\bindoors?\b/i, value: "indoor", score: 65 },
    { pattern: /\bcity\b|\burban\b|\bdowntown\b|\bstreet\b|\bskyline\b/i, value: "urban", score: 45 },
    { pattern: /\bsunny\b|\bsunshine\b|\bblue sky\b/i, value: "coastal", score: 50 },
  ];

  for (const { pattern, value, score } of rules) {
    if (pattern.test(lower)) candidates.push({ value, score });
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]!.value;
}

export function detectMotionState(text: string): string | null {
  const lower = text.toLowerCase();
  if (/\brun(ning)?\b|\bjogging\b/i.test(lower)) return "running";
  if (/\bdriving\b|\bhighway\b|\bmotorway\b|\bcommute\b|\bcar\b|\btaxi\b/i.test(lower)) return "driving";
  if (/\bwalk(ing)?\b|\bstroll\b|\bwander(ing)?\b|\bexplor(e|ing)\b/i.test(lower)) return "walking";
  if (/\bcycl(ing|e)\b|\brun(ning)?\b|\bjogging\b/i.test(lower)) return "running";
  if (/\btrain\b|\bbus\b|\bplane\b|\bflight\b|\bferry\b|\bcommut(e|ing)\b/i.test(lower)) return "transit";
  if (/\bsail(ing)?\b|\bflying\b/i.test(lower)) return "transit";
  return null;
}

export function detectLayeredScene(text: string): LayeredSceneContext {
  const ctx: LayeredSceneContext = {
    environment: detectEnvironment(text),
    timeOfDay: detectTimeOfDay(text),
    motionState: detectMotionState(text),
    intensityBoost: 0,
  };

  if (ctx.motionState === "running") ctx.intensityBoost = 0.15;
  else if (ctx.motionState === "driving") ctx.intensityBoost = 0.08;

  return ctx;
}

/** Does this matched keyword phrase explicitly mention time? */
export function matchedTermImpliesTime(term: string): boolean {
  return /\b\d{1,2}\s*(?:am|pm)\b|midnight|late night|early morning|morning|afternoon|evening|night|2\s*am|3\s*am|sunrise|sunset|golden hour|dusk|dawn/i.test(
    term
  );
}

export function matchedTermImpliesPlace(term: string): boolean {
  return /\bstation|city|beach|forest|office|gym|cafe|home|bedroom|highway|train|airport|club|library|garden|kitchen|urban|coast|rain|snow|fog/i.test(
    term
  );
}

export type KeywordLayer = "time" | "place" | "atmosphere" | "emotion" | "era" | "compound";

export function inferKeywordLayer(
  matchedTerm: string,
  opts: { artistOrGenreCue?: boolean; hasSceneHints?: boolean }
): KeywordLayer {
  if (opts.artistOrGenreCue || /\b\d0s\b|\bsixties\b|\beighties\b|\bnineties\b|\b19\d{2}s?\b/i.test(matchedTerm)) {
    return "era";
  }
  if (matchedTermImpliesTime(matchedTerm) && matchedTermImpliesPlace(matchedTerm)) return "compound";
  if (matchedTermImpliesTime(matchedTerm)) return "time";
  if (/\brain|snow|fog|storm|sunny|cloudy|humid|wind/i.test(matchedTerm)) return "atmosphere";
  if (matchedTermImpliesPlace(matchedTerm) || opts.hasSceneHints) return "place";
  return "emotion";
}

export const KEYWORD_LAYER_LIMITS: Record<KeywordLayer, number> = {
  time: 3,
  place: 4,
  atmosphere: 3,
  emotion: 8,
  era: 2,
  compound: 2,
};
