/** Single-flight session snapshot hydration. */
import type { GenerateSessionSnapshot } from "./generation-types";

const sessionHydrationFlights = new Map<
  string,
  Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean }>
>();

export async function runSessionHydrationSingleFlight(
  key: string,
  loader: () => Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean }>,
): Promise<{ snapshot: GenerateSessionSnapshot; dbReadOccurred: boolean; shared: boolean }> {
  const existing = sessionHydrationFlights.get(key);
  if (existing) return { ...(await existing), shared: true };
  const flight = loader().finally(() => {
    sessionHydrationFlights.delete(key);
  });
  sessionHydrationFlights.set(key, flight);
  return { ...(await flight), shared: false };
}
