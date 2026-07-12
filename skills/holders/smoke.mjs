// holders smoke test: deterministic, no network, no keys, no paid calls.
// We stub global fetch to return canned getTokenSupply + getTokenLargestAccounts responses
// (realistic shapes), then assert the concentration math and the honest output shape. This
// proves the skill without touching mainnet.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

const DECIMALS = 6;
const ONE = 10n ** BigInt(DECIMALS); // raw units per whole token

// Build a token account row in getTokenLargestAccounts shape from a whole-token amount.
function acct(address, wholeTokens) {
  const raw = BigInt(wholeTokens) * ONE;
  return {
    address,
    amount: raw.toString(),
    decimals: DECIMALS,
    uiAmount: Number(wholeTokens),
    uiAmountString: String(wholeTokens),
  };
}

// Total supply: 1,000,000,000 tokens (like $Z). getTokenSupply value shape.
function supplyValue(wholeTokens) {
  const raw = BigInt(wholeTokens) * ONE;
  return {
    amount: raw.toString(),
    decimals: DECIMALS,
    uiAmount: Number(wholeTokens),
    uiAmountString: String(wholeTokens),
  };
}

// Route the stub by the JSON-RPC method in the request body.
function stub(supplyVal, largestVal) {
  globalThis.fetch = async (_url, opts) => {
    const method = JSON.parse(opts.body).method;
    const result = method === "getTokenSupply"
      ? { context: { slot: 1 }, value: supplyVal }
      : { context: { slot: 1 }, value: largestVal };
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: "holders", result }) };
  };
}

const MINT = "TestMint1111111111111111111111111111111111";

// --- Case 1: 20 accounts, 1B supply. Known concentration.
// 5 large accounts: 100M (10%), 50M (5%), 30M (3%), 20M (2%), 10M (1%) = 21% of supply.
// 15 small accounts: 1M each (0.1%) = 1.5% of supply.
// top-10 = the 5 large + 5 small = 21% + 0.5% = 21.5%.
// top-20 = all = 21% + 1.5% = 22.5%.
const big = [
  acct("Big1LargestHolderAccount1111111111111111111", 100_000_000),
  acct("Big2xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 50_000_000),
  acct("Big3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 30_000_000),
  acct("Big4xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 20_000_000),
  acct("Big5xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", 10_000_000),
];
const small = Array.from({ length: 15 }, (_, i) => acct(`Small${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, 1_000_000));
stub(supplyValue(1_000_000_000), [...big, ...small]);

let out = await run({ mint: MINT });
assert(out.mint === MINT, "mint echoed back");
assert(out.decimals === 6, "decimals surfaced");
assert(out.total_supply === 1_000_000_000, "total supply surfaced as uiAmount");
assert(out.accounts_returned === 20, "20 largest accounts returned");
assert(out.top_n === 10, "headline defaults to top 10");
assert(out.top_n_concentration_pct === 21.5, `top-10 concentration is 21.5%, got ${out.top_n_concentration_pct}`);
assert(out.top_20_concentration_pct === 22.5, `top-20 concentration is 22.5%, got ${out.top_20_concentration_pct}`);
assert(Array.isArray(out.top) && out.top.length === 20, "top list has all 20 rows");
assert(out.top[0].rank === 1 && out.top[0].pct_of_supply === 10, "largest account is rank 1 at 10%");
assert(typeof out.top[0].address === "string", "row exposes a (token account) address");
assert(!("raw" in out.top[0]), "internal BigInt field is stripped from output");
assert(typeof out.caveat === "string" && /top 20/.test(out.caveat) && /not a complete holder count/.test(out.caveat),
  "caveat states the top-20 limit and that it is not a holder count");
assert(/token account addresses, not\s+owner wallets/.test(out.caveat), "caveat states rows are token accounts, not owners");
assert(typeof out.checked_at === "string" && !Number.isNaN(Date.parse(out.checked_at)), "checked_at is an ISO string");
assert(typeof out.verdict === "string" && /largest-20/.test(out.verdict), "verdict names the largest-20 limit");
for (const s of [out.caveat, out.verdict]) assert(!s.includes("—"), "no em dashes in prose");

// --- Case 2: honors a custom top, and clamps to the number of accounts present.
stub(supplyValue(1_000_000_000), [...big, ...small]);
out = await run({ mint: MINT, top: 3 });
assert(out.top_n === 3, "custom top=3 honored");
assert(out.top_n_concentration_pct === 18, `top-3 = 10+5+3 = 18%, got ${out.top_n_concentration_pct}`);

// --- Case 3: fewer than 10 accounts -> headline N clamps down honestly.
stub(supplyValue(1_000_000_000), big.slice(0, 3)); // only 3 accounts exist
out = await run({ mint: MINT }); // default top 10
assert(out.accounts_returned === 3, "only 3 accounts returned");
assert(out.top_n === 3, "headline clamps to accounts present, never claims 10");
assert(out.top_n_concentration_pct === out.top_20_concentration_pct, "with <=20 accounts, top-N equals full view");

// --- Case 4: empty result -> honest zeros, no crash.
stub(supplyValue(1_000_000_000), []);
out = await run({ mint: MINT });
assert(out.accounts_returned === 0, "zero accounts reported honestly");
assert(out.top_n === 0 && out.top_n_concentration_pct === 0, "empty largest set => 0% concentration");
assert(Array.isArray(out.top) && out.top.length === 0, "empty top list");

// --- Case 5: zero supply -> concentration is not computable, reported as null (fail closed).
stub(supplyValue(0), big);
out = await run({ mint: MINT });
assert(out.total_supply === 0, "zero supply surfaced");
assert(out.top_n_concentration_pct === null, "percent of zero supply is null, not a fabricated number");
assert(/not computable/.test(out.verdict), "verdict is honest about zero supply");

// --- Case 6: mint is required.
let threw = false;
try { await run({}); } catch { threw = true; }
assert(threw, "missing mint throws");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: holders");
process.exit(failed ? 1 : 0);
