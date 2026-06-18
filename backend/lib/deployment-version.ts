/** Git commit / deploy revision exposed for ops smoke tests. */
export function deploymentVersion(): string {
  return process.env["RENDER_GIT_COMMIT"]?.trim() ||
    process.env["GIT_COMMIT"]?.trim() ||
    process.env["COMMIT_SHA"]?.trim() ||
    process.env["SOURCE_VERSION"]?.trim() ||
    "unknown";
}
