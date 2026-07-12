// siws.mjs — build and verify the Sign-In-With-Solana message that binds a
// GitHub id to a Solana wallet. This is the trust root of the whole gate.
//
// The signature proves control of the wallet's private key. Domain-binding stops a
// signature captured on a phishing site from being replayed against societyz.xyz.
// The single-use nonce stops the SAME signed message from being replayed twice.
// The github_id embedded in the message is what binds this key to that exact account:
// a valid signature over a message naming github_id=12345 proves the key-holder agreed
// to be linked to 12345, and to no one else. Impersonation would require forging an
// ed25519 signature, which is infeasible.

import { verifySignature } from "./crypto.mjs";

const CHAIN_ID = "solana:mainnet";
const VERSION = "1";

// Canonical message. The linking page and the verifier MUST build this identically,
// byte-for-byte, or the signature will not verify. Keep this the single source of truth.
export function buildSiwsMessage({
  domain,        // e.g. "societyz.xyz"
  uri,           // e.g. "https://societyz.xyz"
  wallet,        // base58 pubkey
  github_login,  // display only; github_id is the binding key
  github_id,     // numeric, OAuth-verified
  nonce,         // server-issued, single-use
  issuedAt,      // ISO8601
  expirationTime // ISO8601
}) {
  return [
    `${domain} wants you to sign in with your Solana account:`,
    `${wallet}`,
    ``,
    `Link this wallet to GitHub @${github_login} (id ${github_id}) for Society Z contribution.`,
    ``,
    `URI: ${uri}`,
    `Version: ${VERSION}`,
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    `Expiration Time: ${expirationTime}`,
  ].join("\n");
}

// Parse the fields back out of a signed message so we can check the bindings against
// what the caller claims. Tolerant of trailing content but strict on the fields we gate on.
export function parseSiwsMessage(message) {
  const lines = message.split("\n");
  const out = {};
  const head = lines[0]?.match(/^(\S+) wants you to sign in with your Solana account:$/);
  out.domain = head ? head[1] : null;
  out.wallet = lines[1]?.trim() || null;
  for (const line of lines) {
    const bind = line.match(/^Link this wallet to GitHub @(\S+) \(id (\d+)\)/);
    if (bind) { out.github_login = bind[1]; out.github_id = Number(bind[2]); }
    const field = line.match(/^([A-Za-z ]+): (.+)$/);
    if (field) {
      const k = field[1].trim();
      if (k === "URI") out.uri = field[2];
      else if (k === "Version") out.version = field[2];
      else if (k === "Chain ID") out.chainId = field[2];
      else if (k === "Nonce") out.nonce = field[2];
      else if (k === "Issued At") out.issuedAt = field[2];
      else if (k === "Expiration Time") out.expirationTime = field[2];
    }
  }
  return out;
}

// The verify function. Given the claimed github_id + wallet, the signed message, and the
// signature, prove: (1) signature is valid ed25519 for that wallet, (2) the message binds
// exactly that github_id, (3) the domain is ours, (4) the nonce is one we issued and is
// unused (single-use => no replay), (5) not expired.
//
// nonceStore: { consume(nonce) -> boolean }  // returns true exactly once per valid nonce.
// Pass a store whose consume() is a no-op-true when you are AUDITING (re-deriving the table
// from stored signatures) rather than accepting a fresh link.
export function verifyLink({
  github_id,
  wallet,
  message,
  signature,
  expectedDomain,
  nonceStore,
  now = new Date(),
}) {
  const reject = (code, detail) => ({ ok: false, code, detail });

  const parsed = parseSiwsMessage(message);

  // (3) domain must be ours — blocks cross-domain / phishing replay. Fail closed if the server
  // domain is not configured: an empty/unset expectedDomain must NOT silently disable domain
  // binding (e.g. when SOCIETY_Z_DOMAIN is missing from the environment).
  if (!parsed.domain) return reject("bad-message", "no domain line");
  if (!expectedDomain) return reject("no-expected-domain", "server expectedDomain not configured");
  if (parsed.domain !== expectedDomain) {
    return reject("wrong-domain", `message domain ${parsed.domain} != ${expectedDomain}`);
  }
  if (parsed.chainId && parsed.chainId !== CHAIN_ID) {
    return reject("wrong-chain", `chain ${parsed.chainId} != ${CHAIN_ID}`);
  }

  // Wallet in the message must match the wallet whose key we are checking.
  if (parsed.wallet !== wallet) {
    return reject("wallet-mismatch", `message wallet ${parsed.wallet} != claimed ${wallet}`);
  }

  // (2) github_id binding — the whole point. Signature is over a message naming this id.
  if (parsed.github_id !== Number(github_id)) {
    return reject("github-mismatch", `message github_id ${parsed.github_id} != claimed ${github_id}`);
  }

  // (5) expiry — require a present, parseable Expiration Time and fail closed otherwise, so an
  // attacker cannot omit or malform the field to obtain a signature that never expires.
  if (!parsed.expirationTime) return reject("no-expiry", "message has no expiration time");
  const exp = new Date(parsed.expirationTime);
  if (Number.isNaN(exp.getTime())) {
    return reject("bad-expiry", `unparseable expiration time ${parsed.expirationTime}`);
  }
  if (now.getTime() > exp.getTime()) {
    return reject("expired", `expired at ${parsed.expirationTime}`);
  }

  // (1) the cryptographic core. Verify the ed25519 signature over the EXACT message bytes.
  let sigValid;
  try {
    sigValid = verifySignature(message, signature, wallet);
  } catch (e) {
    return reject("bad-encoding", e.message);
  }
  if (!sigValid) return reject("bad-signature", "ed25519 signature does not verify for wallet");

  // (4) nonce single-use — replay protection. Consume AFTER signature is proven valid,
  // so a bad signature can never burn a good nonce.
  if (!parsed.nonce) return reject("no-nonce", "message has no nonce");
  if (nonceStore) {
    const fresh = nonceStore.consume(parsed.nonce);
    if (!fresh) return reject("replay", `nonce ${parsed.nonce} already used or never issued`);
  }

  return {
    ok: true,
    github_id: parsed.github_id,
    github_login: parsed.github_login,
    wallet: parsed.wallet,
    nonce: parsed.nonce,
  };
}
