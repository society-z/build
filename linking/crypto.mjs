// crypto.mjs — dependency-free ed25519 + base58 for Solana SIWS verification.
//
// Solana pubkeys/signatures are raw ed25519 bytes, base58-encoded. Node's built-in
// crypto verifies ed25519 but wants a KeyObject, so we wrap the raw 32-byte public key
// in the fixed SPKI DER header. No tweetnacl, no bs58, no @solana/web3.js — Node only.
// This keeps the trust root auditable with zero supply-chain surface.

import { createPublicKey, verify as nodeVerify } from "node:crypto";

// --- base58 (Bitcoin alphabet, as Solana uses) -----------------------------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = (() => {
  const m = new Int16Array(256).fill(-1);
  for (let i = 0; i < B58.length; i++) m[B58.charCodeAt(i)] = i;
  return m;
})();

export function bs58decode(str) {
  if (typeof str !== "string" || str.length === 0) throw new Error("bs58: empty input");
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = B58_MAP[str.charCodeAt(i)];
    if (val < 0) throw new Error(`bs58: invalid character '${str[i]}'`);
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  // leading '1's -> leading zero bytes
  for (let i = 0; i < str.length && str[i] === "1"; i++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function bs58encode(bytesLike) {
  const bytes = Uint8Array.from(bytesLike);
  if (bytes.length === 0) return "";
  const digits = [0];
  for (let i = 0; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  let out = "";
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += "1";
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
  return out;
}

// --- ed25519 verify over a raw 32-byte Solana public key -------------------
// SPKI DER prefix for an ed25519 public key (RFC 8410): 12 fixed bytes + the 32-byte key.
const ED25519_SPKI_PREFIX = Uint8Array.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function rawPubkeyToKeyObject(raw32) {
  if (raw32.length !== 32) throw new Error(`ed25519: pubkey must be 32 bytes, got ${raw32.length}`);
  const der = new Uint8Array(ED25519_SPKI_PREFIX.length + 32);
  der.set(ED25519_SPKI_PREFIX, 0);
  der.set(raw32, ED25519_SPKI_PREFIX.length);
  return createPublicKey({ key: Buffer.from(der), format: "der", type: "spki" });
}

// Verify a detached ed25519 signature. All args are base58 strings (pubkey, signature)
// plus the exact message string that was signed. Returns boolean; never throws on a
// bad signature (only on malformed encodings), so callers get a clean pass/fail.
export function verifySignature(message, signatureB58, publicKeyB58) {
  const raw = bs58decode(publicKeyB58);
  const sig = bs58decode(signatureB58);
  if (sig.length !== 64) throw new Error(`ed25519: signature must be 64 bytes, got ${sig.length}`);
  const key = rawPubkeyToKeyObject(raw);
  const msg = typeof message === "string" ? new TextEncoder().encode(message) : message;
  // ed25519 uses algorithm=null in Node's verify().
  return nodeVerify(null, Buffer.from(msg), key, Buffer.from(sig));
}
