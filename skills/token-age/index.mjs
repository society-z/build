// token-age — given a Solana mint address, report how old the token is and the live status of
// its mint and freeze authorities. READ-ONLY on-chain: it never signs, moves, or mutates.
//
// One question, answered from sources the caller can re-check: "how old is this token, and who
// can still mint or freeze it?" Age is the block time of the OLDEST signature the mint account
// has (its creation), found by paging getSignaturesForAddress back to the end. Authorities come
// from getAccountInfo on the mint, handling both the Token and Token-2022 programs.
//
// Config resolution (in order): explicit inputs.config -> env var -> public mainnet fallback.
//   HELIUS_RPC_URL   RPC endpoint incl. API key   (env only, never committed)
//   default          https://api.mainnet-beta.solana.com  (public, read-only, low volume)
//
// Fail closed: if the RPC is down, the account is missing, or the account is not a mint, it
// reports failure or the conservative reading. It never guesses an age or an authority.

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

// The two SPL token program ids. The mint account's `owner` is the authoritative source of
// which program governs it — the repo's own $Z mint is Token-2022.
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

function loadConfig(override = {}) {
  return {
    HELIUS_RPC_URL: override.HELIUS_RPC_URL || process.env.HELIUS_RPC_URL || DEFAULT_RPC,
  };
}

// --- raw JSON-RPC over fetch, same posture as gate: throw on transport or RPC error ---
async function rpc(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "token-age", method, params }),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  return json.result;
}

// Page getSignaturesForAddress from newest back to the end. Each page is newest-first, so the
// last item of the last page is the oldest signature the address has — the account's creation.
// A page shorter than LIMIT means we reached the end. MAX_PAGES caps runaway scans; if we stop
// early the reported age is a LOWER BOUND (truncated=true), stated plainly rather than hidden.
async function oldestSignature(rpcUrl, address) {
  const LIMIT = 1000;
  const MAX_PAGES = 10;
  let before;
  let oldest = null;
  let scanned = 0;
  let pages = 0;
  let truncated = false;
  for (;;) {
    const opts = before ? { limit: LIMIT, before } : { limit: LIMIT };
    const batch = await rpc(rpcUrl, "getSignaturesForAddress", [address, opts]);
    if (!Array.isArray(batch) || batch.length === 0) break;
    scanned += batch.length;
    oldest = batch[batch.length - 1]; // oldest in this page
    before = oldest.signature;
    pages++;
    if (batch.length < LIMIT) break; // reached the true end
    if (pages >= MAX_PAGES) { truncated = true; break; }
  }
  return { oldest, scanned, truncated };
}

function programName(owner) {
  if (owner === TOKEN_PROGRAM) return "token";
  if (owner === TOKEN_2022_PROGRAM) return "token-2022";
  return null;
}

// A compact, honest human age. Whole units, largest that is non-zero, plus the next unit.
function humanAge(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export async function run(inputs = {}) {
  const cfg = loadConfig(inputs.config);
  const mint = inputs.mint;
  if (!mint || typeof mint !== "string") throw new Error("mint (base58 address) is required");

  // --- authorities: read the mint account, insist it really is a mint ---
  const acct = await rpc(cfg.HELIUS_RPC_URL, "getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const value = acct?.value;
  if (!value) throw new Error(`account not found for mint ${mint}`);

  const program = programName(value.owner);
  if (!program) {
    // Owned by neither token program — not a token mint. Fail closed, do not guess.
    throw new Error(`account ${mint} is not an SPL token mint (owner ${value.owner})`);
  }
  const parsed = value.data?.parsed;
  if (!parsed || parsed.type !== "mint") {
    throw new Error(`account ${mint} is a ${parsed?.type || "non-parsed"} account, not a mint`);
  }
  const info = parsed.info || {};
  // mintAuthority / freezeAuthority are a base58 string when live, null when revoked.
  const mintAuthority = info.mintAuthority ?? null;
  const freezeAuthority = info.freezeAuthority ?? null;

  // --- age: oldest signature for the mint address ---
  const { oldest, scanned, truncated } = await oldestSignature(cfg.HELIUS_RPC_URL, mint);
  const caveats = [];

  let created_at = null;
  let created_slot = null;
  let oldest_signature = null;
  let age_seconds = null;
  let age = null;

  if (!oldest) {
    // No signatures at all — cannot establish an age. Report honestly rather than invent one.
    caveats.push("no signatures found for this mint address; creation time could not be established");
  } else {
    oldest_signature = oldest.signature ?? null;
    created_slot = oldest.slot ?? null;
    if (typeof oldest.blockTime === "number") {
      created_at = new Date(oldest.blockTime * 1000).toISOString();
      age_seconds = Math.floor(Date.now() / 1000) - oldest.blockTime;
      age = humanAge(age_seconds);
    } else {
      caveats.push("oldest signature has no blockTime; creation time could not be established");
    }
    if (truncated) {
      caveats.push(
        "signature scan hit the page cap before reaching the end; the reported age is a LOWER " +
          "bound (the true creation may be older)"
      );
    }
  }

  const mint_authority_revoked = mintAuthority === null;
  const freeze_authority_revoked = freezeAuthority === null;

  const authWord = (revoked, who, kind) =>
    revoked ? `${kind} authority revoked` : `${kind} authority live (${who})`;

  const reason =
    (created_at ? `created ${created_at}` : "creation time unknown") +
    (age ? ` (${age} old)` : "") +
    `; ${authWord(mint_authority_revoked, mintAuthority, "mint")}` +
    `; ${authWord(freeze_authority_revoked, freezeAuthority, "freeze")}` +
    `; ${program} program`;

  return {
    mint,
    program,
    oldest_signature,
    created_at,
    created_slot,
    age_seconds,
    age,
    mint_authority: mintAuthority,
    freeze_authority: freezeAuthority,
    mint_authority_revoked,
    freeze_authority_revoked,
    signatures_scanned: scanned,
    caveats,
    reason,
    checked_at: new Date().toISOString(),
  };
}

// Allow direct invocation: `node index.mjs '{"mint":"4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump"}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
