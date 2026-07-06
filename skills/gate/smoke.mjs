// gate smoke test — deterministic, no private keys, no live RPC.
// We stub global fetch to return a canned getTokenAccountsByOwner response, then assert
// the pass/fail logic. This proves the skill's SHAPE and threshold math without secrets.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// Stub the RPC: pretend the wallet holds `uiAmount` $Z.
function stubFetch(uiAmount) {
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      jsonrpc: "2.0", id: "gate",
      result: { value: [
        { account: { data: { parsed: { info: { tokenAmount: { uiAmount } } } } } },
      ] },
    }),
  });
}

const config = {
  Z_MINT: "TestMint1111111111111111111111111111111111",
  Z_THRESHOLD: 25000,
  HELIUS_RPC_URL: "https://stub.invalid/rpc",
  // no signing key -> verdict.signature === "" (unsigned path, still valid shape)
};

// Case 1: above threshold -> pass
stubFetch(41000);
let out = await run({ wallet: "TestWallet1111111111111111111111111111111", pr: "societyz/core#210", config });
assert(out.pass === true, "41000 >= 25000 should pass");
assert(out.balance === 41000, "balance surfaced");
assert(out.threshold === 25000, "threshold surfaced");
assert(typeof out.checked_at === "string", "checked_at is ISO string");
assert(typeof out.signature === "string", "signature field present (empty when unsigned)");
assert(/holds 41000/.test(out.reason), "reason explains pass");

// Case 2: below threshold -> fail
stubFetch(100);
out = await run({ wallet: "TestWallet1111111111111111111111111111111", config });
assert(out.pass === false, "100 < 25000 should fail");
assert(/100 \$Z; 25000 required/.test(out.reason), "reason explains fail");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: gate");
process.exit(failed ? 1 : 0);
