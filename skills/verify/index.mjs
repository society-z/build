// verify — re-derive Society Z's own record and report whether the chain is intact.
//
// The record (../../maintainer/record.mjs) is a local, append-only, sha256 hash-chained
// JSONL log: no external service, no company to trust. This skill proves that in the most
// direct way possible — it recomputes every hash from the raw entries using the exact same
// canonical() + sha256() the ledger was written with (imported, not reimplemented, so this
// can never silently drift from what actually wrote the record), and reports the first place
// the chain breaks, if anywhere.
//
// Read-only. Never writes. Never calls any network endpoint.

import { readFileSync, existsSync } from "node:fs";
import { canonical, sha256 } from "../../maintainer/record.mjs";

const GENESIS_HASH = "0".repeat(64);

function loadEntries(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Recompute every entry's hash and prev_hash link; return the first mismatch, if any.
function checkChain(entries) {
  let expectedPrev = GENESIS_HASH;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prev_hash !== expectedPrev) {
      return { valid: false, broken_at: i, reason: `entry ${i}: prev_hash does not match entry ${i - 1}'s hash` };
    }
    const recomputed = sha256(canonical(e));
    if (recomputed !== e.hash) {
      return { valid: false, broken_at: i, reason: `entry ${i}: stored hash does not match recomputed hash (content changed after writing)` };
    }
    expectedPrev = e.hash;
  }
  return { valid: true, broken_at: null, reason: entries.length === 0 ? "record is empty" : "every entry recomputes correctly" };
}

export async function run(inputs) {
  const path = inputs?.path || inputs?.config?.RECORD_FILE || "record.jsonl";
  const entries = inputs?.entries || loadEntries(path);

  const result = checkChain(entries);
  const head = entries.length > 0 ? entries[entries.length - 1].hash : null;

  return {
    count: entries.length,
    head,
    valid: result.valid,
    broken_at: result.broken_at,
    reason: result.reason,
    checked_at: new Date().toISOString(),
  };
}

// Allow direct invocation: `node index.mjs '{"path":"../../maintainer/record.jsonl"}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2)));
}
