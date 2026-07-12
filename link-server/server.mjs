// server.mjs — the GitHub-OAuth front door for Society Z wallet linking.
//
// This is the piece linking/README.md deliberately left as a sketch: the OAuth
// server that proves a linker actually controls the GitHub account they claim.
// The cryptographic trust root (SIWS verify + auditable store) already exists in
// ../linking/. This server only ADDS the OAuth identity + session + CSRF layer and
// then hands the SESSION-VERIFIED github_id to the existing linkAccount().
//
// It never trusts a github_id from the browser. The only github_id that ever reaches
// linkAccount() comes out of a server-verified, HMAC-signed session cookie whose value
// was set from GitHub's own /user API response for a token WE exchanged server-side.
//
// Runs standalone on a persistent host:  node server.mjs   (see README.md)
// Plain node:http, zero framework, zero runtime dependencies beyond ../linking/.

import { createServer } from "node:http";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { issueNonce, linkAccount } from "../linking/link.mjs";
import { createLinkStore, createNonceStore } from "../linking/store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// --- config (everything sensitive comes from env; nothing is committed) --------------------
const CFG = {
  clientId: process.env.GITHUB_OAUTH_CLIENT_ID || "",
  clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  domain: process.env.SOCIETY_Z_DOMAIN || "societyz.xyz",
  // Public origin of THIS server, used to build the OAuth redirect_uri. Must exactly match the
  // callback URL registered on the GitHub OAuth App. Falls back to the request Host header.
  publicBaseUrl: process.env.PUBLIC_BASE_URL || "",
  port: Number(process.env.PORT || 8787),
  // Cookie Secure flag. On (default) for prod/https. Set INSECURE_COOKIES=1 for local http dev.
  secureCookies: process.env.INSECURE_COOKIES ? false : true,
};

const STATE_TTL_MS = 10 * 60 * 1000; // OAuth CSRF state lives 10 minutes
const SESSION_TTL_MS = 60 * 60 * 1000; // signed session lives 1 hour

// Stores. Injectable via env paths so the smoke test stays hermetic; default to the real
// jsonl files inside ../linking/ (same swappable interface documented in store.mjs).
const linkStore = createLinkStore(process.env.LINK_DB_PATH ? { path: process.env.LINK_DB_PATH } : {});
const nonceStore = createNonceStore(process.env.NONCE_DB_PATH ? { path: process.env.NONCE_DB_PATH } : {});

// --- CSRF state store: in-memory, single-use, short TTL ------------------------------------
// NOTE: in-memory ON PURPOSE. This binds the server to a single persistent process (see README).
// A multi-instance deployment must move this to Redis/DB, same swap pattern as store.mjs.
const stateStore = new Map(); // state -> { expires }
function putState(state) {
  stateStore.set(state, { expires: Date.now() + STATE_TTL_MS });
}
function takeState(state) {
  // Single-use: consume on read. Returns true only for a live, unexpired, previously-issued state.
  const rec = stateStore.get(state);
  if (!rec) return false;
  stateStore.delete(state); // consume immediately, even if expired, so it can never be reused
  return Date.now() <= rec.expires;
}
// Opportunistic sweep so an idle server does not leak abandoned states forever.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of stateStore) if (now > v.expires) stateStore.delete(k);
}, STATE_TTL_MS).unref?.();

// --- base64url ------------------------------------------------------------------------------
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const b64urlToBuf = (str) => Buffer.from(str, "base64url");

// --- signed session (HMAC-SHA256 over the payload) -----------------------------------------
// Token format:  base64url(JSON payload) + "." + base64url(HMAC)
// payload = { id, login, issued_at, expires_at }.  Expiry is enforced server-side on every read.
function hmac(payloadB64) {
  return createHmac("sha256", CFG.sessionSecret).update(payloadB64).digest();
}
function makeSession({ id, login }) {
  const now = Date.now();
  const payload = { id, login, issued_at: now, expires_at: now + SESSION_TTL_MS };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = b64url(hmac(payloadB64));
  return `${payloadB64}.${sig}`;
}
// Returns { id, login } for a valid, unexpired, untampered token, else null. Never throws.
function readSession(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  let expected, given;
  try {
    expected = hmac(payloadB64);
    given = b64urlToBuf(sigB64);
  } catch {
    return null;
  }
  // Constant-time compare; length-guard first (timingSafeEqual throws on length mismatch).
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(b64urlToBuf(payloadB64).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.expires_at !== "number" || Date.now() > payload.expires_at) return null; // expired
  if (typeof payload.id !== "number" || !payload.login) return null;
  return { id: payload.id, login: payload.login };
}

// --- cookies --------------------------------------------------------------------------------
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function cookie(name, value, { maxAge } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (CFG.secureCookies) bits.push("Secure");
  if (typeof maxAge === "number") bits.push(`Max-Age=${maxAge}`);
  return bits.join("; ");
}
function clearCookie(name) {
  const bits = [`${name}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (CFG.secureCookies) bits.push("Secure");
  return bits.join("; ");
}

// --- request base URL (for redirect_uri) ----------------------------------------------------
function baseUrl(req) {
  if (CFG.publicBaseUrl) return CFG.publicBaseUrl.replace(/\/$/, "");
  // Fallback: reconstruct from headers. HTTPS assumed in prod behind a TLS terminator.
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${CFG.port}`;
  const proto = req.headers["x-forwarded-proto"] || (CFG.secureCookies ? "https" : "http");
  return `${proto}://${host}`;
}

// --- small response helpers -----------------------------------------------------------------
function json(res, status, obj, extraHeaders = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...extraHeaders });
  res.end(body);
}
function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { location, ...extraHeaders });
  res.end();
}
function serveFile(res, name, type) {
  try {
    const body = readFileSync(join(HERE, name));
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
}
function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let data = "";
    let over = false;
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > limit) {
        over = true;
        req.destroy();
      }
    });
    req.on("end", () => (over ? reject(new Error("body too large")) : resolve(data)));
    req.on("error", reject);
  });
}

// --- session from request -------------------------------------------------------------------
function sessionFromReq(req) {
  const cookies = parseCookies(req.headers.cookie);
  return readSession(cookies.sz_session);
}

// --- routes ---------------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, "http://internal");
  const path = url.pathname;
  const method = req.method || "GET";

  // GET / — landing page
  if (method === "GET" && path === "/") {
    return serveFile(res, "index.html", "text/html; charset=utf-8");
  }

  // GET /healthz — liveness (no secrets)
  if (method === "GET" && path === "/healthz") {
    return json(res, 200, { ok: true, domain: CFG.domain, configured: !!(CFG.clientId && CFG.sessionSecret) });
  }

  // GET /api/auth/github — start OAuth: mint CSRF state, set it as a cookie, redirect to GitHub.
  if (method === "GET" && path === "/api/auth/github") {
    if (!CFG.clientId) return json(res, 500, { error: "oauth-not-configured" });
    const state = randomBytes(32).toString("hex");
    putState(state);
    const redirectUri = `${baseUrl(req)}/api/auth/callback`;
    const authorize =
      "https://github.com/login/oauth/authorize?" +
      new URLSearchParams({
        client_id: CFG.clientId,
        redirect_uri: redirectUri,
        scope: "read:user",
        state,
        allow_signup: "false",
      }).toString();
    // Double-submit: state lives BOTH server-side (stateStore) AND in this HttpOnly cookie.
    return redirect(res, authorize, {
      "set-cookie": cookie("sz_oauth_state", state, { maxAge: STATE_TTL_MS / 1000 }),
    });
  }

  // GET /api/auth/callback — the security-critical exchange.
  if (method === "GET" && path === "/api/auth/callback") {
    const code = url.searchParams.get("code");
    const qState = url.searchParams.get("state");
    const cookies = parseCookies(req.headers.cookie);
    const cState = cookies.sz_oauth_state;

    // CSRF: the query state must match the cookie (double-submit) AND be a live, single-use,
    // server-issued state. Consume it now so it can never be replayed (single-use), regardless
    // of outcome. RFC 6749 §10.12.
    const serverOk = qState ? takeState(qState) : false;
    const clearState = clearCookie("sz_oauth_state");
    if (!code || !qState || !cState || qState !== cState || !serverOk) {
      return json(res, 400, { error: "bad-state", detail: "CSRF state missing, mismatched, expired, or reused" }, { "set-cookie": clearState });
    }

    // Exchange code -> access token. client_secret is used ONLY here, server-side, never logged.
    let token;
    try {
      const redirectUri = `${baseUrl(req)}/api/auth/callback`;
      const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "user-agent": "society-z-link-server" },
        body: JSON.stringify({
          client_id: CFG.clientId,
          client_secret: CFG.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      });
      const tokenJson = await tokenRes.json();
      token = tokenJson.access_token;
      if (!token) {
        return json(res, 502, { error: "token-exchange-failed", detail: tokenJson.error || "no access_token" }, { "set-cookie": clearState });
      }
    } catch (e) {
      return json(res, 502, { error: "token-exchange-error" }, { "set-cookie": clearState });
    }

    // Fetch the VERIFIED identity. This is the ONLY source of github_id/login we ever trust.
    let ghUser;
    try {
      const userRes = await fetch("https://api.github.com/user", {
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/vnd.github+json",
          "user-agent": "society-z-link-server",
          "x-github-api-version": "2022-11-28",
        },
      });
      if (!userRes.ok) {
        return json(res, 502, { error: "user-fetch-failed", detail: userRes.status }, { "set-cookie": clearState });
      }
      ghUser = await userRes.json();
    } catch (e) {
      return json(res, 502, { error: "user-fetch-error" }, { "set-cookie": clearState });
    }
    if (typeof ghUser.id !== "number" || !ghUser.login) {
      return json(res, 502, { error: "user-fetch-malformed" }, { "set-cookie": clearState });
    }

    // Mint the signed session from GitHub's own answer, set it, drop the used state cookie,
    // and send them to the wallet-linking page.
    const session = makeSession({ id: ghUser.id, login: ghUser.login });
    res.writeHead(302, {
      location: "/link",
      "set-cookie": [clearState, cookie("sz_session", session, { maxAge: SESSION_TTL_MS / 1000 })],
    });
    return res.end();
  }

  // GET /link — the wallet-connect page. Requires a valid session; else back to /.
  if (method === "GET" && path === "/link") {
    const session = sessionFromReq(req);
    if (!session) return redirect(res, "/");
    return serveFile(res, "link.html", "text/html; charset=utf-8");
  }

  // GET /api/session — the verified identity, server-side from the cookie. Never client input.
  if (method === "GET" && path === "/api/session") {
    const session = sessionFromReq(req);
    if (!session) return json(res, 401, { error: "no-session" });
    // domain is included so the page builds the SIWS domain line to match SOCIETY_Z_DOMAIN.
    return json(res, 200, { id: session.id, login: session.login, domain: CFG.domain });
  }

  // GET /api/nonce — issue a real, single-use nonce from the linking nonce store. Auth required
  // so nonces are only minted for signed-in users.
  if (method === "GET" && path === "/api/nonce") {
    const session = sessionFromReq(req);
    if (!session) return json(res, 401, { error: "no-session" });
    const nonce = issueNonce(nonceStore);
    return json(res, 200, { nonce });
  }

  // POST /api/link — the write path. github_id comes ONLY from the verified session.
  if (method === "POST" && path === "/api/link") {
    const session = sessionFromReq(req);
    if (!session) return json(res, 401, { error: "no-session", detail: "sign in with GitHub first" });

    let body;
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return json(res, 400, { error: "bad-json" });
    }
    const { wallet, siws_message, siws_signature } = body || {};
    if (!wallet || !siws_message || !siws_signature) {
      return json(res, 400, { error: "missing-fields", detail: "wallet, siws_message, siws_signature required" });
    }

    // AUTHORITATIVE: github_id/login are taken from the session, NEVER from the body. Any
    // body.github_id / body.github_login is ignored entirely. The SIWS message must have been
    // built binding THIS session's id, or verifyLink returns github-mismatch.
    const result = linkAccount({
      github_id: session.id,
      github_login: session.login,
      wallet,
      message: siws_message,
      signature: siws_signature,
      domain: CFG.domain,
      linkStore,
      nonceStore,
    });

    return json(res, result.ok ? 200 : 400, result);
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
}

export function createLinkServer() {
  return createServer((req, res) => {
    handle(req, res).catch((e) => {
      // Never leak internals or secrets in an error body.
      if (!res.headersSent) json(res, 500, { error: "internal" });
      else try { res.end(); } catch {}
    });
  });
}

// Exported for tests.
export const _internal = { makeSession, readSession, CFG, stateStore };

// Start only when run directly (not when imported by the smoke test).
if (import.meta.url === `file://${process.argv[1]}`) {
  // Fail fast on missing secrets so a misconfigured host never runs a broken trust root.
  const missing = [];
  if (!CFG.clientId) missing.push("GITHUB_OAUTH_CLIENT_ID");
  if (!CFG.clientSecret) missing.push("GITHUB_OAUTH_CLIENT_SECRET");
  if (!CFG.sessionSecret) missing.push("SESSION_SECRET");
  if (missing.length) {
    console.error(`[link-server] refusing to start; missing env: ${missing.join(", ")}`);
    process.exit(1);
  }
  createLinkServer().listen(CFG.port, () => {
    console.log(`[link-server] listening on :${CFG.port} — domain ${CFG.domain}, secure cookies ${CFG.secureCookies}`);
  });
}
