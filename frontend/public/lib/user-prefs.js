/** User preference persistence (localStorage). */

const KEYS = {
  mode: "kwalify-mode",
  length: "kwalify-length",
  familiarity: "kwalify-familiarity",
  discoveryMode: "kwalify-discovery-mode",
  onboardingDone: "kwalify-onboarding-done",
};

export function loadUserPrefs() {
  const out = {
    mode: "balanced",
    length: 40,
    familiarity: "balanced",
    discoveryMode: false,
    onboardingDone: false,
  };
  try {
    const mode = localStorage.getItem(KEYS.mode);
    if (mode === "strict" || mode === "balanced" || mode === "chaotic") out.mode = mode;
    const length = Number(localStorage.getItem(KEYS.length));
    if (length >= 20 && length <= 60 && length % 5 === 0) out.length = length;
    const familiarity = localStorage.getItem(KEYS.familiarity);
    if (familiarity === "safe" || familiarity === "balanced" || familiarity === "discovery") {
      out.familiarity = familiarity;
    }
    out.discoveryMode = localStorage.getItem(KEYS.discoveryMode) === "1";
    out.onboardingDone = localStorage.getItem(KEYS.onboardingDone) === "1";
  } catch { /* ignore */ }
  return out;
}

export function saveUserPref(key, value) {
  const map = {
    mode: KEYS.mode,
    length: KEYS.length,
    familiarity: KEYS.familiarity,
    discoveryMode: KEYS.discoveryMode,
    onboardingDone: KEYS.onboardingDone,
  };
  const storageKey = map[key];
  if (!storageKey) return;
  try {
    if (key === "discoveryMode" || key === "onboardingDone") {
      localStorage.setItem(storageKey, value ? "1" : "0");
    } else {
      localStorage.setItem(storageKey, String(value));
    }
  } catch { /* ignore */ }
}

export function markOnboardingDone() {
  saveUserPref("onboardingDone", true);
}
