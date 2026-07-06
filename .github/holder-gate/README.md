# holder-gate — the merge-gate (SPEC, not a deployed secret)

The bot that decides whether a PR is **eligible** to merge, based on whether the PR author's
linked wallet holds `>= threshold` $Z at merge time. It sets a required commit status named
**`society-z/holder-gate`**. Make that status a required check in branch protection on `main`,
and GitHub itself refuses the merge button until it is green. No custom merge code needed.

> **Eligibility is token-gated. Approval is reputation-gated.** This bot only decides
> eligibility. A human maintainer still clicks merge in v1 (that seeds reputation). Do not
> auto-merge yet.

## Ship it as a GitHub App (preferred), Action as fallback

| | GitHub App (preferred, not yet built) | GitHub Action (`maintainer.yml`, live today) |
|---|---|---|
| Identity | own App identity + token | repo's `GITHUB_TOKEN` |
| Commit status | posts `society-z/holder-gate` | posts `society-z/holder-gate` via `statuses: write` |
| Merge-queue re-run | re-evaluates at front of queue | `merge_group` trigger re-runs |
| Trust anchor | yes — signs verdicts, owns link DB read | weaker, fine for cold-start |

Both call the same core: `getLink(author) -> skills/gate run({wallet}) -> set status`. The
Action-fallback column is the real, tested path today: `.github/workflows/maintainer.yml` runs
`maintainer/action.mjs`, which wraps this exact logic (see `maintainer/README.md`). The
pseudocode below shows the shape either implementation follows; it is not a separate live file.

## The whole bot (pseudocode)

```ts
// .github/holder-gate/check.mjs (shape)
import { run as gate } from "../../skills/gate/index.mjs";

async function checkPR(pr) {
  const author = pr.user.id;                       // GitHub-VERIFIED author id (never self-typed)
  const link = await db.getLink(author);           // links table: github_id -> wallet (SIWS-signed)
  if (!link || link.revoked) {
    return fail("no-link",
      "Open PRs freely. To be *merged*, link your $Z wallet: https://link.societyz.xyz");
  }

  // gate skill does the on-chain read + threshold math + fail-closed multi-RPC agreement.
  const v = await gate({ wallet: link.wallet, pr: prRef(pr) });   // { pass, balance, threshold, signature }

  if (v.pass) return pass(`holds ${v.balance} $Z (>= ${v.threshold})`, v.signature);
  return fail("below-threshold",
    `Wallet holds ${v.balance} $Z; ${v.threshold} required to merge.`);
}

function pass(msg, signature) {
  setStatus("society-z/holder-gate", "success", msg);
  addLabel("holder ✓"); comment(msg);
  // on MERGE (not here): append a signed, hash-chained entry to the witness chain, credited
  // to link.passport_id. v.signature is the gate's attestation over the verdict.
}
function fail(reason, msg) {
  setStatus("society-z/holder-gate", "failure", msg);
  addLabel("gate: needs $Z"); comment(msg);
  // never auto-close the PR. A maintainer may still cherry-pick genuinely good work.
}
```

## Behavior (v1)

- **Green** (linked + threshold met): label `holder ✓`, one-line status comment, PR becomes
  mergeable. A human maintainer clicks merge.
- **Red** (no link / below threshold): label `gate: needs $Z`, helpful comment with the link URL.
  PR stays open, never auto-closed.
- **Re-check at merge:** the `merge_group` trigger (GitHub Merge Queue) re-runs the balance read
  at the front of the queue, so it is confirmed seconds before the merge commit. Closes the
  "held yesterday, sold today" hole.
- **Fail closed:** any RPC error, missing config, or multi-RPC disagreement -> status stays red.
  A down or lying RPC must never grant a merge.

## Secrets (set in org/repo settings — NEVER in the repo)

| Secret | What | Who provides |
|---|---|---|
| `Z_MINT` | canonical $Z mint address | **Andy**, after pump.fun launch |
| `Z_THRESHOLD` | propose-tier token amount | **Andy**, from a dollar target |
| `HELIUS_RPC_URL` | Helius RPC incl. API key | maintainer |
| `SECOND_RPC_URL` | optional second provider (agreement / fail-closed) | maintainer |
| `LINK_DB_URL` / `LINK_DB_SERVICE_KEY` | read the `links` table (github_id -> wallet) | maintainer |
| `GATE_SIGNING_SECRET_KEY` | ed25519 key that signs verdicts for the witness chain | maintainer |

## The `links` table (owned by the linking page, read by this bot)

```sql
create table links (
  github_id      bigint primary key,      -- numeric, survives username changes
  github_login   text not null,
  wallet         text not null,           -- base58 pubkey, SIWS-proven control
  passport_id    text,                    -- Crest passport the record credits
  principal_github_id bigint,             -- if this is an agent: the human who deployed it
  linked_at      timestamptz not null default now(),
  last_relink_at timestamptz,             -- enforce re-link cooldown (~7d)
  revoked        boolean not null default false
);
create unique index one_wallet_per_github on links(wallet) where not revoked;
```

Every link row is derived from a **user-signed SIWS payload** stored alongside it, so the gate is
auditable/re-verifiable from signatures alone even if the DB is compromised.

## What needs Andy

- The `Z_MINT` address and `Z_THRESHOLD` (config the gate reads).
- Owning/installing the holder-gate GitHub App on the Society org.
- Any on-chain anchoring signature for the witness chain (agent prepares unsigned tx; Andy signs).
  The gate itself is **read-only on-chain, forever**.
