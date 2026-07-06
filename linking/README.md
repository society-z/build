# linking — wallet ↔ GitHub, the trust root of the gate

This service proves that a Solana wallet belongs to a GitHub account, so the
[holder-gate](../.github/holder-gate/README.md) bot can answer one question at merge time:
**"does this PR author hold ≥ threshold $Z?"** It never touches keys or moves funds. The only
signature in the whole system is a member signing, in their own wallet, a message that binds
their GitHub id to that wallet.

> Membership can be bought; reputation cannot. Linking proves *who holds the key*, nothing more.

## Files

| File | What |
|---|---|
| `crypto.mjs` | dependency-free base58 + raw ed25519 verify (Node built-in `crypto`; no tweetnacl/bs58) |
| `siws.mjs` | build + parse + **verify** the Sign-In-With-Solana message (the crypto core) |
| `store.mjs` | append-only `links.jsonl` link store + single-use nonce store (swappable interface) |
| `link.mjs` | `linkAccount` (write), `walletForGithubId` / `githubIdForWallet` (bot reads), `auditLinks` |
| `test/link.test.mjs` | real ed25519 keypair generated in-test; valid / tampered / replay / domain / lookup / audit |

Run the tests: `node test/link.test.mjs` (or `npm run test:linking` from the repo root). No secrets, no network.

## The link record (append-only, auditable)

One JSON object per line in `links.jsonl`:

```json
{ "github_id": 12345, "github_login": "octo", "wallet": "<base58 pubkey>",
  "siws_message": "societyz.xyz wants you to sign in...", "siws_signature": "<base58 ed25519 sig>",
  "linked_at": "2026-07-06T..." }
```

**Auditability invariant:** the effective `github_id → wallet` table is fully re-derivable from
the stored `(siws_message, siws_signature)` pairs alone. `auditLinks()` re-verifies every row's
signature and binding and drops any row the signature does not justify — so even a tampered or
compromised DB collapses to exactly the rows the members actually signed. `linked_at` is
convenience metadata; the signatures are the source of truth. This is the mitigation for design
§7 "the link DB is a single point of trust."

**DB swap:** nothing outside `store.mjs` touches the file. Replace `createLinkStore` /
`createNonceStore` with a Supabase/Postgres-backed implementation of the same interface
(`readAll`, `append`, `walletForGithubId`, `githubIdForWallet` / `issue`, `consume`, `isIssued`)
and the rest is unchanged. The SQL table in [`.github/holder-gate/README.md`](../.github/holder-gate/README.md)
is that target schema.

## How verify proves ownership (and blocks replay / impersonation)

`verifyLink({ github_id, wallet, message, signature, expectedDomain, nonceStore })` returns
`{ ok: true, ... }` only if **all** hold:

1. **Key control** — the ed25519 `signature` verifies against `wallet` over the exact `message`
   bytes. Only the private-key holder can produce it; pasting a whale's address proves nothing.
2. **Identity binding** — the message contains `(id <github_id>)`, and it must equal the claimed
   `github_id`. A signature over a message naming id 777 cannot be replayed to link id 778.
   The claimed id comes from **GitHub OAuth**, never a self-typed username.
3. **Domain binding** — the first line names the domain; it must equal `societyz.xyz`. A signature
   phished on another site does not verify here.
4. **Replay protection** — the `Nonce` must be one we issued and unused. It is consumed **after**
   the signature is proven valid, so a bad signature can never burn a good nonce (single-use).
5. **Freshness** — `Expiration Time` must be in the future.

Reject codes: `bad-signature`, `bad-encoding`, `github-mismatch`, `wallet-mismatch`,
`wrong-domain`, `wrong-chain`, `replay`, `no-nonce`, `expired`, `wallet-taken`.

## The user flow (linking page — `link.societyz.xyz`)

1. **Sign in with GitHub** → GitHub OAuth (`read:user` scope only). The callback yields the
   OAuth-verified numeric `github_id` + `github_login`. **Trust the OAuth id, never a typed name.**
2. **Connect wallet** → Phantom / any Wallet-Standard wallet. Get the base58 `wallet` pubkey.
3. **Server issues a nonce** (`issueNonce()`), builds the SIWS message with `buildSiwsMessage(...)`,
   returns it to the page.
4. **Wallet signs** the message (`signIn` / `signMessage`). Page POSTs
   `{ github_id, github_login, wallet, message, signature }` to `/api/link`.
5. **Server verifies + stores** via `linkAccount(...)`. On `ok`, the row is appended; the bot can
   now resolve this author. On failure, show the reject code.

### Next.js route sketch (`app/api/link/route.ts`)

```ts
import { NextResponse } from "next/server";
import { issueNonce, buildSiwsMessage, linkAccount } from "@/linking/link.mjs";

// GET /api/link/nonce?github_login=octo&github_id=123&wallet=<pubkey>
// -> returns the exact message the wallet must sign (nonce is server-issued + single-use).
export async function GET(req: Request) {
  const u = new URL(req.url);
  // github_id/login come from the signed OAuth session cookie, NOT the query, in prod.
  const nonce = issueNonce();
  const message = buildSiwsMessage({
    domain: process.env.SOCIETY_Z_DOMAIN!, uri: `https://${process.env.SOCIETY_Z_DOMAIN}`,
    wallet: u.searchParams.get("wallet")!,
    github_login: session.login, github_id: session.id,
    nonce, issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  return NextResponse.json({ message });
}

// POST /api/link  { wallet, message, signature }
export async function POST(req: Request) {
  const { wallet, message, signature } = await req.json();
  const res = linkAccount({
    github_id: session.id, github_login: session.login,  // from OAuth session, authoritative
    wallet, message, signature,
    domain: process.env.SOCIETY_Z_DOMAIN,
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
```

A plain-HTML equivalent works too: the only browser-side requirement is a Wallet-Standard
`signMessage` over the server-issued message, then a POST. No framework is load-bearing.

## Launch config (env placeholders — never commit real values)

| Var | What | Who provides |
|---|---|---|
| `SOCIETY_Z_DOMAIN` | the domain bound into every SIWS message (default `societyz.xyz`) | Andy (launch domain) |
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App client id | **Andy** — create the OAuth App |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App client secret | **Andy** — set in host env, never in repo |
| `LINK_DB_URL` / `LINK_DB_SERVICE_KEY` | when swapping jsonl → Supabase | maintainer |

This module does **not** implement the OAuth server — that is intentionally a sketch. The real,
security-critical code here is the cryptographic **verify** plus the auditable store/lookup. Wire
the OAuth callback to populate `session.id` / `session.login`, and pass those (never client input)
into `linkAccount`.
