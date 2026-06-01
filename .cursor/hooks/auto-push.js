#!/usr/bin/env node
/**
 * Cursor afterShellExecution hook — auto-push on commit.
 *
 * Fires after every shell command the agent runs. When the command is a
 * successful `git commit`, this script runs `git push` so that every agent
 * commit immediately lands on GitHub and triggers a Render auto-deploy.
 *
 * Input  (stdin): JSON with at minimum { command: string, exitCode: number }
 * Output (stdout): JSON (empty object = no effect on agent)
 */
"use strict";

const { execFileSync } = require("child_process");

let raw = "";
process.stdin.on("data", (chunk) => { raw += chunk; });
process.stdin.on("end", () => {
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}

  const command  = String(data.command  ?? "");
  const exitCode = Number(data.exitCode ?? 1);

  // Only act on a successful `git commit …` command.
  if (!/^git\s+commit/.test(command) || exitCode !== 0) {
    process.stdout.write("{}");
    process.exit(0);
  }

  try {
    // Run git push. stdio is fully redirected so the hook's own stdout (JSON)
    // is not polluted by git's progress output.
    execFileSync("git", ["push"], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });

    process.stdout.write(JSON.stringify({
      additional_context:
        "git push succeeded — commit is now on GitHub (koalablade/Kwalify · main). " +
        "Render will auto-deploy via the blueprint in render.yaml.",
    }));
  } catch (err) {
    const detail = (err.stderr || err.message || "unknown error").trim();
    process.stdout.write(JSON.stringify({
      additional_context:
        `git commit succeeded but git push failed: ${detail}. ` +
        "Run \`git push\` manually to trigger the Render deployment.",
    }));
  }

  process.exit(0);
});
