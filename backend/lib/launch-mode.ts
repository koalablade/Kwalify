/** Production launch snapshot — minimal API footprint when LAUNCH_MODE=true. */
export function isLaunchMode(): boolean {
  return process.env["LAUNCH_MODE"] === "true";
}
