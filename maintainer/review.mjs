// review — the maintainer-agent review pass.
//
// After the holder-gate passes, the maintainer agent does a lightweight review of the PR:
//   1. summarize the diff,
//   2. run the touched skill's smoke.mjs if present (proves the code actually works),
//   3. return a verdict { pass, verdict, summary, smoke }.
//
// The LLM call is PLUGGABLE. `reviewPR` takes a `judge` function so tests get a deterministic
// verdict and production gets a real model. The default export is the deterministic stub; the
// real judge (where an actual LLM call goes) is marked clearly and never invoked in tests.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

// Run a skill folder's smoke test in a child process. Deterministic, no keys (per SKILL_SPEC).
// Returns { ran, ok, output }. Injectable via deps for tests (see makeReview).
export function runSmoke(skillDir, { runner } = {}) {
  const smokePath = join(skillDir, "smoke.mjs");
  if (!existsSync(smokePath)) return { ran: false, ok: true, output: "no smoke.mjs (skipped)" };
  const exec = runner || defaultRunner;
  const { status, output } = exec(smokePath);
  return { ran: true, ok: status === 0, output };
}

function defaultRunner(smokePath) {
  const r = spawnSync(process.execPath, [smokePath], { encoding: "utf8", timeout: 60_000 });
  return { status: r.status ?? 1, output: `${r.stdout || ""}${r.stderr || ""}`.trim() };
}

// Compact, deterministic diff summary the judge (or a human) reads. Pure function of the PR.
export function summarizeDiff(pr) {
  const files = pr.files || [];
  const adds = files.reduce((s, f) => s + (f.additions || 0), 0);
  const dels = files.reduce((s, f) => s + (f.deletions || 0), 0);
  const skillDirs = [...new Set(files.map((f) => f.filename).filter((p) => p.startsWith("skills/")).map((p) => p.split("/").slice(0, 2).join("/")))];
  return {
    files: files.length,
    additions: adds,
    deletions: dels,
    touched_skills: skillDirs,
    title: pr.title || "",
  };
}

// ---- The pluggable judge ----------------------------------------------------------------------
// A judge is:  async (context) -> { pass: boolean, verdict: string }
// context = { summary, smoke, pr }. Keep judges pure w.r.t. their input so verdicts are auditable.

// STUB judge (default in tests & when no model is configured): deterministic, no network.
// Rule: pass iff the smoke test passed (or there was none) AND the PR touches exactly one skill
// folder (the "one skill per PR" rule from CONTRIBUTING.md). No LLM, fully reproducible.
export function stubJudge(context) {
  const { summary, smoke } = context;
  const oneSkill = summary.touched_skills.length === 1;
  const smokeOk = smoke.ok;
  const pass = smokeOk && oneSkill;
  const reasons = [];
  reasons.push(smokeOk ? "smoke passed" : "smoke FAILED");
  reasons.push(oneSkill ? "one skill touched" : `expected 1 skill folder, saw ${summary.touched_skills.length}`);
  return { pass, verdict: `${pass ? "APPROVE" : "REQUEST_CHANGES"}: ${reasons.join("; ")}` };
}

// REAL judge (where the LLM call goes). Not called in tests. Reads REVIEW_MODEL from env. Left as
// a documented stub so no live inference happens by accident. Wire your model client here; keep
// the (context) -> { pass, verdict } contract so it drops into reviewPR unchanged.
export function llmJudge({ model, callModel } = {}) {
  return async function (context) {
    if (!callModel) {
      throw new Error(
        "llmJudge has no callModel — inject a model client (e.g. OpenRouter/Crest) that takes " +
          "the review prompt and returns { pass, verdict }. Model id from REVIEW_MODEL env."
      );
    }
    // Real path: build a prompt from context.summary + context.smoke, call the model, parse a
    // strict APPROVE/REQUEST_CHANGES verdict. Fail closed (pass:false) on any parse/timeout error.
    return callModel({ model, context });
  };
}

// reviewPR: run smoke for each touched skill, summarize, ask the judge. Fail closed on any error.
export async function reviewPR(pr, { judge = stubJudge, runner, repoRoot = "." } = {}) {
  const summary = summarizeDiff(pr);
  // Run smoke for every touched skill; overall smoke ok only if all ran clean.
  const smokeRuns = summary.touched_skills.map((dir) => ({
    dir,
    ...runSmoke(join(repoRoot, dir), { runner }),
  }));
  const smoke = {
    ok: smokeRuns.every((r) => r.ok),
    runs: smokeRuns,
  };
  let decision;
  try {
    decision = await judge({ summary, smoke, pr });
  } catch (e) {
    decision = { pass: false, verdict: `review error (fail closed): ${e.message}` };
  }
  return {
    pass: !!decision.pass,
    verdict: decision.verdict,
    summary,
    smoke,
  };
}
