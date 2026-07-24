/**
 * 100 human-language prompts — natural wording, mixed difficulty.
 * Easy conversational → hard world locks / contradictions / thin niches.
 */
export type Human100Prompt = {
  id: string;
  prompt: string;
  mode: "strict" | "balanced" | "chaotic";
  length: number;
  difficulty: "easy" | "medium" | "hard" | "edge";
  family: string;
  /** Named genre/scene lock — library supply is the limiter, not world mush. */
  cohort?: "guided" | "vague";
};

function cohortForPrompt(p: Omit<Human100Prompt, "cohort">): "guided" | "vague" {
  if (p.difficulty === "hard") return "guided";
  if (p.difficulty === "edge" && p.family === "vague") return "vague";
  if (/\b(?:like |vibes but|Queens of the Stone Age|Phoebe Bridgers|ABBA|The Cure|Boards of Canada)\b/i.test(p.prompt)) {
    return "guided";
  }
  if (p.difficulty === "edge") return "vague";
  if (["walk", "mood", "chore", "vague"].includes(p.family) && p.difficulty === "easy") return "vague";
  if (p.id === "h100") return "guided";
  return p.difficulty === "medium" && /\b(?:grunge|goth|disco|metal|ukg|grime|shoegaze|britpop|jazz|latin)\b/i.test(p.prompt)
    ? "guided"
    : "vague";
}

export const HUMAN_100_PROMPTS: Human100Prompt[] = [
  // ── Easy conversational ──────────────────────────────────────────
  { id: "h01", prompt: "something chill for Sunday morning", mode: "balanced", length: 25, difficulty: "easy", family: "chill" },
  { id: "h02", prompt: "music for cooking dinner with friends", mode: "balanced", length: 25, difficulty: "easy", family: "social" },
  { id: "h03", prompt: "upbeat stuff for a morning walk", mode: "balanced", length: 20, difficulty: "easy", family: "walk" },
  { id: "h04", prompt: "late night winding down", mode: "balanced", length: 25, difficulty: "easy", family: "chill" },
  { id: "h05", prompt: "happy vibes only", mode: "balanced", length: 25, difficulty: "easy", family: "mood" },
  { id: "h06", prompt: "songs that feel like summer", mode: "balanced", length: 25, difficulty: "easy", family: "season" },
  { id: "h07", prompt: "background music while I clean the flat", mode: "balanced", length: 25, difficulty: "easy", family: "chore" },
  { id: "h08", prompt: "cozy evening on the sofa", mode: "balanced", length: 25, difficulty: "easy", family: "chill" },
  { id: "h09", prompt: "need energy for the gym", mode: "balanced", length: 25, difficulty: "easy", family: "gym" },
  { id: "h10", prompt: "driving home after work", mode: "balanced", length: 25, difficulty: "easy", family: "drive" },

  // ── Medium natural scenes ────────────────────────────────────────
  { id: "h11", prompt: "rainy afternoon reading by the window", mode: "balanced", length: 25, difficulty: "medium", family: "rain" },
  { id: "h12", prompt: "golden hour walk through the park", mode: "balanced", length: 25, difficulty: "medium", family: "walk" },
  { id: "h13", prompt: "pre drinks before we go out", mode: "balanced", length: 30, difficulty: "medium", family: "party" },
  { id: "h14", prompt: "coffee shop laptop session", mode: "balanced", length: 25, difficulty: "medium", family: "focus" },
  { id: "h15", prompt: "nostalgic 2000s throwback night", mode: "balanced", length: 30, difficulty: "medium", family: "nostalgia" },
  { id: "h16", prompt: "angry but productive workout", mode: "balanced", length: 25, difficulty: "medium", family: "gym" },
  { id: "h17", prompt: "soft songs for when you're a bit sad but okay", mode: "balanced", length: 25, difficulty: "medium", family: "mood" },
  { id: "h18", prompt: "friday night kitchen dance party", mode: "balanced", length: 30, difficulty: "medium", family: "party" },
  { id: "h19", prompt: "motorway at night headlights rain", mode: "balanced", length: 25, difficulty: "medium", family: "drive" },
  { id: "h20", prompt: "acoustic sunday no stress", mode: "balanced", length: 25, difficulty: "medium", family: "acoustic" },
  { id: "h21", prompt: "UK garage late drive home", mode: "strict", length: 25, difficulty: "medium", family: "uk" },
  { id: "h22", prompt: "indie rainy day in bed", mode: "balanced", length: 25, difficulty: "medium", family: "indie" },
  { id: "h23", prompt: "warm after-work unwind", mode: "balanced", length: 25, difficulty: "medium", family: "chill" },
  { id: "h24", prompt: "songs that sound like autumn leaves", mode: "balanced", length: 25, difficulty: "medium", family: "season" },
  { id: "h25", prompt: "hype for a night out starting now", mode: "balanced", length: 30, difficulty: "medium", family: "party" },
  { id: "h26", prompt: "quiet rage simmering", mode: "balanced", length: 25, difficulty: "medium", family: "mood" },
  { id: "h27", prompt: "beach sunset not too sleepy", mode: "balanced", length: 25, difficulty: "medium", family: "chill" },
  { id: "h28", prompt: "coding for three hours please no lyrics shouting", mode: "balanced", length: 30, difficulty: "medium", family: "focus" },
  { id: "h29", prompt: "90s car stereo windows down", mode: "balanced", length: 25, difficulty: "medium", family: "nostalgia" },
  { id: "h30", prompt: "lonely city walk at 1am", mode: "balanced", length: 25, difficulty: "medium", family: "night" },

  // ── Hard world / genre locks ─────────────────────────────────────
  { id: "h31", prompt: "90s grunge dark cloudy night", mode: "strict", length: 25, difficulty: "hard", family: "grunge" },
  { id: "h32", prompt: "goth but danceable", mode: "strict", length: 25, difficulty: "hard", family: "goth" },
  { id: "h33", prompt: "2000s pop punk gym workout", mode: "balanced", length: 30, difficulty: "hard", family: "pop_punk" },
  { id: "h34", prompt: "70s disco party dancefloor", mode: "strict", length: 30, difficulty: "hard", family: "disco" },
  { id: "h35", prompt: "heavy lifting gym pump aggressive", mode: "strict", length: 25, difficulty: "hard", family: "gym" },
  { id: "h36", prompt: "deep focus study session no distractions", mode: "balanced", length: 25, difficulty: "hard", family: "focus" },
  { id: "h37", prompt: "90s neon night drive", mode: "strict", length: 25, difficulty: "hard", family: "neon" },
  { id: "h38", prompt: "rainy highway night drive", mode: "strict", length: 25, difficulty: "hard", family: "rain_drive" },
  { id: "h39", prompt: "cozy rainy night chill", mode: "balanced", length: 25, difficulty: "hard", family: "rain_chill" },
  { id: "h40", prompt: "metal gym workout no ballads", mode: "strict", length: 25, difficulty: "hard", family: "metal" },
  { id: "h41", prompt: "classic rock evening drinks", mode: "strict", length: 25, difficulty: "hard", family: "classic_rock" },
  { id: "h42", prompt: "lofi study beats keep me in the zone", mode: "balanced", length: 30, difficulty: "hard", family: "lofi" },
  { id: "h43", prompt: "rave comedown bus home", mode: "balanced", length: 25, difficulty: "hard", family: "comedown" },
  { id: "h44", prompt: "high energy gaming session need hype", mode: "strict", length: 25, difficulty: "hard", family: "gym" },
  { id: "h45", prompt: "freshers pre drinks ukg grime", mode: "balanced", length: 30, difficulty: "hard", family: "uk" },
  { id: "h46", prompt: "90s r&b slow jams late night", mode: "strict", length: 25, difficulty: "hard", family: "rnb" },
  { id: "h47", prompt: "american red dirt country night", mode: "strict", length: 25, difficulty: "hard", family: "country" },
  { id: "h48", prompt: "post punk darkwave club", mode: "strict", length: 25, difficulty: "hard", family: "goth" },
  { id: "h49", prompt: "shoegaze dreamy wash rainy", mode: "strict", length: 25, difficulty: "hard", family: "shoegaze" },
  { id: "h50", prompt: "drum and bass gym sprint intervals", mode: "strict", length: 25, difficulty: "hard", family: "dnb" },

  // ── Human messy / vague / emotional ──────────────────────────────
  { id: "h51", prompt: "idk just make me feel something", mode: "balanced", length: 25, difficulty: "edge", family: "vague" },
  { id: "h52", prompt: "music for when you miss someone but you're fine", mode: "balanced", length: 25, difficulty: "edge", family: "mood" },
  { id: "h53", prompt: "main character walking through the city in autumn", mode: "balanced", length: 25, difficulty: "medium", family: "scene" },
  { id: "h54", prompt: "songs that slap but also hurt a little", mode: "balanced", length: 25, difficulty: "edge", family: "mood" },
  { id: "h55", prompt: "what would a cool older sibling put on", mode: "balanced", length: 25, difficulty: "edge", family: "vague" },
  { id: "h56", prompt: "crying in the club but make it tasteful", mode: "balanced", length: 25, difficulty: "edge", family: "party" },
  { id: "h57", prompt: "studying but my brain is fried", mode: "balanced", length: 25, difficulty: "medium", family: "focus" },
  { id: "h58", prompt: "playlist that feels like a film ending", mode: "balanced", length: 25, difficulty: "edge", family: "cinematic" },
  { id: "h59", prompt: "i just got dumped be gentle", mode: "balanced", length: 25, difficulty: "medium", family: "mood" },
  { id: "h60", prompt: "got a promotion let's gooo", mode: "balanced", length: 25, difficulty: "easy", family: "mood" },
  { id: "h61", prompt: "sunday reset no christmas please", mode: "balanced", length: 25, difficulty: "medium", family: "chill" },
  { id: "h62", prompt: "songs for assembling ikea furniture", mode: "balanced", length: 20, difficulty: "edge", family: "chore" },
  { id: "h63", prompt: "hospital waiting room at 3am weirdly calm", mode: "balanced", length: 20, difficulty: "edge", family: "ambient" },
  { id: "h64", prompt: "first date nerves but optimistic", mode: "balanced", length: 25, difficulty: "medium", family: "mood" },
  { id: "h65", prompt: "ex's birthday ignore them and lift", mode: "balanced", length: 25, difficulty: "edge", family: "gym" },
  { id: "h66", prompt: "train delayed again make it bearable", mode: "balanced", length: 20, difficulty: "medium", family: "commute" },
  { id: "h67", prompt: "house party ending people leaving slowly", mode: "balanced", length: 25, difficulty: "medium", family: "comedown" },
  { id: "h68", prompt: "writing essays at midnight with tea", mode: "balanced", length: 25, difficulty: "medium", family: "focus" },
  { id: "h69", prompt: "feel like the 2014 tumblr version of myself", mode: "balanced", length: 25, difficulty: "edge", family: "nostalgia" },
  { id: "h70", prompt: "road trip through wales rainy hills", mode: "balanced", length: 25, difficulty: "medium", family: "drive" },

  // ── Contradictions / traps ───────────────────────────────────────
  { id: "h71", prompt: "sleepy gym workout", mode: "balanced", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h72", prompt: "sad upbeat party songs", mode: "balanced", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h73", prompt: "chaotic chill evening somehow", mode: "chaotic", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h74", prompt: "aggressive focus music no distractions", mode: "chaotic", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h75", prompt: "christmas vibes but it's july no christmas", mode: "balanced", length: 20, difficulty: "edge", family: "negation" },
  { id: "h76", prompt: "party but make it soft and intimate", mode: "balanced", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h77", prompt: "workout music that isn't aggressive", mode: "balanced", length: 25, difficulty: "medium", family: "gym" },
  { id: "h78", prompt: "danceable but melancholy", mode: "balanced", length: 25, difficulty: "edge", family: "contradiction" },
  { id: "h79", prompt: "loud quiet rage", mode: "balanced", length: 20, difficulty: "edge", family: "contradiction" },
  { id: "h80", prompt: "instrumental only but still emotional", mode: "strict", length: 25, difficulty: "hard", family: "focus" },

  // ── More human niches ────────────────────────────────────────────
  { id: "h81", prompt: "can you do something like Phoebe Bridgers rainy", mode: "balanced", length: 25, difficulty: "medium", family: "indie" },
  { id: "h82", prompt: "Queens of the Stone Age energy for the weights", mode: "balanced", length: 25, difficulty: "medium", family: "gym" },
  { id: "h83", prompt: "The Cure vibes but for dancing", mode: "strict", length: 25, difficulty: "hard", family: "goth" },
  { id: "h84", prompt: "ABBA and disco classics for a dinner party", mode: "strict", length: 25, difficulty: "hard", family: "disco" },
  { id: "h85", prompt: "Boards of Canada style floaty focus", mode: "balanced", length: 25, difficulty: "hard", family: "ambient" },
  { id: "h86", prompt: "early 2010s indie sleaze night", mode: "balanced", length: 25, difficulty: "medium", family: "indie" },
  { id: "h87", prompt: "britpop sunny afternoon", mode: "balanced", length: 25, difficulty: "medium", family: "britpop" },
  { id: "h88", prompt: "soulful sunday morning gospel adjacent", mode: "balanced", length: 25, difficulty: "hard", family: "soul" },
  { id: "h89", prompt: "hyperpop chaos for cleaning", mode: "chaotic", length: 20, difficulty: "edge", family: "hyperpop" },
  { id: "h90", prompt: "jazz for reading not dinner jazz cliché", mode: "balanced", length: 25, difficulty: "hard", family: "jazz" },
  { id: "h91", prompt: "synthwave night run", mode: "strict", length: 25, difficulty: "hard", family: "neon" },
  { id: "h92", prompt: "folk camping under stars", mode: "balanced", length: 25, difficulty: "medium", family: "folk" },
  { id: "h93", prompt: "post rave taxi home soft electronic", mode: "balanced", length: 25, difficulty: "hard", family: "comedown" },
  { id: "h94", prompt: "emo but grown up not cringe", mode: "balanced", length: 25, difficulty: "medium", family: "emo" },
  { id: "h95", prompt: "latin summer rooftop drinks", mode: "balanced", length: 25, difficulty: "hard", family: "latin" },
  { id: "h96", prompt: "garage workshop fixing my car bluesy rock", mode: "balanced", length: 25, difficulty: "medium", family: "garage" },
  { id: "h97", prompt: "exam week survival playlist", mode: "balanced", length: 30, difficulty: "medium", family: "focus" },
  { id: "h98", prompt: "songs my dad would secretly like", mode: "balanced", length: 25, difficulty: "edge", family: "vague" },
  { id: "h99", prompt: "make it feel expensive and cinematic", mode: "balanced", length: 25, difficulty: "edge", family: "cinematic" },
  { id: "h100", prompt: "one world only — dreamy indie rain no random rock dad songs", mode: "strict", length: 25, difficulty: "hard", family: "indie" },
];

for (const row of HUMAN_100_PROMPTS) {
  row.cohort = cohortForPrompt(row);
}

if (HUMAN_100_PROMPTS.length !== 100) {
  throw new Error(`Expected 100 prompts, got ${HUMAN_100_PROMPTS.length}`);
}
