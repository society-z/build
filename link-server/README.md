# link-server — the GitHub-OAuth front door for wallet linking

This is the piece [`../linking/README.md`](../linking/README.md) deliberately left as a sketch:
the OAuth server that **proves a linker actually controls the GitHub account they claim**, then
hands that verified `github_id` to the already-tested SIWS trust root (`../linking/link.mjs`).

Without this, nothing stops someone from linking a wallet to *another person's* GitHub id — the
crypto in `../linking/` verifies wallet control and the id binding, but it can only be as
trustworthy as the `github_id` it is handed. This server is where that id is made trustworthy: it
comes only from GitHub's own `/user` API for a token **we** exchanged server-side, carried in an
HMAC-signed session cookie. A `github_id` from the browser is never trusted.

```
browser ──"Sign in with GitHub"──▶ /api/auth/github ──302──▶ github.com/login/oauth/authorize
                                         │ (CSRF state: in-memory + cookie)
github ──code+state──▶ /api/auth/callback ──▶ exchange code (client_secret, server-side only)
                                         └─▶ GET api.github.com/user  ──▶ verified {id, login}
                                         └─▶ set HMAC-signed session cookie ──302──▶ /link
/link ──/api/session {id,login,domain}──▶ build SIWS msg (session id) ──wallet.signMessage──▶
       ──/api/link {wallet, siws_message, siws_signature}──▶ linkAccount(session id, …)  [../linking]
```

## Routes

| Route | What |
|---|---|
| `GET /` | Landing page (`index.html`) with a "Sign in with GitHub" button. |
| `GET /api/auth/github` | Mint a random CSRF `state`, store it server-side (10-min TTL) **and** as an HttpOnly+Secure+SameSite=Lax cookie, 302 to GitHub with `scope=read:user`. |
| `GET /api/auth/callback` | Verify `state` matches **both** the server store **and** the cookie (single-use); exchange `code`→token (client_secret used here only); call `/user`; mint an HMAC-signed session cookie; 302 to `/link`. |
| `GET /link` | Wallet-connect page (`link.html`). Redirects to `/` if not signed in. |
| `GET /api/session` | Returns `{ id, login, domain }` from the verified session cookie. Never client input. |
| `GET /api/nonce` | Issues a real single-use nonce from `../linking` (auth required). |
| `POST /api/link` | Takes `{ wallet, siws_message, siws_signature }`; uses the **session** `github_id` (never the body); calls `linkAccount` from `../linking/link.mjs`. |
| `GET /healthz` | Liveness; no secrets. |

## Security properties (verified by `smoke.mjs`)

- **Verified identity only.** `github_id`/`login` come solely from GitHub's `/user` response for a
  server-exchanged token. The callback never reads an identity from the client.
- **CSRF state (RFC 6749 §10.12).** `state` is 32 random bytes, stored server-side with a 10-min
  TTL **and** in a cookie (double-submit). The callback rejects if either is missing, mismatched,
  expired, or was never issued, and the state is **single-use** (consumed on the first callback,
  so a replayed callback fails).
- **client_secret stays server-side.** Used only in the token-exchange POST, never sent to the
  browser, never logged. The smoke test asserts it appears only in that server-side request body.
- **Signed sessions.** `base64url(payload).base64url(HMAC-SHA256(payload))` over
  `{ id, login, issued_at, expires_at }`. Verified with a constant-time compare and **expiry
  enforced on every read**. Tampered or forged cookies are rejected.
- **Session-authoritative linking.** `POST /api/link` takes `github_id` from the session, never
  the body. The smoke test proves a valid link with a **decoy** `github_id` in the body still
  binds the session id, and a message bound to a non-session id is rejected (`github-mismatch`).
- **Cookies** are `HttpOnly; Secure; SameSite=Lax; Path=/`.

## Env vars (nothing sensitive is committed)

| Var | Required | What |
|---|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | yes | GitHub OAuth App client id. |
| `GITHUB_OAUTH_CLIENT_SECRET` | yes | GitHub OAuth App client secret. Host env only, never in repo. |
| `SESSION_SECRET` | yes | HMAC key for session signing. Use a long random value; rotating it invalidates all sessions. |
| `SOCIETY_Z_DOMAIN` | no (default `societyz.xyz`) | Domain bound into every SIWS message; must match what `../linking` verifies. |
| `PUBLIC_BASE_URL` | recommended | Public origin of this server (e.g. `https://link.societyz.xyz`). Used to build `redirect_uri`, which must exactly match the OAuth App's registered callback URL. Falls back to the request `Host` header. |
| `PORT` | no (default `8787`) | Listen port. |
| `INSECURE_COOKIES` | no | Set to `1` for local http dev so cookies work without TLS. Leave unset in prod. |
| `LINK_DB_PATH` / `NONCE_DB_PATH` | no | Override the `../linking` jsonl paths (used by the smoke test for isolation). Defaults to the real files in `../linking/`. |

The GitHub OAuth App's **Authorization callback URL** must be `<PUBLIC_BASE_URL>/api/auth/callback`.

## Run

```bash
# prod (systemd/pm2), TLS terminated in front of it:
GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... SESSION_SECRET=... \
  PUBLIC_BASE_URL=https://link.societyz.xyz node server.mjs

# local dev over http:
INSECURE_COOKIES=1 GITHUB_OAUTH_CLIENT_ID=... GITHUB_OAUTH_CLIENT_SECRET=... \
  SESSION_SECRET=dev PUBLIC_BASE_URL=http://localhost:8787 node server.mjs

# smoke test (no network, no secrets, throwaway temp DB):
node smoke.mjs
```

The server refuses to start if `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, or
`SESSION_SECRET` are missing.

## Deployment note — persistent host, not serverless

This is a **stateful** server and must run as a single persistent process (systemd / pm2 / a
long-lived container), **not** on Vercel/Lambda/serverless. The CSRF-`state` store is an in-memory
`Map`, so a request that starts OAuth and the callback that finishes it must hit the **same**
process. On serverless (or any multi-instance/autoscaled deployment) the callback can land on a
different instance that never saw the state, and every login breaks.

To scale horizontally, move the state store — and the `../linking` nonce store — to a shared
backend (Redis `SETEX`/`GETDEL`, or a Postgres table with a TTL), exactly the swappable-interface
pattern documented in [`../linking/store.mjs`](../linking/store.mjs). Until then: one instance,
sticky, persistent.
