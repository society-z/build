// maintainer — the Society Z merge bot.
//
// On a pull request it:
//   1. resolves the PR author's linked Solana wallet (links table, SIWS-proven),
//   2. calls the `gate` skill to check the wallet holds >= threshold $Z (Helius, read-only),
//      and posts a `society-z/holder-gate` commit status (PASS/FAIL) + a helpful comment,
//   3. runs a lightweight AI review pass (summarize diff + run smoke + pluggable judge),
//   4. if holder-gate PASSES and review passes, MERGES the PR and appends a witnessed record,
//   5. on FAIL, does not merge; comments the reason + the link-your-wallet URL.
//
// The whole thing is dependency-injected (deps) so it runs end-to-end against mocks in tests and
// against real Helius/GitHub in production with the exact same code path. See action.mjs for the
// production wiring and test/e2e.test.mjs for the mocked wiring.
//
// deps = {
//   links:  { getLink(githubId) -> Link|null }            (links.mjs)
//   gate:   { run({wallet, pr, config}) -> verdict }        (../skills/gate/index.mjs)
//   github: { setStatus, comment, addLabel, getDiff, merge } (github.mjs)
//   review: { reviewPR(pr, opts) -> {pass, verdict, ...} }   (review.mjs)
//   record: { append(entry) -> {..., hash} }                (record.mjs)
//   config: { Z_MINT, Z_THRESHOLD, ... , LINK_URL, autoMerge } (env-derived)
// }

import { reviewPR as defaultReviewPR } from "./review.mjs";
import { STATUS_CONTEXT } from "./github.mjs";

const DEFAULT_LINK_URL = "https://link.societyz.xyz";

function prRef(pr, repo) {
  return `${repo || pr.base?.repo?.full_name || "societyz/core"}#${pr.number}`;
}

// A small result object so callers (and tests) can assert what happened without scraping logs.
function outcome(fields) {
  return { merged: false, gate_pass: false, review_pass: false, reason: "", ...fields };
}

export async function handlePullRequest(pr, deps) {
  const { links, gate, github, record, config = {} } = deps;
  const review = deps.review || { reviewPR: (p, o) => defaultReviewPR(p, o) };
  const repo = config.repo;
  const ref = prRef(pr, repo);
  const headSha = pr.head?.sha;
  const linkUrl = config.LINK_URL || DEFAULT_LINK_URL;

  // --- 1. Resolve the author's linked wallet -------------------------------------------------
  // pr.user.id is the GitHub-VERIFIED numeric author id, never a self-typed value.
  const author = pr.user || {};
  const link = await links.getLink(author.id);
  if (!link) {
    const msg = `No linked wallet for @${author.login || author.id}. Open PRs freely — to be *merged*, link your $Z wallet: ${linkUrl}`;
    await github.setStatus({ sha: headSha, state: "failure", description: "no linked wallet", context: STATUS_CONTEXT });
    await github.addLabel({ number: pr.number, labels: ["gate: needs $Z"] });
    await github.comment({ number: pr.number, body: msg });
    return outcome({ reason: "no-link" });
  }

  // --- 2. Holder gate: call the gate skill (Helius read + threshold + fail-closed) -----------
  let verdict;
  try {
    verdict = await gate.run({ wallet: link.wallet, pr: ref, config });
  } catch (e) {
    // Fail CLOSED on any gate error (RPC down, misconfig, disagreement). Never merge on doubt.
    await github.setStatus({ sha: headSha, state: "failure", description: `gate error: ${e.message}`.slice(0, 140), context: STATUS_CONTEXT });
    await github.comment({ number: pr.number, body: `holder-gate could not verify your $Z balance (failing closed): ${e.message}` });
    return outcome({ reason: "gate-error" });
  }

  if (!verdict.pass) {
    const msg = `\`society-z/holder-gate\`: **FAIL**. ${verdict.reason}\nLink or top up, then push again: ${linkUrl}`;
    await github.setStatus({ sha: headSha, state: "failure", description: verdict.reason, context: STATUS_CONTEXT });
    await github.addLabel({ number: pr.number, labels: ["gate: needs $Z"] });
    await github.comment({ number: pr.number, body: msg });
    return outcome({ reason: "below-threshold", verdict });
  }

  // Gate green.
  await github.setStatus({ sha: headSha, state: "success", description: verdict.reason, context: STATUS_CONTEXT });
  await github.addLabel({ number: pr.number, labels: ["holder ✓"] });
  await github.comment({ number: pr.number, body: `\`society-z/holder-gate\`: **PASS**. ${verdict.reason}` });

  // --- 3. AI review pass ---------------------------------------------------------------------
  // Pull the diff (mock or real), then let the (pluggable) judge decide. reviewPR runs the
  // touched skill's smoke test as part of its evidence.
  let prWithDiff = pr;
  if (!pr.files) {
    const diff = await github.getDiff({ number: pr.number });
    prWithDiff = { ...pr, files: diff.files };
  }
  const reviewResult = await review.reviewPR(prWithDiff, {
    judge: config.judge,        // undefined -> review.mjs uses stubJudge (deterministic)
    runner: config.smokeRunner, // undefined -> real child-process runner
    repoRoot: config.repoRoot || ".",
  });

  await github.comment({ number: pr.number, body: `maintainer-agent review: ${reviewResult.verdict}` });

  if (!reviewResult.pass) {
    return outcome({ gate_pass: true, review_pass: false, reason: "review-rejected", verdict, reviewResult });
  }

  // --- 4. Both gates green -> merge ----------------------------------------------------------
  // In v1 the design says a HUMAN clicks merge (approval is reputation-gated). We honor that by
  // default: autoMerge is OFF unless explicitly enabled. When off, we leave both checks green and
  // stop here so a maintainer merges. When on (or in tests) we perform the merge + record.
  if (!config.autoMerge) {
    await github.comment({ number: pr.number, body: "Eligible to merge (holder ✓ + review ✓). Awaiting a human maintainer — approval is reputation-gated in v1." });
    return outcome({ gate_pass: true, review_pass: true, reason: "eligible-awaiting-human", verdict, reviewResult });
  }

  const merge = await github.merge({ number: pr.number, sha: headSha });
  if (!merge.merged) {
    await github.comment({ number: pr.number, body: "Merge call did not complete (head may have moved). Re-run the gate." });
    return outcome({ gate_pass: true, review_pass: true, reason: "merge-failed", verdict, reviewResult });
  }

  // --- 5. Append the witnessed record --------------------------------------------------------
  const entry = await record.append({
    github_id: link.github_id,
    github_login: link.github_login,
    member_id: link.member_id,
    wallet: link.wallet,
    pr: ref,
    merge_sha: merge.sha,
    held_z_at_merge: verdict.balance,
    gate_signature: verdict.signature || "",
    reviewers: reviewResult.reviewers || [],
    merged_at: new Date().toISOString(),
  });

  await github.comment({ number: pr.number, body: `Merged and witnessed. Record hash \`${entry.hash.slice(0, 16)}…\` credited to ${link.member_id || "@" + (link.github_login || link.github_id)}.` });

  return outcome({ merged: true, gate_pass: true, review_pass: true, reason: "merged", verdict, reviewResult, record: entry, merge_sha: merge.sha });
}

export { prRef };
