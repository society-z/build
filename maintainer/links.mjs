// links — resolve a GitHub author id to their SIWS-proven Solana wallet.
//
// This is the ONE place that reads the `links` table (github_id -> wallet). The bot never lets
// a PR author self-type a wallet; the wallet must come from a row that was written only after a
// domain-bound SIWS signature proved control of the key (see contribution-mechanism.md §1a and
// .github/holder-gate/README.md). Pasting an address proves nothing.
//
// v1 stub: reads a local JSON file (links.example.json shape). The interface is deliberately the
// same shape you get from the real linking service, so swapping is a one-line change:
//
//   const links = fileLinks("links.json");            // <- stub, today
//   const links = supabaseLinks(URL, SERVICE_KEY);    // <- real, at launch (implement getLink)
//
// Any implementation only has to provide:  async getLink(githubId) -> Link | null
// where Link = { github_id, github_login, wallet, member_id?, principal_github_id?, revoked? }

import { readFileSync } from "node:fs";

// Normalize a raw row into the Link contract the gate/record expect. Returns null if unusable
// or revoked, so callers can treat "no link" and "revoked link" identically (fail closed).
function normalize(row) {
  if (!row || row.revoked) return null;
  if (!row.wallet || typeof row.wallet !== "string") return null;
  return {
    github_id: Number(row.github_id),
    github_login: row.github_login || null,
    wallet: row.wallet,
    member_id: row.member_id || null,
    principal_github_id: row.principal_github_id ?? null,
    revoked: !!row.revoked,
  };
}

// STUB: a links table backed by a JSON file. Shape: { "<github_id>": { ...row } } OR an array of
// rows each with a github_id field. Both are accepted.
export function fileLinks(path) {
  let table = {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (Array.isArray(parsed)) {
      for (const row of parsed) table[String(row.github_id)] = row;
    } else {
      table = parsed;
    }
  } catch (e) {
    throw new Error(`links file not readable at ${path}: ${e.message}`);
  }
  return {
    async getLink(githubId) {
      return normalize(table[String(githubId)] || null);
    },
  };
}

// REAL (to implement at launch): read the same row from the SIWS-backed Supabase `links` table.
// Left as a documented stub so nobody ships a half-real network call by accident. Fill this in
// when LINK_DB_URL / LINK_DB_SERVICE_KEY exist; keep the getLink signature identical.
export function supabaseLinks(/* url, serviceKey */) {
  return {
    async getLink(/* githubId */) {
      throw new Error(
        "supabaseLinks not implemented — wire LINK_DB_URL + LINK_DB_SERVICE_KEY against the " +
          "SIWS links table, return normalize(row). See .github/holder-gate/README.md."
      );
    },
  };
}

// In-memory links, handy for tests: fromLinks({ 4242: { wallet, ... } }).
export function memoryLinks(rows) {
  const table = {};
  for (const [id, row] of Object.entries(rows)) table[String(id)] = { github_id: Number(id), ...row };
  return {
    async getLink(githubId) {
      return normalize(table[String(githubId)] || null);
    },
  };
}
