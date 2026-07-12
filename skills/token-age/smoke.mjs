// token-age smoke test — deterministic, no keys, no live RPC.
//
// We stub global fetch to serve canned JSON-RPC responses (realistic getSignaturesForAddress +
// getAccountInfo shapes, for BOTH the Token and Token-2022 programs) and assert the skill's
// shape and logic: creation time from the oldest signature, authority revoked flags, program
// detection, and the honest failure paths. No network, no secrets.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

// A mint account (getAccountInfo, jsonParsed). owner picks the program; authorities may be null.
function mintAccount({ owner, program, mintAuthority, freezeAuthority }) {
  return {
    context: { slot: 300 },
    value: {
      data: {
        parsed: {
          info: { decimals: 6, freezeAuthority, isInitialized: true, mintAuthority, supply: "1000000000000000" },
          type: "mint",
        },
        program,
        space: 82,
      },
      executable: false,
      lamports: 1461600,
      owner,
      rentEpoch: 18446744073709551615,
      space: 82,
    },
  };
}

// A signature page (newest-first). The LAST entry is the oldest -> the account's creation.
const SIGS = [
  { signature: "sigNewest", slot: 300, err: null, memo: null, blockTime: 1752300000, confirmationStatus: "finalized" },
  { signature: "sigMiddle", slot: 200, err: null, memo: null, blockTime: 1752200000, confirmationStatus: "finalized" },
  { signature: "sigOldestCreate", slot: 100, err: null, memo: null, blockTime: 1752100000, confirmationStatus: "finalized" },
];

// Install a fetch stub that dispatches on the JSON-RPC method. `accountResult` and `sigResult`
// are the canned results returned for getAccountInfo / getSignaturesForAddress respectively.
function stub({ accountResult, sigResult }) {
  globalThis.fetch = async (_url, options) => {
    const { method } = JSON.parse(options.body);
    let result;
    if (method === "getAccountInfo") result = accountResult;
    else if (method === "getSignaturesForAddress") result = sigResult;
    else throw new Error(`unexpected method ${method}`);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", id: "token-age", result }) };
  };
}

// --- Case 1: Token-2022, both authorities revoked (the $Z shape) --------------------------------
stub({
  accountResult: mintAccount({
    owner: TOKEN_2022_PROGRAM, program: "spl-token-2022", mintAuthority: null, freezeAuthority: null,
  }),
  sigResult: SIGS,
});
let out = await run({ mint: "Zmint2022Example1111111111111111111111111111", config: { HELIUS_RPC_URL: "https://stub.invalid/rpc" } });
assert(out.program === "token-2022", "owner maps to token-2022");
assert(out.oldest_signature === "sigOldestCreate", "oldest signature is the last of the page");
assert(out.created_at === new Date(1752100000 * 1000).toISOString(), "created_at derives from oldest blockTime");
assert(out.created_slot === 100, "created_slot is the oldest slot");
assert(typeof out.age_seconds === "number" && out.age_seconds > 0, "age_seconds positive");
assert(typeof out.age === "string" && out.age.length > 0, "age is a human string");
assert(out.mint_authority === null && out.mint_authority_revoked === true, "mint authority revoked");
assert(out.freeze_authority === null && out.freeze_authority_revoked === true, "freeze authority revoked");
assert(out.signatures_scanned === 3, "scanned all 3 signatures in one page");
assert(Array.isArray(out.caveats) && out.caveats.length === 0, "no caveats on a clean read");
assert(typeof out.checked_at === "string", "checked_at is an ISO string");
assert(/mint authority revoked/.test(out.reason) && /token-2022/.test(out.reason), "reason summarizes state");

// --- Case 2: classic Token program, authorities still LIVE --------------------------------------
stub({
  accountResult: mintAccount({
    owner: TOKEN_PROGRAM, program: "spl-token",
    mintAuthority: "Auth1111111111111111111111111111111111111111",
    freezeAuthority: "Frez1111111111111111111111111111111111111111",
  }),
  sigResult: SIGS,
});
out = await run({ mint: "TokenClassicMint11111111111111111111111111111", config: { HELIUS_RPC_URL: "https://stub.invalid/rpc" } });
assert(out.program === "token", "owner maps to classic token");
assert(out.mint_authority === "Auth1111111111111111111111111111111111111111", "live mint authority surfaced");
assert(out.mint_authority_revoked === false, "live mint authority not revoked");
assert(out.freeze_authority_revoked === false, "live freeze authority not revoked");
assert(/mint authority live/.test(out.reason), "reason reports a live authority");

// --- Case 3: no signatures -> honest, no fabricated age -----------------------------------------
stub({
  accountResult: mintAccount({
    owner: TOKEN_PROGRAM, program: "spl-token", mintAuthority: null, freezeAuthority: null,
  }),
  sigResult: [],
});
out = await run({ mint: "NoSigMint111111111111111111111111111111111111", config: { HELIUS_RPC_URL: "https://stub.invalid/rpc" } });
assert(out.created_at === null && out.age_seconds === null, "no age is invented when there are no signatures");
assert(out.caveats.some((c) => /no signatures found/.test(c)), "caveat states creation could not be established");

// --- Case 4: not a mint (owned by neither token program) -> fail closed --------------------------
stub({
  accountResult: { context: { slot: 1 }, value: { data: { parsed: { type: "account", info: {} }, program: "spl-token" }, owner: "11111111111111111111111111111111", executable: false, lamports: 1, rentEpoch: 0, space: 0 } },
  sigResult: SIGS,
});
let threw = false;
try { await run({ mint: "SystemOwned11111111111111111111111111111111", config: { HELIUS_RPC_URL: "https://stub.invalid/rpc" } }); }
catch { threw = true; }
assert(threw, "an account not owned by a token program fails closed (throws)");

// --- Case 5: missing account -> fail closed ------------------------------------------------------
stub({ accountResult: { context: { slot: 1 }, value: null }, sigResult: SIGS });
threw = false;
try { await run({ mint: "MissingMint11111111111111111111111111111111", config: { HELIUS_RPC_URL: "https://stub.invalid/rpc" } }); }
catch { threw = true; }
assert(threw, "a missing account fails closed (throws)");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: token-age");
process.exit(failed ? 1 : 0);
