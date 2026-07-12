// request-build smoke test — deterministic, no private keys, no live RPC.
// The only network call is the gate's on-chain balance read; we stub global fetch (exactly the
// way gate's own smoke does) so the imported gate runs its REAL logic against a canned balance.
// This proves request-build's shape + the fail-closed gate wiring without secrets or network.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// Stub the RPC: pretend the wallet holds `uiAmount` $Z (same canned shape gate expects).
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
  Z_THRESHOLD: 1000000,
  HELIUS_RPC_URL: "https://stub.invalid/rpc",
  // no signing key -> gate verdict is unsigned; still a valid shape
};

const idea = "Add a dark mode toggle to the roster page\n\nIt should remember the choice.";

// Case 1: above threshold -> authorized, returns the exact issue it WOULD create (dry-run only).
stubFetch(2000000);
let out = await run({ wallet: "TestWallet1111111111111111111111111111111", github_login: "octocat", idea, config });
assert(out.authorized === true, "2,000,000 >= 1,000,000 should authorize");
assert(out.dry_run === true, "dry_run is always true — skill never mutates GitHub");
assert(out.would_create && typeof out.would_create === "object", "would_create present when authorized");
assert(out.would_create.title === "[build] Add a dark mode toggle to the roster page", "title derived from first line of idea");
assert(Array.isArray(out.would_create.labels) && out.would_create.labels[0] === "fix-me", "labels is the fix-me trigger label");
assert(/octocat/.test(out.would_create.body) && /@octocat/.test(out.would_create.body), "body credits the github_login");
assert(/openhands-resolve\.yml/.test(out.would_create.triggers_workflow), "names the workflow it would trigger");
assert(out.balance === 2000000 && out.threshold === 1000000, "gate balance/threshold surfaced");
assert(out.gate && out.gate.pass === true, "full gate verdict attached for audit");

// Case 2: below threshold -> fail closed: not authorized, nothing to create.
stubFetch(100);
out = await run({ wallet: "TestWallet1111111111111111111111111111111", github_login: "octocat", idea, config });
assert(out.authorized === false, "100 < 1,000,000 should deny (fail closed)");
assert(out.would_create === null, "no issue proposed when unauthorized");
assert(/not authorized/.test(out.reason), "reason explains denial");

// Case 3: missing/empty idea -> throws (input validation).
let threw = false;
try { await run({ wallet: "w", github_login: "octocat", idea: "   ", config }); } catch { threw = true; }
assert(threw, "empty idea should throw");

// Case 4: missing github_login -> throws.
threw = false;
try { await run({ wallet: "w", idea, config }); } catch { threw = true; }
assert(threw, "missing github_login should throw");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: request-build");
process.exit(failed ? 1 : 0);
