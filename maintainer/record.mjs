// record — the witnessed contribution ledger.
//
// On every merge the bot appends one signed, hash-chained entry crediting the contributor. v1
// writes to a local record.jsonl (append-only, sha256 prev_hash chain — the same discipline as
// Crest's witness chain, contribution-mechanism.md §5). The interface is a single append() so it
// swaps cleanly for the real anchor later:
//
//   const record = jsonlRecord("record.jsonl");     // <- v1, today
//   const record = witnessChainRecord({...});        // <- later: anchor to Crest's witness chain
//
// Any implementation provides:  async append(entry) -> { ...entry, prev_hash, hash }

import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

// Canonical, stable-order serialization so the hash is reproducible by anyone re-serializing.
function canonical(e) {
  return JSON.stringify({
    github_id: e.github_id,
    github_login: e.github_login ?? null,
    passport_id: e.passport_id ?? null,
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

// v1 STUB: append to a local JSONL file, hash-chained.
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

// LATER (documented stub): anchor each entry to Crest's witness chain instead of / in addition to
// the local file. Keep the append(entry) -> {..., hash} contract. The gate already produces a
// signed verdict (entry.gate_signature); this is where you hash-link + OTS/on-chain anchor it.
export function witnessChainRecord() {
  return {
    async append() {
      throw new Error(
        "witnessChainRecord not implemented — POST the hash-chained entry to Crest's witness " +
          "chain (append + anchor). Andy signs any on-chain anchor tx; the bot only prepares it."
      );
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
