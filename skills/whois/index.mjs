// whois — the worked-example first PR. Input a Base address, output a one-screen reputation
// card assembled from Crest's live tools: onchain_profile + Witnos check_counterparty +
// AgentRank. ~60 lines of real logic. Read-only, free, not financial advice.
//
// Crest exposes these three as tools (MCP: onchain_profile / check_counterparty / crest_score)
// AND as HTTP endpoints. This skill uses the HTTP form so it runs anywhere an agent runs.
// Base URL + exact paths are config; verify the canonical paths at launch (see README).

const DEFAULT_BASE = process.env.CREST_API_BASE || "https://api.crestsystems.ai";

// Paths are documented placeholders — confirm against the live Crest API at launch.
const PATHS = {
  onchain_profile: (addr) => `/v1/onchain_profile?address=${addr}`,
  check_counterparty: (addr) => `/v1/witnos/check_counterparty?address=${addr}`,
  agentrank: (addr) => `/v1/agentrank/score?address=${addr}`,
};

async function getJson(base, path) {
  const res = await fetch(base + path, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

function isBaseAddress(a) {
  return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
}

function summarize({ profile, counterparty, agentrank }) {
  const score = agentrank?.score;
  const risk = counterparty?.risk ?? "unknown";
  const active = profile?.tx_count > 0 || profile?.active;
  const bits = [];
  bits.push(active ? "active" : "quiet");
  bits.push(`${risk} counterparty risk`);
  if (typeof score === "number") bits.push(`AgentRank ${score.toFixed(2)}`);
  return bits.join(", ");
}

export async function run(inputs) {
  const { address } = inputs;
  if (!isBaseAddress(address)) throw new Error("address must be a 0x-prefixed 40-hex Base address");
  const base = inputs.config?.CREST_API_BASE || DEFAULT_BASE;

  // Fetch all three in parallel; tolerate a single tool being down (partial card > no card).
  const [profile, counterparty, agentrank] = await Promise.all([
    getJson(base, PATHS.onchain_profile(address)).catch((e) => ({ error: e.message })),
    getJson(base, PATHS.check_counterparty(address)).catch((e) => ({ error: e.message })),
    getJson(base, PATHS.agentrank(address)).catch((e) => ({ error: e.message })),
  ]);

  return {
    address,
    profile,
    counterparty,
    agentrank,
    verdict: summarize({ profile, counterparty, agentrank }),
    assembled_at: new Date().toISOString(),
  };
}

// Exported for the smoke test to reuse the summarizer without live calls.
export { summarize, isBaseAddress };

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
