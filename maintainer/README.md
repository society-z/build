# maintainer — the Society Z merge bot

**The mechanism the whole project is about: a bot that merges a GitHub pull request only if the
PR author holds $Z.** It reuses the [`gate`](../skills/gate/) skill for the on-chain read and
implements the flow specified in [`.github/holder-gate/README.md`](../.github/holder-gate/README.md):
resolve the PR author's linked wallet, check it holds $Z, run review, and merge.

> **Membership can be bought. Reputation cannot.** Holding $Z buys merge *eligibility*. In v1 a
> human maintainer still clicks merge (that seeds reputation). Auto-merge is OFF by default.

## What it does, per pull request

1. **Resolve wallet.** Takes the GitHub-verified numeric author id (`pr.user.id`, never a
   self-typed value) and looks up their SIWS-proven wallet in the `links` table
   (`github_id -> wallet`). — [`links.mjs`](./links.mjs)
2. **Holder gate.** Calls the existing `gate` skill: reads the wallet's $Z balance on-chain via
   Helius `getTokenAccountsByOwner` (read-only, fail-closed), compares to the threshold, posts a
   **`society-z/holder-gate`** commit status (PASS/FAIL) + a label + a helpful comment. —
   [`../skills/gate/index.mjs`](../skills/gate/index.mjs)
3. **AI review pass.** Summarizes the diff, runs the touched skill's `smoke.mjs`, and asks a
   **pluggable judge** for an APPROVE / REQUEST_CHANGES verdict; posts it. — [`review.mjs`](./review.mjs)
4. **Merge (if PASS + PASS).** When the holder-gate passes AND review passes AND `AUTO_MERGE=1`,
   it squash-merges via the GitHub API (pinned to the verified head sha) and appends a
   hash-chained **witnessed record** (author, PR, wallet, merge sha, balance, timestamp). —
   [`github.mjs`](./github.mjs), [`record.mjs`](./record.mjs)
5. **On FAIL.** Never merges. Comments the reason and the link-your-wallet URL. Fails **closed**
   on any RPC/gate error — a down or lying RPC can never grant a merge.

The whole flow is one dependency-injected function, `handlePullRequest(pr, deps)`, in
[`index.mjs`](./index.mjs). Production wiring (real Helius + real GitHub) is
[`action.mjs`](./action.mjs); the GitHub Action is
[`../.github/workflows/maintainer.yml`](../.github/workflows/maintainer.yml).

## Real vs stubbed (be explicit)

| Piece | Status | Swap point |
|---|---|---|
| On-chain $Z balance read (Helius) | **Real** (`gate` skill) | — |
| Holder-gate threshold math + fail-closed | **Real** | — |
| GitHub status / comment / label / merge API | **Real** (`realGithub`, fetch) | — |
| Record (hash-chained JSONL) | **Real, complete, local** | none needed — `jsonlRecord` is the live mechanism, not a stub |
| Links table (`github_id → wallet`) | **Stubbed** (JSON file) | `fileLinks` → `supabaseLinks` (SIWS Supabase table) |
| AI review judge | **Stubbed** (deterministic `stubJudge`) | `stubJudge` → `llmJudge` (real LLM; `REVIEW_MODEL`) |
| External record checkpoint (e.g. OpenTimestamps) | **Not built** | future addition to `record.mjs`, run by Society Z's own bot — not a Crest service |

The stub judge passes a PR iff its smoke test passes AND it touches exactly one skill folder
(the "one skill per PR" rule). Where the real LLM call goes is marked in
[`review.mjs`](./review.mjs) (`llmJudge`). Where the real link lookup goes is marked in
[`links.mjs`](./links.mjs) (`supabaseLinks`). The record itself needs no swap: `jsonlRecord`
is real and sufficient on its own; external checkpointing is a future addition, not a fix.

## Run the tests

```bash
node maintainer/test/e2e.test.mjs      # or: npm run test:maintainer
```

The end-to-end test uses **mocked Helius** (stubs `fetch` for the gate's RPC call) and a **mocked
GitHub API** — no network, no keys, no real repo. It proves:

- holder (≥ threshold) + review pass → `github.merge()` **is** called + a record is written;
- non-holder (< threshold) → `github.merge()` is **not** called, status is FAIL;
- no linked wallet → no merge, comment carries the link URL;
- holder but smoke fails → gate green, review rejects, no merge;
- `AUTO_MERGE` off (v1 default) → eligible, awaits a human, no auto-merge.

## Config (env only — never hardcode secrets)

`action.mjs` reads everything from env and fails **closed** if a required value is missing.

| Var | Required | Who provides |
|---|---|---|
| `GITHUB_TOKEN` or `APP_INSTALLATION_TOKEN` | yes | GitHub App install (preferred) / Actions |
| `GITHUB_REPOSITORY` (`owner/name`) | yes | Actions sets it automatically |
| `Z_MINT` | yes | **Andy**, the $Z mint address after pump.fun launch |
| `Z_THRESHOLD` | yes | **Andy**, token amount from a dollar target |
| `HELIUS_RPC_URL` | yes | maintainer (includes Helius API key) |
| `SECOND_RPC_URL` | no | maintainer (second provider, fail-closed agreement) |
| `GATE_SIGNING_SECRET_KEY` | no | maintainer (ed25519; signs verdicts for the chain) |
| `REVIEW_MODEL` | no | maintainer (model id for the real LLM judge) |
| `LINKS_FILE` | no | path to links JSON (v1 stub; default `maintainer/links.json`) |
| `RECORD_FILE` | no | path to `record.jsonl` (default `maintainer/record.jsonl`) |
| `LINK_URL` | no | linking page (default `https://link.societyz.xyz`) |
| `AUTO_MERGE` | no | `1` to auto-merge greens (v1 default: human merges) |

For local runs, copy `links.example.json` → `links.json` (gitignored).

## Exactly what Andy must do to take it live

1. **Provide `Z_MINT`** — the canonical $Z mint address after the pump.fun launch.
2. **Provide `Z_THRESHOLD`** — pick a dollar target (e.g. ~$50–100 of $Z), convert to a token
   amount, set it. Revisit by governance; never hard-code a fixed count long-term.
3. **Provide `HELIUS_RPC_URL`** (and optionally `SECOND_RPC_URL`) as repo/org secrets.
4. **Create + install the holder-gate GitHub App** on the Society org (own identity/token that can
   post statuses, comment, and merge). Put its installation token in `APP_INSTALLATION_TOKEN`.
   The bare `GITHUB_TOKEN` works as a cold-start fallback.
5. **Stand up the real links table** — deploy `link.societyz.xyz` (GitHub OAuth + SIWS), then
   swap `fileLinks()` for `supabaseLinks()` in `links.mjs` and set `LINK_DB_URL` /
   `LINK_DB_SERVICE_KEY`. Until then the JSON stub works for testing.
6. **Turn on branch protection** on `main`: require the **`society-z/holder-gate`** status check,
   and enable GitHub Merge Queue so the check re-runs at the front of the queue (balance confirmed
   seconds before merge). GitHub then refuses the merge button until the check is green.
7. **(Optional) wire a real review model** — set `REVIEW_MODEL` and implement `llmJudge`'s
   `callModel`. Until then the deterministic stub judge (smoke + one-skill rule) runs.
8. **(Optional) flip `AUTO_MERGE=1`** only after the v1 human-merge phase has seeded reputation.
   Set `GATE_SIGNING_SECRET_KEY` if you want signed verdicts anchored into the record.

Everything the bot does on-chain is **read-only** — it never signs or moves funds. The only
signatures in the system are members signing SIWS in their own wallets to prove ownership.
