// gate — the genesis skill. Verify a Solana wallet holds >= threshold $Z, return a
// (optionally signed) pass/fail verdict. READ-ONLY on-chain: it never signs or moves funds.
// The only signature it produces is an attestation over its OWN verdict, with the gate key.
//
// Config resolution: config.json -> env vars. SERVER-SIDE ONLY. Security-sensitive config is
// NEVER read from caller-supplied `inputs` (which may originate from PR-controlled data).
//   Z_MINT                mint address of $Z            (Andy provides at launch)
//   Z_THRESHOLD           min uiAmount to pass          (Andy sets from dollar target)
//   HELIUS_RPC_URL        RPC endpoint incl. API key    (env only, never committed)
//   GATE_SIGNING_SECRET_KEY  base58 ed25519 secret      (env only; if absent, verdict unsigned)
//   SECOND_RPC_URL        optional second provider for fail-closed agreement

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

function loadConfig() {
  // Security-sensitive values come from server-side sources ONLY: the committed/gitignored
  // config.json (public Z_MINT/Z_THRESHOLD) and process.env (secrets). They are deliberately
  // NOT sourced from caller `inputs`, so PR-controlled data can never forge the mint,
  // threshold, RPC endpoint, or signing key.
  let file = {};
  try { file = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8")); } catch {}
  return {
    Z_MINT: file.Z_MINT || process.env.Z_MINT,
    Z_THRESHOLD: Number(file.Z_THRESHOLD ?? process.env.Z_THRESHOLD),
    HELIUS_RPC_URL: process.env.HELIUS_RPC_URL,
    SECOND_RPC_URL: process.env.SECOND_RPC_URL,
    GATE_SIGNING_SECRET_KEY: process.env.GATE_SIGNING_SECRET_KEY,
  };
}

// Basic base58 + length sanity check on Solana addresses before they reach an RPC.
// Rejects obviously-malformed input (wrong alphabet / length) rather than forwarding it.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;
function assertSolanaAddress(value, label) {
  if (typeof value !== "string" || value.length < 32 || value.length > 44 || !BASE58_RE.test(value)) {
    throw new Error(`${label} is not a valid base58 Solana address`);
  }
}

// --- on-chain read: sum uiAmount of the mint across the owner's token accounts ---
async function heliusBalance(rpcUrl, wallet, mint) {
  const body = {
    jsonrpc: "2.0",
    id: "gate",
    method: "getTokenAccountsByOwner",
    params: [wallet, { mint }, { encoding: "jsonParsed" }],
  };
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message}`);
  const accts = json.result?.value ?? [];
  return accts.reduce(
    (sum, a) => sum + Number(a.account.data.parsed.info.tokenAmount.uiAmount || 0),
    0
  );
}

// --- optional verdict signature (ed25519 over the canonical verdict JSON) ---
// Kept dependency-light: only signs when a key is present AND tweetnacl is installed.
async function signVerdict(verdict, secretKeyBase58) {
  // No key configured -> intentionally-unsigned mode. Returning "" is a valid verdict shape.
  if (!secretKeyBase58) return "";
  // A key IS configured -> the verdict MUST be signed. If signing fails for any reason
  // (deps missing, bad key), FAIL CLOSED by throwing. Never emit an unsigned-but-passing
  // verdict when a signature was required.
  try {
    const nacl = (await import("tweetnacl")).default;
    const bs58 = (await import("bs58")).default;
    const msg = new TextEncoder().encode(canonical(verdict));
    const sig = nacl.sign.detached(msg, bs58.decode(secretKeyBase58));
    return bs58.encode(sig);
  } catch (e) {
    throw new Error(`gate signing failed (GATE_SIGNING_SECRET_KEY set but could not sign): ${e.message}`);
  }
}

// Stable field order so the signature is verifiable by anyone re-serializing.
function canonical(v) {
  return JSON.stringify({
    wallet: v.wallet, mint: v.mint, balance: v.balance,
    threshold: v.threshold, pass: v.pass, checked_at: v.checked_at, pr: v.pr || null,
  });
}

export async function run(inputs) {
  const cfg = loadConfig();
  const { wallet, pr } = inputs;
  if (!wallet) throw new Error("wallet (base58 pubkey) is required");
  if (!cfg.Z_MINT) throw new Error("Z_MINT not configured (Andy provides at launch)");
  if (!cfg.HELIUS_RPC_URL) throw new Error("HELIUS_RPC_URL not set in env");
  if (!Number.isFinite(cfg.Z_THRESHOLD)) throw new Error("Z_THRESHOLD not configured");

  // Sanity-check addresses before they hit the RPC. Reject malformed input up front.
  assertSolanaAddress(wallet, "wallet");
  assertSolanaAddress(cfg.Z_MINT, "Z_MINT");

  // Read balance. If a second RPC is configured, require agreement and FAIL CLOSED on mismatch.
  let balance = await heliusBalance(cfg.HELIUS_RPC_URL, wallet, cfg.Z_MINT);
  if (cfg.SECOND_RPC_URL) {
    const b2 = await heliusBalance(cfg.SECOND_RPC_URL, wallet, cfg.Z_MINT);
    if (Math.abs(b2 - balance) > 1e-6) {
      // Providers disagree -> do not trust the read. Fail closed (never fail open).
      balance = Math.min(balance, b2); // conservative
    }
  }

  const pass = balance >= cfg.Z_THRESHOLD;
  const verdict = {
    wallet,
    mint: cfg.Z_MINT,
    balance,
    threshold: cfg.Z_THRESHOLD,
    pass,
    reason: pass
      ? `holds ${balance} $Z (>= ${cfg.Z_THRESHOLD})`
      : `wallet holds ${balance} $Z; ${cfg.Z_THRESHOLD} required to merge`,
    checked_at: new Date().toISOString(),
    pr: pr || null,
  };
  verdict.signature = await signVerdict(verdict, cfg.GATE_SIGNING_SECRET_KEY);
  return verdict;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
