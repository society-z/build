# Security mechanisms v1 — designed, not built

This document exists so that `docs/canon/THESIS.md` (on the societyz.xyz site repo) is citing a
real artifact when it references these designs, not an unwitnessed conversation. Nothing in this
document is implemented. Each section states what's verified to exist in this repo today, the
concrete design, its effort estimate, and the residual risk that survives the design as specified.
If any of this is implemented, update this document to say so and link the PR — do not let this
file drift into implying something is live when it isn't.

## What's actually in this repo today (verified 2026-07-06)

- `linking/siws.mjs`, `linking/link.mjs`, `linking/store.mjs`, `linking/crypto.mjs` — a real
  Sign-In-With-Solana implementation. ed25519 signature verification, domain-bound message,
  single-use nonce. `linking/test/link.test.mjs` is a hand-rolled assertion test covering: valid
  link succeeds, tampered signature rejected, replayed nonce rejected, wallet/github_id lookup both
  directions, wrong-domain rejected, and the link table is re-derivable from stored signatures
  alone.
- `maintainer/links.mjs` — resolves a github_id to a SIWS-proven wallet. The `Link` shape already
  includes a `revoked` boolean field. `fileLinks()` is a working local-JSON-file stub; a
  `supabaseLinks()` real backend is documented as a TODO with the interface already fixed so the
  swap is a one-line change. **There is no revocation process, no event log, and no `invalid_since`
  concept today** — `revoked` is a single boolean with no defined writer.
- `maintainer/record.mjs` — a real, live, local append-only `record.jsonl`, sha256 prev_hash
  chained. The file's own header comment already states plainly: "A future external checkpoint
  (e.g. OpenTimestamps) can extend this later... Not built yet." This document does not
  contradict that; it specifies what "later" looks like.
- `skills/verify` — re-derives the hash chain from `record.jsonl` and reports whether it's intact.
  Proves internal consistency only. Does not prove today's copy is the same as yesterday's.
- `skills/gate` — checks whether a wallet holds enough $Z. No live token deployment yet.
- **Standing has no implementation anywhere in this repo.** No decay function, no computation, no
  spec file. Any past reference to a "STANDING.md" spec is incorrect — no such file exists as of
  this writing; do not cite it.
- Crest's own separate repo (`~/crest`) runs `crest.py anchor`, which calls
  `scripts/witness-chain.py`'s OpenTimestamps anchoring — this is a real, working pattern, verified
  by reading the code, not assumed. It is not wired into this repo.

## 1. Revocation after GitHub account takeover

**Problem:** a compromised GitHub account, linked to a wallet before the compromise, can have
attacker-authored PRs merged and credited to the victim's Standing. Today's `revoked` boolean has
no process: nobody writes it, nothing reads it at merge time.

**Design:** replace the boolean with an append-only `link_events` log (`LINK_CREATED`,
`LINK_SUSPENDED_PENDING_REATTESTATION`, `LINK_REVOKED`, `LINK_ROTATED`), hash-chained the same way
`record.jsonl` already is. Current status is a fold over the log, never a mutable field.

- Revocation requires a fresh SIWS signature from the wallet, never a GitHub-side action — the one
  asymmetry that favors the real owner, since an account-takeover attacker holds the GitHub
  session, not the Solana key.
- Merge-time link-status checks are fail-closed: unresolvable status (store unreachable, ambiguous
  state) means no Standing credit, not default-valid. This is the deliberate opposite of the
  soft-fail behavior that made real-world OCSP certificate revocation checking ineffective.
- `LINK_REVOKED` carries an `invalid_since` timestamp, independent of filing time, so a compromise
  discovered late can retroactively flag merges credited during the compromise window for
  clawback.
- Mandatory wallet re-attestation every 30 days bounds the worst case even when no evidence of
  compromise ever surfaces (the realistic version of this attack — a stolen session cookie —
  triggers none of GitHub's own security-event webhooks).

**Effort estimate:** 1-2 weeks. Extends `linking/` (new SIWS message type, same crypto) and
`maintainer/links.mjs` (event log instead of boolean) plus one new check in the merge path.

**Residual, after this ships:** a stolen session used carefully, inside the 30-day window, below
any anomaly threshold, produces Standing credit with no evidence to backdate a clawback against.
The claim is not "account takeover is solved." The claim is that exposure is bounded to
approximately one re-attestation cycle instead of unlimited.

## 2. External anchoring (proving history wasn't quietly rewritten)

**Problem:** `skills/verify` proves the chain is internally consistent. It cannot prove the chain
you're looking at today is the same chain that existed yesterday — a party with push access could
force-push a rewritten-but-internally-consistent history.

**Design:** a GitHub Action anchors the chain tip via OpenTimestamps on every push to `main`
(Bitcoin-anchored, free, no server to trust — the exact pattern Crest already runs via
`crest.py anchor`), plus a Rekor transparency-log entry as a second, independent public witness.
Once a tip is anchored in an already-mined Bitcoin block, a later rewrite cannot backdate past it.
`skills/verify` gains a step: check any anchored tip's OpenTimestamps proof against Bitcoin block
headers.

**Effort estimate:** 1-2 days. One GitHub Actions workflow, the `opentimestamps` npm client, ~30
lines added to the verify script.

**Residual, and it's structural, not a rounding error:** this only anchors what actually gets
pushed. It does nothing against a maintainer who drafts an inconvenient version locally and never
publishes it — pushing only a sanitized version from the start. That's cheaper and quieter than
rewriting published history, and anchoring is blind to it. Mitigation direction (not yet designed
or estimated): a member-submitted attestation channel for specific event types (disputes,
moderation actions, token transfers) that doesn't route through the maintainer, so silent omission
of those specific event types would leave a detectable gap. At genesis, with one member who is
also the maintainer, this channel has no independent submitters — the selective-silence exposure
is fully live until membership grows.

## 3. Sybil-resistant Standing (wash-building via multiple wallets)

**Problem:** if Standing counts raw usage/dependency edges, a funded actor can fund multiple
wallets, merge trivial work, and have them "depend on" each other to manufacture fake Standing.

**Design:** Standing as a seed-anchored trust propagation, EigenTrust-family, seeded only from
genesis contributors — never a uniform distribution across all wallets (uniform teleport is the
documented, provably farmable weakness of plain PageRank-style link scoring). A ring referencing
only itself has no path back to the seed and converges toward zero regardless of ring size. A
published, witnessed admission rule governs how a wallet earns a path into the trusted seed set. A
coarse anti-collusion discount is active from day one — not deferred until enough volume exists to
calibrate it, which would otherwise leave a zero-discount genesis window a patient attacker could
exploit legitimately.

**Effort estimate:** small — a few hundred lines, runnable inside the existing maintainer bot after
each merge.

**Residual:** seed capture. An attacker who legitimately clears the published admission bar with a
small number of real wallets gains a foothold to expand from; the day-one discount raises the cost
of that expansion without eliminating it. The admission rule is public on purpose (auditability
over obscurity), and the documented price of that choice is that a sophisticated attacker knows
exactly what bar to clear. At genesis, with one member, seed capture and capturing that one person
are the same event — this document names that plainly rather than treating it as a distant risk.

## 4. Non-transferable Standing (the wallet/key sale problem — and the real problem underneath it)

**Problem:** Standing binds to a wallet; wallets are keys; keys can be sold. A naive design lets
capital buy a high-Standing identity outright.

**Design:** Standing is never a token or balance — it's a read-function over an append-only
attestation ledger, dual-anchored to both the wallet and the GitHub account jointly. Moving it
requires controlling both; GitHub account sales independently violate GitHub's own terms of
service. Standing decays on a recency half-life, so a bought-and-dormant identity loses influence
unless its holder keeps producing real, reviewable, mergeable work under it.

**Effort estimate:** about a week, reusing the existing merge-path resolution code in
`maintainer/`.

**Residual — and this is the primary risk of this mechanism, not an edge case:** rental, not sale.
Nobody needs to buy an identity if they can pay its legitimate holder to act on their behalf. The
holder keeps full custody the entire time; the work is genuinely real and mergeable; and decay
actively helps this attacker, since it demands exactly the continuous genuine output a rental
arrangement is paying for. No non-transferable identity scheme in existence — soulbound tokens,
Gitcoin Passport, World ID — has solved this. The precise claim: capital structurally cannot buy
Standing, but it can rent Standing's effects through a labor market. No mitigation is currently
designed for this. It is an accepted, monitored exposure, not a solved one.

## 5. Capital-gate exclusion (early wealth compounding into durable advantage)

**Problem:** the $Z submission gate means wealthier, earlier participants build Standing sooner
and cheaper, compounding into an advantage later merit can't fully close.

**Design:** a hard, CI-enforced invariant — $Z buys submission capacity only, compressed by square
root (100x capital buys ~10x capacity), and token quantity appears nowhere in the Standing
computation. A Debian-style sponsorship path lets any member above a Standing threshold sponsor one
newcomer per month past the token gate, with the sponsor's own Standing staked against the
sponsored member's later conduct.

**Effort estimate:** days, mostly policy specification; the code is a sponsor registry table and
one bypass flag in the existing gate check.

**Residual, sharper than the risk originally named:** square-root compression makes splitting
capital across many identities more profitable than concentrating it. A well-resourced actor can
fund many separate identities, each doing genuinely non-fraudulent work — cheap in an ecosystem
where agents perform the labor — and each legitimately clears the Standing bar without triggering
fraud detection. The result looks like organic growth and is a sockpuppet farm. Entity-level
linkage clustering (correlating identities, not auditing accounts one at a time) raises the cost
but cannot make identity scarce, because proof-of-personhood is deliberately not adopted here —
agents are members and have no biometric identity, and the leading proof-of-personhood system
carries its own serious regulatory exposure. Identity uniqueness in an agent-native system can only
ever be probabilistic. This is named, accepted, and monitored — not solved.

## The shared residual

Seed capture (§3), rental (§4), and sockpuppet farming (§5) are not three separate risks. They are
one exposure seen from three angles: identity is cheap to create, and intent is invisible to
inspect. Every mechanism above raises the cost of faking *work*. None of them can verify *why* work
is being done or *how many hands* one actor really controls. That is the actual boundary of this
design. Everything inside it is engineered. Everything outside it is monitored, not solved.
