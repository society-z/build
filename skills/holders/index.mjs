// holders: token holder concentration snapshot for any Solana SPL mint.
//
// Given a mint address, read two public, standard things on-chain (READ-ONLY) and report how
// concentrated the token is: the total supply and the largest token accounts. Two cheap JSON-RPC
// calls, no dependencies, no key required.
//   getTokenSupply           -> total supply and decimals
//   getTokenLargestAccounts  -> the largest token accounts (at most the top 20)
//
// Where `gate` answers "does this wallet hold enough $Z" and `state` answers "how big is the
// society", `holders` answers "how concentrated is this token" for any mint an agent is about to
// trust. It is a transparency organ. Point it at $Z's own mint and it lets anyone check Society
// Z's own claim that the creator wallet's ~1.05% stake is small and disclosed, not a hidden
// treasury. Point it at any other mint and it answers the same question the same way.
//
// HONEST LIMIT, stated plainly here and in every output's `caveat`:
//   - getTokenLargestAccounts returns AT MOST the top 20 token accounts. This is NOT a complete
//     holder count. There is no "total holders" field here because this read cannot produce one.
//   - The rows are TOKEN ACCOUNT addresses, not owner wallets. One owner may hold several token
//     accounts, and a token account address is not its owner. Resolving owners needs a further
//     getAccountInfo per account, which this skill does not do (it stays to two cheap reads).
//   So the number reported is "top-N of the largest-20 concentration", never "holder count".
//
// It never writes, never signs, never moves funds. It only reads.
//
// Config resolution (in order): explicit inputs.config -> env -> public mainnet fallback.
//   HELIUS_RPC_URL   RPC endpoint incl. API key (env only, never committed). When unset, falls
//                    back to the public https://api.mainnet-beta.solana.com (fine for low volume;
//                    Helius is recommended for reliability and rate limits).

const PUBLIC_RPC = "https://api.mainnet-beta.solana.com";

function loadConfig(override = {}) {
  return {
    HELIUS_RPC_URL: override.HELIUS_RPC_URL || process.env.HELIUS_RPC_URL || PUBLIC_RPC,
  };
}

// --- a single JSON-RPC call over fetch, same shape as gate. Throws (fail closed) on any error. ---
async function rpc(url, method, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "holders", method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

// Percent of total, computed on raw integer amounts with BigInt to avoid float drift, then
// rounded to 4 decimals. Returns null when total supply is zero (percent is undefined, not zero).
function pct(partRaw, totalRaw) {
  if (totalRaw <= 0n) return null;
  const scaled = Number((partRaw * 100000000n) / totalRaw); // percent * 1e6, truncated
  return Math.round(scaled / 100) / 10000; // percent to 4 decimals
}

// uiAmount for display: prefer the value the RPC already computed; fall back to raw/10^decimals.
function uiFrom(v, decimals) {
  if (v && typeof v.uiAmount === "number") return v.uiAmount;
  if (v && v.uiAmountString != null) return Number(v.uiAmountString);
  try { return Number(BigInt(v.amount)) / 10 ** decimals; } catch { return null; }
}

const CAVEAT =
  "getTokenLargestAccounts returns at most the top 20 token accounts, not a complete holder " +
  "count, so there is no total-holders figure here. The rows are token account addresses, not " +
  "owner wallets: one owner may hold several accounts, and a token account address is not its " +
  "owner. Concentration is measured across the largest token accounts only. A full holder " +
  "census would require indexing every account for this mint, which this read does not do.";

export async function run(inputs) {
  const cfg = loadConfig(inputs?.config);
  const mint = inputs?.mint;
  if (!mint || typeof mint !== "string") {
    throw new Error("mint (base58 SPL mint address) is required");
  }
  // Headline N for the concentration figure. Default 10. Clamped to [1, 20] because
  // getTokenLargestAccounts never returns more than 20 accounts.
  const requested = Number(inputs?.top);
  const topN = Number.isFinite(requested) ? Math.max(1, Math.min(20, Math.floor(requested))) : 10;

  // Two cheap, standard reads. If either fails, throw (fail closed) rather than guess.
  const supply = await rpc(cfg.HELIUS_RPC_URL, "getTokenSupply", [mint]);
  const largest = await rpc(cfg.HELIUS_RPC_URL, "getTokenLargestAccounts", [mint]);

  const supplyVal = supply?.value;
  if (!supplyVal || typeof supplyVal.amount !== "string") {
    throw new Error("getTokenSupply returned no supply for this mint (is it a valid SPL mint?)");
  }
  const decimals = Number(supplyVal.decimals ?? 0);
  const totalRaw = BigInt(supplyVal.amount);
  const totalUi = uiFrom(supplyVal, decimals);

  const accounts = (largest?.value ?? []).map((a, i) => {
    const raw = BigInt(a.amount);
    return {
      rank: i + 1,
      address: a.address, // TOKEN ACCOUNT address, not the owner wallet (see caveat)
      amount: uiFrom(a, decimals),
      pct_of_supply: pct(raw, totalRaw),
      raw, // dropped before return; kept here only for the BigInt sums below
    };
  });

  const returned = accounts.length;
  const nForHeadline = Math.min(topN, returned); // never claim more rows than exist
  const headRaw = accounts.slice(0, nForHeadline).reduce((s, a) => s + a.raw, 0n);
  const allRaw = accounts.reduce((s, a) => s + a.raw, 0n);

  const top = accounts.map(({ raw, ...rest }) => rest); // strip BigInt for JSON safety

  const topNPct = pct(headRaw, totalRaw);
  const top20Pct = pct(allRaw, totalRaw);

  const verdict = totalRaw <= 0n
    ? `${mint} reports zero supply; concentration is not computable`
    : `top ${nForHeadline} of the ${returned} largest accounts hold ${topNPct}% of supply ` +
      `(largest-20 view, not a full holder count)`;

  return {
    mint,
    decimals,
    total_supply: totalUi,
    accounts_returned: returned,
    top_n: nForHeadline,
    top_n_concentration_pct: topNPct,
    top_20_concentration_pct: top20Pct,
    top,
    caveat: CAVEAT,
    checked_at: new Date().toISOString(),
    verdict,
  };
}

// Allow direct invocation: `node index.mjs '{"mint":"<mint>","top":10}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
