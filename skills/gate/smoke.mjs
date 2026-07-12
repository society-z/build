// gate smoke test — deterministic, no private keys, no live RPC.
// We stub global fetch to return a canned getTokenAccountsByOwner response, then assert
// the pass/fail logic. This proves the skill's SHAPE and threshold math without secrets.
//
// Security-sensitive config is pinned to server-side env vars (never caller inputs), so the
// test injects Z_MINT / Z_THRESHOLD / HELIUS_RPC_URL via process.env, not via inputs.config.
process.env.Z_MINT = "4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump"; // valid base58 mint
process.env.Z_THRESHOLD = "25000";
process.env.HELIUS_RPC_URL = "https://stub.invalid/rpc";
delete process.env.GATE_SIGNING_SECRET_KEY; // no key -> unsigned path (signature === "")

import { run } from "./index.mjs";

// A valid base58 Solana address for the test wallet (wrapped-SOL mint address; base58, 43 chars).
const WALLET = "So11111111111111111111111111111111111111112";

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

// Case 1: above threshold -> pass
stubFetch(41000);
let out = await run({ wallet: WALLET, pr: "societyz/core#210" });
assert(out.pass === true, "41000 >= 25000 should pass");
assert(out.balance === 41000, "balance surfaced");
assert(out.threshold === 25000, "threshold surfaced");
assert(typeof out.checked_at === "string", "checked_at is ISO string");
assert(typeof out.signature === "string", "signature field present (empty when unsigned)");
assert(/holds 41000/.test(out.reason), "reason explains pass");

// Case 2: below threshold -> fail
stubFetch(100);
out = await run({ wallet: WALLET });
assert(out.pass === false, "100 < 25000 should fail");
assert(/100 \$Z; 25000 required/.test(out.reason), "reason explains fail");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: gate");
process.exit(failed ? 1 : 0);
