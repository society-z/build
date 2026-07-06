// verify smoke test — deterministic, no filesystem, no network, no keys.
// Builds a small valid chain with the exact same canonical()/sha256() the ledger uses, then
// checks that verify (a) accepts it, and (b) catches a single tampered field.
import { run } from "./index.mjs";
import { canonical, sha256 } from "../../maintainer/record.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

const GENESIS = "0".repeat(64);

function build(entries) {
  let prev = GENESIS;
  const out = [];
  for (const e of entries) {
    const withPrev = { ...e, prev_hash: prev };
    const hash = sha256(canonical(withPrev));
    const line = { ...withPrev, hash };
    out.push(line);
    prev = hash;
  }
  return out;
}

const base = [
  { github_id: 1, wallet: "WalletA", pr: "society-z/build#1", merge_sha: "aaa", held_z_at_merge: 1000, merged_at: "2026-07-06T00:00:00.000Z" },
  { github_id: 2, wallet: "WalletB", pr: "society-z/build#2", merge_sha: "bbb", held_z_at_merge: 2000, merged_at: "2026-07-06T01:00:00.000Z" },
];

// Case 1: an untouched, correctly-chained record verifies clean.
const good = build(base);
let out = await run({ entries: good });
assert(out.valid === true, "untouched chain should verify");
assert(out.count === 2, "counts both entries");
assert(out.broken_at === null, "no break reported on a valid chain");
assert(out.head === good[1].hash, "head is the last entry's hash");

// Case 2: tamper with one field after the fact (content changed, hash left stale) -> caught.
const tampered = build(base);
tampered[0].held_z_at_merge = 999999; // change content without recomputing the hash
out = await run({ entries: tampered });
assert(out.valid === false, "tampered entry should fail verification");
assert(out.broken_at === 0, "reports the tampered entry's index");

// Case 3: empty record is valid (nothing to break) but reported as empty.
out = await run({ entries: [] });
assert(out.valid === true, "empty record is trivially valid");
assert(out.count === 0, "empty record reports zero entries");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: verify");
process.exit(failed ? 1 : 0);
