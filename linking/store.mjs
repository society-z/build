// store.mjs — the link store and nonce store.
//
// v1 backing is an append-only links.jsonl (one JSON record per line). The interface below
// is what a real DB swap must implement; nothing else in the linking service touches the
// file directly, so replacing this module with a Supabase/Postgres-backed one is drop-in.
//
// Link record shape (append-only, never mutated in place):
//   { github_id, github_login, wallet, siws_message, siws_signature, linked_at, revoked? }
//
// AUDITABILITY INVARIANT: the effective github_id -> wallet table is fully re-derivable from
// the stored (siws_message, siws_signature) pairs alone. See auditLinks() in link.mjs.
// linked_at and revoked are convenience metadata; the signatures are the source of truth.

import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_LINKS = join(HERE, "links.jsonl");
const DEFAULT_NONCES = join(HERE, "nonces.jsonl");

// ---------------------------------------------------------------------------
// Link store. createLinkStore({ path }) returns the swappable interface.
// ---------------------------------------------------------------------------
export function createLinkStore({ path = DEFAULT_LINKS } = {}) {
  function readAll() {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  }

  function append(record) {
    appendFileSync(path, JSON.stringify(record) + "\n");
    return record;
  }

  // Latest wins: a re-link appends a new row for the same github_id. Revoked rows drop out.
  function latestByGithubId() {
    const map = new Map();
    for (const r of readAll()) map.set(Number(r.github_id), r); // later lines overwrite
    for (const [id, r] of map) if (r.revoked) map.delete(id);
    return map;
  }

  function walletForGithubId(github_id) {
    const r = latestByGithubId().get(Number(github_id));
    return r ? r.wallet : null;
  }

  // One wallet <-> one github id (design §1a unique index). Latest link owning the wallet wins.
  function githubIdForWallet(wallet) {
    let found = null;
    for (const r of latestByGithubId().values()) {
      if (r.wallet === wallet) found = Number(r.github_id);
    }
    return found;
  }

  return { path, readAll, append, latestByGithubId, walletForGithubId, githubIdForWallet };
}

// ---------------------------------------------------------------------------
// Nonce store. Single-use: issue() mints, consume() succeeds exactly once per nonce.
// Backed by an append-only jsonl of {nonce, state, at} so consumption is durable.
// Swap for Redis/DB in prod; the interface is issue()/consume()/isIssued().
// ---------------------------------------------------------------------------
export function createNonceStore({ path = DEFAULT_NONCES } = {}) {
  function events() {
    if (!existsSync(path)) return [];
    return readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  }

  // Fold the log into current state per nonce.
  function state() {
    const m = new Map();
    for (const e of events()) m.set(e.nonce, e.state);
    return m;
  }

  function issue(nonce = randomNonce()) {
    appendFileSync(path, JSON.stringify({ nonce, state: "issued", at: new Date().toISOString() }) + "\n");
    return nonce;
  }

  function isIssued(nonce) {
    return state().get(nonce) === "issued";
  }

  // In-process claim set: closes the check-then-append (TOCTOU) window so two concurrent
  // requests in the SAME process cannot both observe "issued" and both mark it "used".
  // consume() runs to completion synchronously (no await between the check and the claim),
  // so within one Node process the claim + append is atomic.
  // NOTE (multi-instance): this in-process guard does NOT cover multiple processes/instances
  // sharing the same file. A multi-instance deployment must make the check-and-mark atomic in
  // the durable backend, e.g. Postgres `UPDATE nonces SET state='used' WHERE nonce=$1 AND
  // state='issued'` gated on the affected-row count, or Redis GETDEL/SETNX. Swap
  // createNonceStore for that backend at launch.
  const claimed = new Set();

  // Returns true exactly once for an issued, unused nonce; false on replay/unknown.
  function consume(nonce) {
    if (claimed.has(nonce)) return false;              // already consumed in this process
    if (state().get(nonce) !== "issued") return false; // never issued or already used (durable)
    claimed.add(nonce);                                // claim BEFORE the append; atomic in-process
    appendFileSync(path, JSON.stringify({ nonce, state: "used", at: new Date().toISOString() }) + "\n");
    return true;
  }

  return { path, issue, consume, isIssued };
}

// A trivial in-memory nonce store (tests, or auditing where durability is irrelevant).
export function memoryNonceStore(preIssued = []) {
  const s = new Map(preIssued.map((n) => [n, "issued"]));
  return {
    issue(nonce = randomNonce()) { s.set(nonce, "issued"); return nonce; },
    isIssued(n) { return s.get(n) === "issued"; },
    consume(n) { if (s.get(n) !== "issued") return false; s.set(n, "used"); return true; },
  };
}

// Audit nonce store: fresh per audit run, enforces single-use WITHIN that run. Nonce
// single-use was enforced durably at link time; here we re-derive the table from stored
// signatures, so the check we can still make is that no nonce appears twice — a duplicate or
// replayed row reusing an already-seen nonce is rejected. First sighting of a nonce succeeds;
// any repeat in the same audit fails. Create one per auditLinks() call so re-derivation stays
// repeatable across runs. (A legitimate revoke must therefore be a separately-signed message
// carrying its OWN fresh nonce, not a verbatim re-append of the original signed row.)
export function createAuditNonceStore() {
  const seen = new Set();
  return {
    consume(nonce) {
      if (!nonce || seen.has(nonce)) return false;
      seen.add(nonce);
      return true;
    },
    isIssued: () => true,
    issue: () => "",
  };
}

import { randomBytes } from "node:crypto";
export function randomNonce() {
  return randomBytes(32).toString("hex");
}
