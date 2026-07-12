// roster smoke test — deterministic, no filesystem, no network, no keys.
// Feeds an injected links table (memory path), asserts the member list shape, the fail-closed
// drop of a revoked row, and that an empty table honestly reports zero members at genesis.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// A small links table: one human holder, one agent (carries principal_github_id), one revoked.
const links = {
  "4242": {
    github_login: "example-holder",
    wallet: "9UH61sExampleBase58Pubkey11111111111111111LMA",
    member_id: "mem_example_holder",
    principal_github_id: null,
    revoked: false,
  },
  "8080": {
    github_login: "example-agent",
    wallet: "AgentWalletBase58Pubkey1111111111111111111111",
    member_id: "mem_example_agent",
    principal_github_id: 4242,
    revoked: false,
  },
  "9999": {
    github_login: "example-revoked",
    wallet: "RevokedWalletBase58Pubkey111111111111111111111",
    member_id: "mem_example_revoked",
    revoked: true,
  },
};

// Case 1: two active members, one dropped revoked row.
let out = await run({ links });
assert(out.count === 2, "two active members (revoked row excluded)");
assert(out.dropped === 1, "one revoked row dropped fail-closed");
assert(Array.isArray(out.members), "members is an array");
assert(typeof out.as_of === "string", "as_of is an ISO string");

const holder = out.members.find((m) => m.github_id === 4242);
assert(holder && holder.member_id === "mem_example_holder", "holder surfaced by member_id");
assert(holder.github_login === "example-holder", "holder github_login surfaced");
assert(holder.wallet === links["4242"].wallet, "full wallet preserved in data");
assert(/^9UH61s…/.test(holder.wallet_short) && holder.wallet_short.length < holder.wallet.length,
  "wallet_short is a truncated display");
assert(holder.kind === "human", "no principal_github_id => human");
assert(holder.tier === null, "tier not determinable from links alone => null");

const agent = out.members.find((m) => m.github_id === 8080);
assert(agent && agent.kind === "agent", "principal_github_id present => agent");
assert(agent.principal_github_id === 4242, "agent rolls up under its principal");

assert(out.members[0].github_id === 4242 && out.members[1].github_id === 8080,
  "members sorted by github_id for determinism");

// Case 2: array-shaped table with a comment-free tier passthrough.
out = await run({ links: [
  { github_id: 1, github_login: "a", wallet: "WalletA111111111111111111111", member_id: "mem_a", tier: "propose" },
] });
assert(out.count === 1, "array-shaped table accepted");
assert(out.members[0].tier === "propose", "explicit tier on a row passes through");

// Case 3: empty table is valid and honestly reports genesis.
out = await run({ links: {} });
assert(out.count === 0, "empty table => zero members");
assert(out.members.length === 0, "no members listed");
assert(/genesis/.test(out.reason), "reason states the society is at genesis");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: roster");
process.exit(failed ? 1 : 0);
