// roster — read the SIWS-proven links table and report Society Z's current member list.
//
// Where `gate` answers "does this wallet hold enough $Z" and `verify` answers "is the record
// honest," `roster` answers "who is in the society right now." It reads one thing — the links
// table (github_id -> SIWS-proven wallet) — and reports the members it finds. Nothing more.
//
// It never writes, never signs, never calls the network. It reuses the maintainer's own
// links primitive (fileLinks / memoryLinks -> normalize) rather than reimplementing the row
// contract, so roster can never quietly disagree with what the gate actually resolves. A row
// the links primitive treats as revoked or unusable is dropped here too (fail closed): a member
// you cannot resolve is not a member you list.
//
// Honest at genesis: zero members prints zero members. The society is small at the start and
// the roster says so plainly. It never pads, projects, or invents example members.

import { readFileSync, existsSync } from "node:fs";
import { fileLinks, memoryLinks } from "../../maintainer/links.mjs";

// Fold either shape (array of rows, or { <github_id>: row } map) into a plain id->row map.
// Skips comment keys (links.example.json carries a "_comment") and anything without an id.
function toMap(raw) {
  const map = {};
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (row && row.github_id != null) map[String(row.github_id)] = row;
    }
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (!k.startsWith("_") && v && typeof v === "object") map[k] = v;
    }
  }
  return map;
}

// Truncate a wallet for display only. The full wallet is always kept in `wallet`.
function shortWallet(w) {
  if (typeof w !== "string" || w.length <= 14) return w || null;
  return `${w.slice(0, 6)}…${w.slice(-6)}`;
}

// Build a links store (getLink contract) plus the raw id->row map used to enumerate ids and
// surface any display-only `tier` a row already carries. For a file, fileLinks() is the same
// stub the gate's lookup uses; for an injected table, memoryLinks() runs the same normalize.
function buildStore(inputs) {
  if (inputs?.links) {
    const map = toMap(inputs.links);
    return { store: memoryLinks(map), map };
  }
  const path = inputs?.path || inputs?.config?.LINKS_FILE || "links.json";
  if (!existsSync(path)) return { store: memoryLinks({}), map: {} };
  const parsed = JSON.parse(readFileSync(path, "utf8"));
  return { store: fileLinks(path), map: toMap(parsed) };
}

export async function run(inputs) {
  const { store, map } = buildStore(inputs);
  const ids = Object.keys(map);

  const members = [];
  let dropped = 0;
  for (const id of ids) {
    const link = await store.getLink(id); // normalized, or null if revoked/unusable
    if (!link) { dropped++; continue; }
    const raw = map[id] || {};
    members.push({
      member_id: link.member_id,
      github_id: link.github_id,
      github_login: link.github_login,
      wallet: link.wallet,
      wallet_short: shortWallet(link.wallet),
      // Agent vs human is the one classification the links table alone can prove: an agent
      // link carries the principal_github_id of the human who deployed it.
      kind: link.principal_github_id != null ? "agent" : "human",
      principal_github_id: link.principal_github_id,
      // Tier depends on live $Z balance (gate) and record standing, neither of which the links
      // table carries. roster does not guess it. It passes a tier through only if a row already
      // states one; otherwise null. See README.
      tier: typeof raw.tier === "string" ? raw.tier : null,
    });
  }
  members.sort((a, b) => a.github_id - b.github_id);

  return {
    count: members.length,
    members,
    dropped,
    reason: members.length === 0
      ? "0 members — Society Z is at genesis"
      : `${members.length} member${members.length === 1 ? "" : "s"} in the roster`,
    as_of: new Date().toISOString(),
  };
}

// Allow direct invocation: `node index.mjs '{"path":"../../maintainer/links.json"}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2)));
}
