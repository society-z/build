// End-to-end test for the maintainer bot. Mocked Helius (global.fetch) + mocked GitHub API.
// No network, no keys, no real repo. Proves the load-bearing behavior:
//   - holder (>= threshold) + review pass -> github.merge() IS called + a record is written
//   - non-holder (< threshold)            -> github.merge() is NOT called, status FAIL
//   - no linked wallet                    -> no merge, comment carries the link URL
//
// Run: node test/e2e.test.mjs   (exits 0 on pass)

import { handlePullRequest } from "../index.mjs";
import { memoryLinks } from "../links.mjs";
import { mockGithub } from "../github.mjs";
import { memoryRecord } from "../record.mjs";
import { run as gateRun } from "../../skills/gate/index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } else { console.log("ok:", m); } };

// Stub Helius: the gate's only network call is getTokenAccountsByOwner. Return a canned balance.
function stubHelius(uiAmount) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: "2.0", id: "gate",
      result: { value: [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount } } } } } }] },
    }),
  });
}

// Deterministic smoke runner so review never spawns a child / hits the network.
const okRunner = () => ({ status: 0, output: "SMOKE PASS (mocked)" });
const badRunner = () => ({ status: 1, output: "SMOKE FAIL (mocked)" });

// Base config the gate + review read. Z_MINT/HELIUS from env would be real; here they are stubs.
function baseConfig(extra = {}) {
  return {
    repo: "societyz/core",
    repoRoot: new URL("../..", import.meta.url).pathname, // genesis-repo root (so skills/ resolve)
    Z_MINT: "TestMint1111111111111111111111111111111111",
    Z_THRESHOLD: 25000,
    HELIUS_RPC_URL: "https://stub.invalid/rpc",
    autoMerge: true,          // exercise the merge path in tests
    smokeRunner: okRunner,
    ...extra,
  };
}

// A PR that touches exactly one skill folder (satisfies the stub judge's "one skill per PR").
function prTouchingWhois(overrides = {}) {
  return {
    number: 210,
    title: "skill: verify",
    user: { id: 4242, login: "example-holder" },
    head: { sha: "headsha42" },
    files: [{ filename: "skills/verify/index.mjs", additions: 40, deletions: 2 }],
    ...overrides,
  };
}

const links = memoryLinks({
  4242: { github_login: "example-holder", wallet: "HolderWallet111", member_id: "mem_holder" },
  7777: { github_login: "example-nonholder", wallet: "PoorWallet111", member_id: "mem_poor" },
  // 9999 intentionally absent -> no link
});

// ---- Case 1: HOLDER passes -> MERGE called + record written -----------------------------------
{
  stubHelius(41000); // >= 25000
  const github = mockGithub({ mergeSha: "MERGED_SHA_1" });
  const record = memoryRecord();
  const res = await handlePullRequest(prTouchingWhois(), {
    links, gate: { run: gateRun }, github, record, config: baseConfig(),
  });

  assert(res.gate_pass === true, "holder: gate passed");
  assert(res.review_pass === true, "holder: review passed");
  assert(res.merged === true, "holder: outcome.merged true");
  assert(github.calls.merge.length === 1, "holder: github.merge() called exactly once");
  assert(github.calls.merge[0].sha === "headsha42", "holder: merge pinned to verified head sha");
  assert(record.entries.length === 1, "holder: one record entry appended");
  assert(record.entries[0].held_z_at_merge === 41000, "holder: record captures balance at merge");
  assert(record.entries[0].merge_sha === "MERGED_SHA_1", "holder: record captures merge sha");
  assert(/holder ✓/.test(JSON.stringify(github.calls.addLabel)), "holder: 'holder ✓' label added");
  const successStatus = github.calls.setStatus.find((s) => s.state === "success");
  assert(!!successStatus, "holder: society-z/holder-gate status set success");
}

// ---- Case 2: NON-HOLDER -> NO merge, FAIL status ----------------------------------------------
{
  stubHelius(100); // < 25000
  const github = mockGithub();
  const record = memoryRecord();
  const res = await handlePullRequest(
    prTouchingWhois({ number: 211, user: { id: 7777, login: "example-nonholder" }, head: { sha: "headsha77" } }),
    { links, gate: { run: gateRun }, github, record, config: baseConfig() }
  );

  assert(res.gate_pass === false, "non-holder: gate did not pass");
  assert(res.merged === false, "non-holder: not merged");
  assert(github.calls.merge.length === 0, "non-holder: github.merge() NOT called");
  assert(record.entries.length === 0, "non-holder: no record written");
  const failStatus = github.calls.setStatus.find((s) => s.state === "failure");
  assert(!!failStatus, "non-holder: holder-gate status set failure");
  assert(/25000 required/.test(JSON.stringify(github.calls.comment)), "non-holder: comment explains threshold");
}

// ---- Case 3: NO LINK -> no merge, comment carries the link URL --------------------------------
{
  stubHelius(999999); // irrelevant; must never be read because there is no link
  const github = mockGithub();
  const record = memoryRecord();
  const res = await handlePullRequest(
    prTouchingWhois({ number: 212, user: { id: 9999, login: "stranger" }, head: { sha: "headsha99" } }),
    { links, gate: { run: gateRun }, github, record, config: baseConfig() }
  );

  assert(res.reason === "no-link", "no-link: reason is no-link");
  assert(github.calls.merge.length === 0, "no-link: github.merge() NOT called");
  assert(/link\.societyz\.xyz/.test(JSON.stringify(github.calls.comment)), "no-link: comment includes link URL");
}

// ---- Case 4: HOLDER but SMOKE FAILS -> gate green, review rejects, NO merge --------------------
{
  stubHelius(41000);
  const github = mockGithub();
  const record = memoryRecord();
  const res = await handlePullRequest(prTouchingWhois({ number: 213 }), {
    links, gate: { run: gateRun }, github, record,
    config: baseConfig({ smokeRunner: badRunner }),
  });

  assert(res.gate_pass === true, "smoke-fail: gate still passed (holder)");
  assert(res.review_pass === false, "smoke-fail: review rejected");
  assert(res.merged === false, "smoke-fail: not merged");
  assert(github.calls.merge.length === 0, "smoke-fail: github.merge() NOT called");
  assert(record.entries.length === 0, "smoke-fail: no record written");
}

// ---- Case 5: autoMerge OFF (v1 default) -> eligible, awaits human, NO merge --------------------
{
  stubHelius(41000);
  const github = mockGithub();
  const record = memoryRecord();
  const res = await handlePullRequest(prTouchingWhois({ number: 214 }), {
    links, gate: { run: gateRun }, github, record,
    config: baseConfig({ autoMerge: false }),
  });

  assert(res.gate_pass === true && res.review_pass === true, "human-merge: both checks green");
  assert(res.merged === false, "human-merge: bot did not auto-merge (v1 human clicks merge)");
  assert(res.reason === "eligible-awaiting-human", "human-merge: reason eligible-awaiting-human");
  assert(github.calls.merge.length === 0, "human-merge: github.merge() NOT called");
}

console.log(failed ? "\nE2E FAIL" : "\nE2E PASS: maintainer");
process.exit(failed ? 1 : 0);
