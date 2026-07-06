// whois smoke test — deterministic, no live network. Stubs fetch to return canned Crest
// tool responses, then asserts the assembled card's shape and the summary logic.
import { run, summarize, isBaseAddress } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// input validation
assert(isBaseAddress("0x1111111111111111111111111111111111111111"), "valid base addr accepted");
assert(!isBaseAddress("not-an-address"), "junk rejected");
assert(!isBaseAddress("0x123"), "short addr rejected");

// pure summarizer
assert(
  summarize({ profile: { active: true }, counterparty: { risk: "low" }, agentrank: { score: 0.82 } })
    === "active, low counterparty risk, AgentRank 0.82",
  "summarize composes the one-liner"
);

// stub the three Crest endpoints
globalThis.fetch = async (url) => {
  const body = url.includes("onchain_profile") ? { active: true, tx_count: 340 }
    : url.includes("check_counterparty") ? { risk: "low", verdict: "known payer" }
    : url.includes("agentrank") ? { score: 0.82 }
    : {};
  return { ok: true, json: async () => body };
};

const out = await run({ address: "0x1111111111111111111111111111111111111111" });
assert(out.address.startsWith("0x"), "address echoed");
assert(out.profile.tx_count === 340, "profile surfaced");
assert(out.counterparty.risk === "low", "counterparty surfaced");
assert(out.agentrank.score === 0.82, "agentrank surfaced");
assert(/AgentRank 0.82/.test(out.verdict), "verdict includes score");
assert(typeof out.assembled_at === "string", "assembled_at present");

// partial-failure tolerance: one tool down still yields a card
globalThis.fetch = async (url) => {
  if (url.includes("agentrank")) return { ok: false, status: 503, json: async () => ({}) };
  return { ok: true, json: async () => ({ risk: "unknown", active: false }) };
};
const partial = await run({ address: "0x2222222222222222222222222222222222222222" });
assert(partial.agentrank.error !== undefined, "down tool captured as error, not a throw");
assert(typeof partial.verdict === "string", "still produces a verdict");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: whois");
process.exit(failed ? 1 : 0);
