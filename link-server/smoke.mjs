// smoke.mjs — end-to-end smoke test for the GitHub-OAuth link server.
//
// Proves the SECURITY layer this server adds on top of the (already-tested) SIWS crypto:
//   1. /api/auth/github mints a CSRF state, sets it as an HttpOnly+Secure+SameSite=Lax cookie,
//      and 302-redirects to GitHub with that same state in the Location.
//   2. /api/auth/callback REJECTS a request whose state is missing / wrong / not the cookie.
//   3. a valid callback (mocked GitHub token + /user) sets a valid, HMAC-signed session cookie
//      and never trusts a client-supplied identity — only GitHub's /user answer.
//   4. /api/session returns the right {id, login} ONLY for a valid session cookie, and rejects
//      a tampered/forged one.
//   5. /api/link rejects a request with no session.
//   6. /api/link uses the SESSION github_id, NOT any github_id in the body: a valid SIWS message
//      bound to the session id links successfully even when the body carries a DECOY github_id —
//      proving the body id is ignored and the session id is authoritative.
//
// No network: the server's outbound calls to github.com / api.github.com are stubbed by
// replacing globalThis.fetch. The test's OWN http client uses node:http, so it is never stubbed.
// No real member data: LINK_DB_PATH / NONCE_DB_PATH point at a throwaway temp dir.
//
// Run: node smoke.mjs   (exits 0 on pass)

import { request as httpRequest } from "node:http";
import { generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// --- configure the server via env BEFORE importing it (CFG is read at module load) ----------
const tmp = mkdtempSync(join(tmpdir(), "society-z-linksrv-"));
process.env.GITHUB_OAUTH_CLIENT_ID = "Iv1.testclientid";
process.env.GITHUB_OAUTH_CLIENT_SECRET = "testsecret-should-never-leave-server";
process.env.SESSION_SECRET = "smoke-test-session-secret-0123456789abcdef";
process.env.SOCIETY_Z_DOMAIN = "societyz.xyz";
process.env.PUBLIC_BASE_URL = "https://link.societyz.xyz";
process.env.LINK_DB_PATH = join(tmp, "links.jsonl");
process.env.NONCE_DB_PATH = join(tmp, "nonces.jsonl");
// secure cookies ON (default) so we can assert the Secure attribute; the raw client below does
// not enforce Secure, it just echoes cookies back.

const { createLinkServer } = await import("./server.mjs");
const { buildSiwsMessage } = await import("../linking/link.mjs");
const { bs58encode } = await import("../linking/crypto.mjs");

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log("  ok:", msg);
  else { console.error("  FAIL:", msg); failed++; }
};

// --- minimal raw http client (never the stubbed global fetch) -------------------------------
function req(port, method, path, { cookie, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(typeof body === "string" ? body : JSON.stringify(body)) : null;
    const r = httpRequest(
      { host: "127.0.0.1", port, method, path,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(payload ? { "content-type": "application/json", "content-length": payload.length } : {}),
        } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"] || [];
          const jar = {};
          for (const sc of setCookie) {
            const [pair] = sc.split(";");
            const i = pair.indexOf("=");
            jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
          }
          let json = null;
          try { json = data ? JSON.parse(data) : null; } catch {}
          resolve({ status: res.statusCode, headers: res.headers, setCookie, jar, body: data, json });
        });
      }
    );
    r.on("error", reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// --- mock GitHub: token exchange + /user. Records that client_secret is used server-side. ----
let capturedTokenBody = null;
function stubGitHub({ user = { id: 424242, login: "testholder" }, token = "gho_smoketoken", tokenOk = true, userOk = true } = {}) {
  globalThis.fetch = async (url, opts = {}) => {
    if (String(url) === "https://github.com/login/oauth/access_token") {
      capturedTokenBody = JSON.parse(opts.body);
      return { ok: true, status: 200, json: async () => (tokenOk ? { access_token: token } : { error: "bad_verification_code" }) };
    }
    if (String(url) === "https://api.github.com/user") {
      return { ok: userOk, status: userOk ? 200 : 401, json: async () => user, text: async () => "err" };
    }
    throw new Error("unexpected fetch to " + url);
  };
}

// --- ed25519 wallet, Solana-style (same construction as linking/test/link.test.mjs) ---------
function makeWallet() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const address = bs58encode(spki.subarray(spki.length - 32));
  const signMessage = (message) => bs58encode(nodeSign(null, Buffer.from(new TextEncoder().encode(message)), privateKey));
  return { address, signMessage };
}

// --- boot the server on an ephemeral port ---------------------------------------------------
const server = createLinkServer();
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
console.log(`server on :${port}\n`);

try {
  // 1. /api/auth/github: 302, Set-Cookie state, Location carries the same state --------------
  console.log("1. /api/auth/github mints CSRF state (cookie + redirect)");
  const start = await req(port, "GET", "/api/auth/github");
  assert(start.status === 302, "responds 302 redirect");
  const loc = start.headers.location || "";
  assert(loc.startsWith("https://github.com/login/oauth/authorize"), "redirects to GitHub authorize");
  const locState = new URL(loc).searchParams.get("state");
  assert(!!locState, "Location carries a state param");
  assert(new URL(loc).searchParams.get("scope") === "read:user", "requests read:user scope only");
  const stateCookie = start.jar.sz_oauth_state;
  assert(!!stateCookie, "sets sz_oauth_state cookie");
  assert(stateCookie === locState, "cookie state == redirect state (double-submit)");
  const rawStateSC = start.setCookie.find((c) => c.startsWith("sz_oauth_state"));
  assert(/HttpOnly/i.test(rawStateSC), "state cookie is HttpOnly");
  assert(/Secure/i.test(rawStateSC), "state cookie is Secure");
  assert(/SameSite=Lax/i.test(rawStateSC), "state cookie is SameSite=Lax");
  assert(locState.length >= 32, "state is high-entropy (>=32 hex chars)");

  // 2. callback rejects bad CSRF state -------------------------------------------------------
  console.log("\n2. /api/auth/callback rejects bad/missing CSRF state");
  stubGitHub();
  const noState = await req(port, "GET", "/api/auth/callback?code=abc");
  assert(noState.status === 400 && noState.json?.error === "bad-state", "no state at all -> 400 bad-state");

  const wrongCookie = await req(port, "GET", `/api/auth/callback?code=abc&state=${locState}`, { cookie: "sz_oauth_state=DIFFERENT" });
  assert(wrongCookie.status === 400 && wrongCookie.json?.error === "bad-state", "query state != cookie state -> 400 bad-state");

  const forgedState = await req(port, "GET", "/api/auth/callback?code=abc&state=deadbeef", { cookie: "sz_oauth_state=deadbeef" });
  assert(forgedState.status === 400 && forgedState.json?.error === "bad-state", "state matches cookie but was never server-issued -> 400 (server-side check)");

  // 3. valid callback: mint a fresh state, then complete it with mocked GitHub ---------------
  console.log("\n3. valid callback sets a signed session (identity from GitHub /user only)");
  const s2 = await req(port, "GET", "/api/auth/github");
  const st2 = s2.jar.sz_oauth_state;
  stubGitHub({ user: { id: 424242, login: "testholder" } });
  const cb = await req(port, "GET", `/api/auth/callback?code=goodcode&state=${st2}`, { cookie: `sz_oauth_state=${st2}` });
  assert(cb.status === 302 && cb.headers.location === "/link", "valid callback 302 -> /link");
  const sessionCookie = cb.jar.sz_session;
  assert(!!sessionCookie, "sets sz_session cookie");
  const rawSessionSC = cb.setCookie.find((c) => c.startsWith("sz_session"));
  assert(/HttpOnly/i.test(rawSessionSC) && /Secure/i.test(rawSessionSC) && /SameSite=Lax/i.test(rawSessionSC), "session cookie is HttpOnly+Secure+SameSite=Lax");
  assert(capturedTokenBody?.client_secret === "testsecret-should-never-leave-server", "client_secret was sent ONLY in the server-side token exchange");
  // single-use state: replay the same callback must now fail (state already consumed).
  const replayCb = await req(port, "GET", `/api/auth/callback?code=goodcode&state=${st2}`, { cookie: `sz_oauth_state=${st2}` });
  assert(replayCb.status === 400 && replayCb.json?.error === "bad-state", "state is single-use: replayed callback rejected");

  // 4. /api/session honors only a valid cookie ----------------------------------------------
  console.log("\n4. /api/session: valid cookie only");
  const sess = await req(port, "GET", "/api/session", { cookie: `sz_session=${sessionCookie}` });
  assert(sess.status === 200 && sess.json?.id === 424242 && sess.json?.login === "testholder", "returns verified {id, login} for a valid session");
  assert(sess.json?.domain === "societyz.xyz", "returns the server domain for SIWS building");

  const noSess = await req(port, "GET", "/api/session");
  assert(noSess.status === 401, "no cookie -> 401");

  // tamper: flip the last char of the signature segment
  const tampered = sessionCookie.slice(0, -1) + (sessionCookie.slice(-1) === "A" ? "B" : "A");
  const bad = await req(port, "GET", "/api/session", { cookie: `sz_session=${tampered}` });
  assert(bad.status === 401, "tampered/forged session -> 401 (HMAC rejects)");

  // forged payload with a valid-looking structure but no correct signature
  const forgedPayload = Buffer.from(JSON.stringify({ id: 999, login: "attacker", issued_at: Date.now(), expires_at: Date.now() + 1e9 })).toString("base64url");
  const forgedToken = `${forgedPayload}.${Buffer.from("not-a-real-hmac").toString("base64url")}`;
  const forged = await req(port, "GET", "/api/session", { cookie: `sz_session=${forgedToken}` });
  assert(forged.status === 401, "forged unsigned session -> 401");

  // 5. /api/link rejects no session ----------------------------------------------------------
  console.log("\n5. /api/link requires a session");
  const noAuthLink = await req(port, "GET", "/api/nonce"); // also proves nonce needs auth
  assert(noAuthLink.status === 401, "/api/nonce with no session -> 401");
  const link401 = await req(port, "POST", "/api/link", { body: { wallet: "x", siws_message: "y", siws_signature: "z" } });
  assert(link401.status === 401 && link401.json?.error === "no-session", "/api/link with no session -> 401 no-session");

  // 6. /api/link uses the SESSION github_id, never the body github_id ------------------------
  console.log("\n6. /api/link binds the SESSION github_id, ignores body github_id");
  const wallet = makeWallet();
  // get a real, single-use nonce (auth required)
  const nres = await req(port, "GET", "/api/nonce", { cookie: `sz_session=${sessionCookie}` });
  assert(nres.status === 200 && !!nres.json?.nonce, "authenticated /api/nonce issues a nonce");
  const nonce = nres.json.nonce;
  // build the SIWS message bound to the SESSION id (424242), sign it
  const now = Date.now();
  const message = buildSiwsMessage({
    domain: "societyz.xyz",
    uri: "https://societyz.xyz",
    wallet: wallet.address,
    github_login: "testholder",
    github_id: 424242,               // == the session id
    nonce,
    issuedAt: new Date(now).toISOString(),
    expirationTime: new Date(now + 10 * 60 * 1000).toISOString(),
  });
  const signature = wallet.signMessage(message);
  // POST with a DECOY github_id in the body. If the server (wrongly) used it, verifyLink would
  // return github-mismatch. If it uses the session id (correct), the link succeeds.
  const linked = await req(port, "POST", "/api/link", {
    cookie: `sz_session=${sessionCookie}`,
    body: { github_id: 111111, github_login: "attacker", wallet: wallet.address, siws_message: message, siws_signature: signature },
  });
  assert(linked.status === 200 && linked.json?.ok === true, "valid link with DECOY body github_id succeeds -> session id was used, body ignored");
  assert(linked.json?.record?.github_id === 424242, "stored record carries the SESSION github_id (424242), not the body's 111111");

  // control: a message bound to the DECOY id (not the session) must be rejected, proving the
  // server compares the signed message against the SESSION id, not the body.
  const nres2 = await req(port, "GET", "/api/nonce", { cookie: `sz_session=${sessionCookie}` });
  const decoyWallet = makeWallet();
  const decoyMsg = buildSiwsMessage({
    domain: "societyz.xyz", uri: "https://societyz.xyz", wallet: decoyWallet.address,
    github_login: "attacker", github_id: 111111, nonce: nres2.json.nonce,
    issuedAt: new Date(now).toISOString(), expirationTime: new Date(now + 6e5).toISOString(),
  });
  const decoySig = decoyWallet.signMessage(decoyMsg);
  const rejected = await req(port, "POST", "/api/link", {
    cookie: `sz_session=${sessionCookie}`,
    body: { github_id: 111111, wallet: decoyWallet.address, siws_message: decoyMsg, siws_signature: decoySig },
  });
  assert(rejected.status === 400 && rejected.json?.code === "github-mismatch",
    "message bound to a non-session id is rejected (github-mismatch) — session id is authoritative");
} finally {
  server.close();
}

console.log(`\n${failed ? `SMOKE FAIL (${failed})` : "ALL LINK-SERVER SMOKE TESTS PASS"}`);
process.exit(failed ? 1 : 0);
