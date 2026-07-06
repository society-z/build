// link.test.mjs — proves the linking trust root with real ed25519 signatures.
// No private keys from disk, no network. We generate a throwaway Solana-style keypair
// in-process with Node's built-in crypto, sign a real SIWS message, and assert:
//   1. a valid SIWS signature links successfully
//   2. a tampered signature is rejected
//   3. a replayed nonce is rejected
//   4. lookup returns the right wallet (and reverse lookup the right github id)
//   5. wrong-domain is rejected
//   6. the table is re-derivable from stored signatures alone (audit)
//
// Run: node test/link.test.mjs

import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bs58encode, verifySignature } from "../crypto.mjs";
import { buildSiwsMessage } from "../siws.mjs";
import { createLinkStore, memoryNonceStore } from "../store.mjs";
import { linkAccount, walletForGithubId, githubIdForWallet, auditLinks } from "../link.mjs";

let failed = 0;
const assert = (cond, msg) => {
  if (cond) { console.log("  ok:", msg); }
  else { console.error("  FAIL:", msg); failed++; }
};

// --- make a throwaway Solana-style ed25519 keypair -------------------------
// Export the raw 32-byte public key (last 32 bytes of the SPKI DER) and base58 it,
// exactly as a Solana wallet address is derived.
function makeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const rawPub = spki.subarray(spki.length - 32);
  const address = bs58encode(rawPub);
  const signMessage = (message) => {
    const sig = nodeSign(null, Buffer.from(new TextEncoder().encode(message)), privateKey);
    return bs58encode(sig);
  };
  return { address, signMessage };
}

const DOMAIN = "societyz.xyz";

function freshEnv() {
  const dir = mkdtempSync(join(tmpdir(), "society-z-link-"));
  const linkStore = createLinkStore({ path: join(dir, "links.jsonl") });
  return { linkStore };
}

function makeSignedLink({ wallet, github_id, github_login, nonce, expMinutes = 10 }) {
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + expMinutes * 60_000).toISOString();
  const message = buildSiwsMessage({
    domain: DOMAIN,
    uri: `https://${DOMAIN}`,
    wallet: wallet.address,
    github_login,
    github_id,
    nonce,
    issuedAt,
    expirationTime,
  });
  return { message, signature: wallet.signMessage(message) };
}

console.log("crypto sanity");
{
  const w = makeWallet();
  const msg = "hello society z";
  const sig = w.signMessage(msg);
  assert(verifySignature(msg, sig, w.address) === true, "self-signed message verifies");
  assert(verifySignature("tampered", sig, w.address) === false, "different message does not verify");
}

console.log("\n1. valid SIWS signature links successfully");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  const { message, signature } = makeSignedLink({ wallet, github_id: 12345, github_login: "octo", nonce });

  const res = linkAccount({ github_id: 12345, github_login: "octo", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === true, "valid link accepted");
  assert(res.record.wallet === wallet.address, "stored wallet matches signer");
  assert(res.record.siws_signature === signature, "signature stored for audit");
}

console.log("\n2. tampered signature is rejected");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  const { message, signature } = makeSignedLink({ wallet, github_id: 22222, github_login: "mallory", nonce });

  // Flip one base58 char of the signature.
  const bad = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  const res = linkAccount({ github_id: 22222, github_login: "mallory", wallet: wallet.address, message, signature: bad, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === false, "tampered signature rejected");
  assert(res.code === "bad-signature" || res.code === "bad-encoding", `rejected with crypto reason (${res.code})`);
  assert(nonceStore.isIssued(nonce) === true, "nonce NOT burned by a bad signature");
}

console.log("\n3. impersonation (sign for a different github_id) is rejected");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  // Wallet signs a message binding github_id=777, but attacker claims github_id=778.
  const { message, signature } = makeSignedLink({ wallet, github_id: 777, github_login: "real", nonce });
  const res = linkAccount({ github_id: 778, github_login: "real", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === false && res.code === "github-mismatch", "claimed github_id must match the signed one");
}

console.log("\n4. replayed nonce is rejected");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  const { message, signature } = makeSignedLink({ wallet, github_id: 33333, github_login: "repeat", nonce });

  const first = linkAccount({ github_id: 33333, github_login: "repeat", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(first.ok === true, "first use of nonce accepted");
  const second = linkAccount({ github_id: 33333, github_login: "repeat", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(second.ok === false && second.code === "replay", "same signed message replayed is rejected (nonce single-use)");
}

console.log("\n5. wrong-domain is rejected");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  // Message built for a phishing domain; wallet signs it; attacker submits to us.
  const issuedAt = new Date().toISOString();
  const expirationTime = new Date(Date.now() + 600_000).toISOString();
  const message = buildSiwsMessage({ domain: "evil.example", uri: "https://evil.example", wallet: wallet.address, github_login: "victim", github_id: 44444, nonce, issuedAt, expirationTime });
  const signature = wallet.signMessage(message);
  const res = linkAccount({ github_id: 44444, github_login: "victim", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === false && res.code === "wrong-domain", "signature captured on another domain cannot link here");
}

console.log("\n6. expired message is rejected");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const nonce = nonceStore.issue();
  const { message, signature } = makeSignedLink({ wallet, github_id: 55555, github_login: "late", nonce, expMinutes: -1 });
  const res = linkAccount({ github_id: 55555, github_login: "late", wallet: wallet.address, message, signature, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === false && res.code === "expired", "expired SIWS message rejected");
}

console.log("\n7. lookup returns the right wallet + reverse lookup");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const alice = makeWallet(), bob = makeWallet();
  const aNonce = nonceStore.issue(), bNonce = nonceStore.issue();
  const a = makeSignedLink({ wallet: alice, github_id: 111, github_login: "alice", nonce: aNonce });
  const b = makeSignedLink({ wallet: bob, github_id: 222, github_login: "bob", nonce: bNonce });
  linkAccount({ github_id: 111, github_login: "alice", wallet: alice.address, message: a.message, signature: a.signature, domain: DOMAIN, linkStore, nonceStore });
  linkAccount({ github_id: 222, github_login: "bob", wallet: bob.address, message: b.message, signature: b.signature, domain: DOMAIN, linkStore, nonceStore });

  assert(walletForGithubId(111, linkStore) === alice.address, "walletForGithubId(111) -> alice");
  assert(walletForGithubId(222, linkStore) === bob.address, "walletForGithubId(222) -> bob");
  assert(walletForGithubId(999, linkStore) === null, "unlinked github id -> null (bot fails closed)");
  assert(githubIdForWallet(bob.address, linkStore) === 222, "githubIdForWallet(bob) -> 222");
}

console.log("\n8. one wallet cannot be linked to two github ids");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const wallet = makeWallet();
  const n1 = nonceStore.issue(), n2 = nonceStore.issue();
  const first = makeSignedLink({ wallet, github_id: 101, github_login: "one", nonce: n1 });
  linkAccount({ github_id: 101, github_login: "one", wallet: wallet.address, message: first.message, signature: first.signature, domain: DOMAIN, linkStore, nonceStore });
  const second = makeSignedLink({ wallet, github_id: 102, github_login: "two", nonce: n2 });
  const res = linkAccount({ github_id: 102, github_login: "two", wallet: wallet.address, message: second.message, signature: second.signature, domain: DOMAIN, linkStore, nonceStore });
  assert(res.ok === false && res.code === "wallet-taken", "same wallet -> different github id is rejected");
}

console.log("\n9. table is re-derivable from stored signatures alone (audit)");
{
  const { linkStore } = freshEnv();
  const nonceStore = memoryNonceStore();
  const alice = makeWallet();
  const nonce = nonceStore.issue();
  const a = makeSignedLink({ wallet: alice, github_id: 111, github_login: "alice", nonce });
  linkAccount({ github_id: 111, github_login: "alice", wallet: alice.address, message: a.message, signature: a.signature, domain: DOMAIN, linkStore, nonceStore });

  // Simulate a DB tamper: append a forged row whose signature does NOT verify.
  linkStore.append({ github_id: 111, github_login: "alice", wallet: "AttackerWa11etDoesNotOwnThisKey11111111111", siws_message: a.message, siws_signature: a.signature, linked_at: new Date().toISOString() });

  const { table, invalid } = auditLinks({ linkStore, domain: DOMAIN });
  assert(table.get(111) === alice.address, "audit keeps only the signature-justified wallet for 111");
  assert(invalid.some((r) => r.wallet.startsWith("AttackerWa11et")), "forged/tampered row is reported invalid");
}

console.log(`\n${failed ? `SMOKE FAIL (${failed})` : "ALL LINKING TESTS PASS"}`);
process.exit(failed ? 1 : 0);
