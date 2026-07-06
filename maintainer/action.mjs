// action.mjs — production entrypoint. Wires REAL dependencies from env and runs handlePullRequest
// for the current PR. This is what .github/workflows runs (or a small Node service invokes).
//
// It reads the PR from the GitHub Actions event payload (GITHUB_EVENT_PATH) and pulls every
// secret from env — NEVER hardcoded. If a required secret is missing it fails CLOSED (the gate
// throws, the status goes red, nothing merges).
//
//   Required env:
//     GITHUB_TOKEN or APP_INSTALLATION_TOKEN   GitHub write token (statuses/comments/merge)
//     GITHUB_REPOSITORY                          "owner/name" (Actions sets this automatically)
//     Z_MINT                                     $Z mint address        (Andy, at launch)
//     Z_THRESHOLD                                min uiAmount to pass    (Andy, from $ target)
//     HELIUS_RPC_URL                             Helius RPC incl. API key
//   Optional env:
//     SECOND_RPC_URL                             second provider (fail-closed agreement)
//     GATE_SIGNING_SECRET_KEY                    ed25519 secret to sign verdicts for the chain
//     LINKS_FILE                                 path to the links JSON (v1 stub; default below)
//     RECORD_FILE                                path to record.jsonl (default below)
//     REVIEW_MODEL                               model id for the real LLM judge (else stub judge)
//     LINK_URL                                   linking page URL (default link.societyz.xyz)
//     AUTO_MERGE                                 "1" to auto-merge greens (v1 default: human merges)

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { handlePullRequest } from "./index.mjs";
import { fileLinks } from "./links.mjs";
import { realGithub } from "./github.mjs";
import { jsonlRecord } from "./record.mjs";
import { run as gateRun } from "../skills/gate/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");

export function buildDepsFromEnv(env = process.env) {
  const token = env.APP_INSTALLATION_TOKEN || env.GITHUB_TOKEN;
  const repo = env.GITHUB_REPOSITORY;
  if (!token) throw new Error("no GitHub token (GITHUB_TOKEN or APP_INSTALLATION_TOKEN) — failing closed");
  if (!repo) throw new Error("GITHUB_REPOSITORY not set — failing closed");

  return {
    links: fileLinks(env.LINKS_FILE || join(HERE, "links.json")),
    gate: { run: gateRun },                       // the real gate skill (Helius, read-only)
    github: realGithub({ token, repo }),
    record: jsonlRecord(env.RECORD_FILE || join(HERE, "record.jsonl")),
    // review uses the default reviewPR (stub judge) unless you wire a real model client into
    // config.judge here. REVIEW_MODEL names the model; the actual client is intentionally not
    // bundled so no inference fires by accident. See review.mjs -> llmJudge.
    config: {
      repo,
      repoRoot: REPO_ROOT,
      LINK_URL: env.LINK_URL,
      autoMerge: env.AUTO_MERGE === "1",
      // gate reads these (via ../skills/gate loadConfig):
      Z_MINT: env.Z_MINT,
      Z_THRESHOLD: env.Z_THRESHOLD,
      HELIUS_RPC_URL: env.HELIUS_RPC_URL,
      SECOND_RPC_URL: env.SECOND_RPC_URL,
      GATE_SIGNING_SECRET_KEY: env.GATE_SIGNING_SECRET_KEY,
    },
  };
}

function loadPrFromEvent(env = process.env) {
  const path = env.GITHUB_EVENT_PATH;
  if (!path) throw new Error("GITHUB_EVENT_PATH not set — not running inside a GitHub event");
  const event = JSON.parse(readFileSync(path, "utf8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("event has no pull_request — wrong trigger");
  return pr;
}

export async function main(env = process.env) {
  const pr = loadPrFromEvent(env);
  const deps = buildDepsFromEnv(env);
  const result = await handlePullRequest(pr, deps);
  console.log(JSON.stringify({ pr: pr.number, ...result }, null, 2));
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("maintainer failed closed:", e.message);
    process.exit(1);
  });
}
