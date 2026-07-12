// record smoke test — deterministic, no network, no keys.
//
// The git-mode cases run against THIS repo's real `git log` (available inside the checkout, no
// network). They assert the SHAPE of the output, not exact values, since the history grows. If
// the sandbox has no git at all, the skill degrades to an empty result and this test tolerates
// that (it never hard-fails on a missing binary). The record-mode and injected-commit cases use
// in-memory fixtures so the two modes are proven without any git dependency.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// --- Case 1: real repo git history --------------------------------------------------------------
let out = await run({});
assert(typeof out.count === "number", "count is a number");
assert(Array.isArray(out.merges), "merges is an array");
assert(out.source === "git" || out.source === "record", "source is git or record");
assert(Array.isArray(out.caveats), "caveats is an array");
assert(typeof out.as_of === "string", "as_of is an ISO string");

const gitUnavailable = out.caveats.some((c) => /git is not available/.test(c));
if (!gitUnavailable) {
  // git is present (the expected case inside a checkout): prove real merges came back.
  assert(out.source === "git", "genesis has no record.jsonl yet, so source is git");
  assert(out.count >= 1, "at least one skill merge exists in this repo's history");
  const m = out.merges[0];
  assert(typeof m.sha === "string" && m.sha.length > 0, "merge has a commit sha");
  assert(typeof m.sha_short === "string" && m.sha_short.length <= 12, "merge has a short sha");
  assert(typeof m.date === "string", "merge has a date");
  assert(Array.isArray(m.skills) && m.skills.length >= 1, "merge names at least one skill");
  assert(typeof m.skills[0].name === "string", "skill entry has a name");
  assert("description" in m.skills[0], "skill entry carries a description field");
  assert(typeof m.subject === "string", "merge carries the commit subject");
  assert(m.wallet === null, "git mode has no wallet-level attribution (honest null)");
  assert(
    out.caveats.some((c) => /record\.jsonl does not exist yet/.test(c)),
    "git mode declares it is the interim source, not the canonical record"
  );
  // newest-first ordering
  const dates = out.merges.map((x) => x.date);
  const sorted = [...dates].sort((a, b) => String(b).localeCompare(String(a)));
  assert(JSON.stringify(dates) === JSON.stringify(sorted), "merges are newest-first");
  // no _template merges leak in
  const names = out.merges.flatMap((x) => x.skills.map((s) => s.name));
  assert(!names.includes("_template"), "_template is never reported as a member skill");
} else {
  console.error("note: git unavailable in this environment; git-mode assertions skipped");
}

// --- Case 2: git-mode identity filters are honestly declined ------------------------------------
out = await run({ github_login: "someone", wallet: "SoMeWaLLet1111111111111111111111111111111111" });
if (out.source === "git") {
  assert(
    out.caveats.some((c) => /github_login .* cannot be resolved from git history/.test(c)),
    "github_login is declined honestly in git mode"
  );
  assert(
    out.caveats.some((c) => /wallet .* cannot be resolved from git history/.test(c)),
    "wallet is declined honestly in git mode"
  );
}

// --- Case 3: filter with no match reports zero honestly -----------------------------------------
out = await run({ filter: "no-such-author-zzz-9999" });
assert(out.count === 0, "an unmatched filter yields zero merges");
assert(/no merges match/.test(out.reason), "reason states nothing matched");

// --- Case 4: injected commits (git mode, no git binary needed) ----------------------------------
const commits = [
  { sha: "aaaaaaaaaaaa1111", author_name: "Ada Lovelace", author_email: "ada@example.com",
    date: "2026-07-10T00:00:00Z", subject: "Add foo skill",
    skills: [{ name: "foo", description: "does foo" }] },
  { sha: "bbbbbbbbbbbb2222", author_name: "Bob Bit", author_email: "bob@example.com",
    date: "2026-07-11T00:00:00Z", subject: "Add bar skill",
    skills: [{ name: "bar", description: "does bar" }] },
];
out = await run({ commits });
assert(out.source === "git", "injected commits => git source");
assert(out.count === 2, "both injected commits counted");
assert(out.merges[0].date === "2026-07-11T00:00:00Z", "injected commits sorted newest-first");
out = await run({ commits, filter: "ada" });
assert(out.count === 1 && out.merges[0].author_name === "Ada Lovelace",
  "filter narrows injected commits by author substring");

// --- Case 5: record mode (canonical entries injected) -------------------------------------------
const entries = [
  { github_id: 1, github_login: "ada", member_id: "mem_ada",
    wallet: "AdaWalletBase58Pubkey11111111111111111111111",
    pr: "society-z/build#7", merge_sha: "cccccccccccc3333", held_z_at_merge: 1000,
    merged_at: "2026-07-09T00:00:00Z" },
  { github_id: 2, github_login: "bob", member_id: "mem_bob",
    wallet: "BobWalletBase58Pubkey111111111111111111111111",
    pr: "society-z/build#8", merge_sha: "dddddddddddd4444", held_z_at_merge: 2000,
    merged_at: "2026-07-10T00:00:00Z" },
];
out = await run({ entries });
assert(out.source === "record", "injected entries => canonical record source");
assert(out.count === 2, "both record entries counted");
const ada = out.merges.find((m) => m.member_id === "mem_ada");
assert(ada && ada.github_login === "ada", "record mode surfaces the real github_login");
assert(ada.wallet === entries[0].wallet, "record mode preserves the full wallet");
assert(/^AdaWal…/.test(ada.wallet_short), "record mode truncates wallet for display");
assert(ada.held_z_at_merge === 1000, "record mode carries balance held at merge");
assert(ada.sha === "cccccccccccc3333" && ada.date === "2026-07-09T00:00:00Z",
  "record mode reports merge_sha and merged_at as sha/date");

// --- Case 6: record mode filters by real identity -----------------------------------------------
out = await run({ entries, github_login: "bob" });
assert(out.count === 1 && out.merges[0].member_id === "mem_bob",
  "github_login filters the canonical record to one member");
out = await run({ entries, wallet: entries[0].wallet });
assert(out.count === 1 && out.merges[0].member_id === "mem_ada",
  "wallet filters the canonical record to one member");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: record");
process.exit(failed ? 1 : 0);
