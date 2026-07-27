/** User-facing copy — cinematic brand voice */
export const COPY = {
  eyebrow: "Your music · your moments",
  headline: "What does this moment sound like?",
  subhead: "Describe a moment. Kwalify finds the soundtrack hidden inside your favourite songs.",
  landingPromise: "Turn the moments of your life into soundtracks from the music you already love.",
  placeholder: "Driving home at 2am after a life-changing conversation…",
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
  { emoji: "🌧", label: "Rainy Sunday morning", prompt: "Rainy Sunday morning, slow and reflective" },
  { emoji: "🚗", label: "Empty motorway at midnight", prompt: "Empty motorway at midnight, rain on the windscreen" },
  { emoji: "🌅", label: "Summer memories", prompt: "Summer 2016 — windows down, nowhere to be" },
  { emoji: "💔", label: "After goodbye", prompt: "After goodbye — driving home alone at 2am" },
  { emoji: "🎮", label: "Childhood nostalgia", prompt: "Childhood nostalgia — songs that feel like another life" },
];

export function heroChipsHtml({ attr = "data-hero-prompt", escFn }) {
  return HERO_PROMPTS.map(({ emoji, label, prompt }) =>
    `<button type="button" class="hero-chip hero-chip--emoji" ${attr}="${escFn(prompt)}" title="${escFn(prompt)}">${emoji} ${escFn(label)}</button>`,
  ).join("");
}
