/** User-facing copy — cinematic brand voice */
export const COPY = {
  eyebrow: "Your music · your moments",
  headline: "Tell us a memory, a feeling, or a place.",
  subhead: "Describe a moment — we'll find the soundtrack hiding in songs you already love.",
  landingPromise: "Turn the moments of your life into soundtracks from the music you already love.",
  placeholder: "Rain on the windscreen, nowhere to be…",
  cta: {
    create: "Create soundtrack",
    connect: "Connect your soundtrack",
    playSpotify: "Play on Spotify",
  },
  connectTrust: "We don't replace your taste. We use it.",
  connectSub: "Kwalify uses your favourite songs to understand your taste.",
  sync: {
    active: "Rediscovering your library…",
    finding: "Finding forgotten favourites…",
    ready: (n) => `${n.toLocaleString()} songs in your history`,
  },
  generation: {
    eyebrow: "Creating your soundtrack",
    timingHint: "Usually takes 1–2 minutes — we're searching your library and shaping the arc.",
    syncFirstVisit: "First step: we sync your Spotify liked songs so playlists come from music you already know.",
    momentFeedback: {
      prompt: "Did this capture your moment?",
      captured: "Yes — captured it",
      missed: "Not quite",
      thanks: "Thanks — that helps us learn.",
    },
    stages: [
      "Searching your memories…",
      "Finding forgotten favourites…",
      "Building the emotional arc…",
      "Creating your soundtrack…",
      "Almost there…",
    ],
    partial: "First glimpses from your library…",
    saving: "Saving your soundtrack…",
  },
  gallery: {
    title: "Your life in music",
    sub: "A personal archive of the moments you've turned into soundtracks.",
    chapterHint: "Grouped by season — Summer 2026, Winter 2026, and the chapters of your year.",
    empty: "No moments captured yet — describe your first.",
    noMatch: "No memories match that search.",
  },
  activity: {
    title: "Recent moments",
    empty: "Your story starts with one moment — create your first soundtrack.",
    viewDiary: "View your diary →",
  },
  result: {
    partialHonest: (n, requested) =>
      `${n} tracks from your library that truly fit — we won't pad with filler${requested && n < requested ? ` (you asked for ${requested})` : ""}.`,
    referenceHint: "Reference (if you need help):",
    eyebrow: "YOUR SOUNDTRACK",
    moment: "THE MOMENT",
    journey: "THE JOURNEY",
    whyFits: "WHY THIS FITS",
    soundtrack: "THE SOUNDTRACK",
    shape: "SHAPE THIS SOUNDTRACK",
    otherMoments: "OTHER MOMENTS",
    seeHowBuilt: "See how this was built",
    openSpotify: "OPEN IN SPOTIFY",
    share: "Share",
    copyLink: "Copy link",
    songs: (n) => `${n} SONG${n === 1 ? "" : "S"}`,
  },
  settings: {
    title: "Fine-tune your taste",
    sub: "Advanced controls for how Kwalify reads your library.",
  },
};

export const HERO_PROMPTS = [
  { emoji: "🌧", label: "Rain on the windscreen", prompt: "Empty motorway at midnight, rain on the windscreen" },
  { emoji: "🚗", label: "Parked up after work", prompt: "Just parked up, knackered, don't want to go inside yet" },
  { emoji: "☕", label: "Sunday cuppa quiet", prompt: "Rainy Sunday morning with a cuppa, slow and reflective" },
  { emoji: "🌅", label: "Summer memories", prompt: "Summer 2016 — windows down, nowhere to be" },
  { emoji: "🎉", label: "After the party", prompt: "After the party — everyone went home, house feels quiet" },
  { emoji: "📸", label: "Old photos", prompt: "Looking through old photos, bittersweet and nostalgic" },
];

export function heroChipsHtml({ attr = "data-hero-prompt", escFn }) {
  return HERO_PROMPTS.map(({ emoji, label, prompt }) =>
    `<button type="button" class="hero-chip hero-chip--emoji" ${attr}="${escFn(prompt)}" title="${escFn(prompt)}">${emoji} ${escFn(label)}</button>`,
  ).join("");
}
