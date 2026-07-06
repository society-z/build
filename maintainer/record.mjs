// record — Society Z's own contribution ledger.
//
// On every merge the bot appends one signed, hash-chained entry crediting the contributor:
// a local, append-only record.jsonl, sha256 prev_hash chained. No external service. Anyone
// can clone the repo and re-derive the whole chain themselves — see skills/verify.
//
// This is real today, not a placeholder:
//
//   const record = jsonlRecord("record.jsonl");     // <- live
//
// A future external checkpoint (e.g. OpenTimestamps) can extend this later, run by Society Z's
// own maintainer bot, documented in this repo. Not built yet; the local chain is honest and
// sufficient for now. Any implementation provides: async append(entry) -> {...entry, prev_hash, hash}

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

// Canonical, stable-order serialization so the hash is reproducible by anyone re-serializing.
function canonical(e) {
  return JSON.stringify({
    github_id: e.github_id,
    github_login: e.github_login ?? null,
    member_id: e.member_id ?? null,
    wallet: e.wallet,
    pr: e.pr,
    merge_sha: e.merge_sha,
    held_z_at_merge: e.held_z_at_merge,
    gate_signature: e.gate_signature ?? "",
    reviewers: e.reviewers ?? [],
    merged_at: e.merged_at,
    prev_hash: e.prev_hash,
  });
}

function sha256(s) {
  return createHash("sha256").update(s).digest("hex");
}

// Read the last line's hash to chain onto. Empty file -> genesis prev_hash of 64 zeros.
function lastHash(path) {
  if (!existsSync(path)) return "0".repeat(64);
  const lines = readFileSync(path, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return "0".repeat(64);
  try { return JSON.parse(lines[lines.length - 1]).hash || "0".repeat(64); }
  catch { return "0".repeat(64); }
}

// The live record: append to a local JSONL file, hash-chained. Not a stub — this is what runs.
export function jsonlRecord(path) {
  return {
    async append(entry) {
      const prev_hash = lastHash(path);
      const withPrev = { ...entry, prev_hash };
      const hash = sha256(canonical(withPrev));
      const line = { ...withPrev, hash };
      appendFileSync(path, JSON.stringify(line) + "\n");
      return line;
    },
  };
}

// In-memory record for tests: collects entries, still hash-chains them.
export function memoryRecord() {
  const entries = [];
  let prev = "0".repeat(64);
  return {
    entries,
    async append(entry) {
      const withPrev = { ...entry, prev_hash: prev };
      const hash = sha256(canonical(withPrev));
      const line = { ...withPrev, hash };
      prev = hash;
      entries.push(line);
      return line;
    },
  };
}

export { canonical, sha256 };
