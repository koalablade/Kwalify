// Prompt-identity words matched against a song's own text (title, album, genre tags).

export function normalizeUniversalIdentityTerm(value: string): string {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** Whole words / phrases only: a substring match let "rain" fit "Insane in the Brain". */
export function identityTextMatcher(normalizedText: string): (term: string) => boolean {
  const padded = ` ${normalizedText} `;
  return (term) => padded.includes(` ${term} `);
}
