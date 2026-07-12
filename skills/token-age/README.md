# token-age

**Given a Solana mint address, report how old the token is and whether anyone can still mint or
freeze it.**

Age plus live authorities is the cheap first honesty check any agent wants before it touches a
token. A brand-new mint whose creator still holds mint authority can inflate supply from under
you; a live freeze authority can lock your account. This skill reads both, from sources you can
re-check yourself, and never guesses.

## What it does

1. Reads the mint account **on-chain, read-only** via `getAccountInfo` (jsonParsed), handling
   both the **Token** and **Token-2022** programs — it reads the program from the account's
   `owner`, so it reports whichever one actually governs the mint (the repo's own $Z mint is
   Token-2022). It surfaces the live `mint_authority` and `freeze_authority`, and a `*_revoked`
   boolean for each (`null` authority = revoked).
2. Finds the token's creation time by paging `getSignaturesForAddress` back to its **oldest**
   signature and reading that signature's block time. The mint account appears in its own
   creation, mints, and authority changes, so this list is small and bounded.

It **never signs, moves, or mutates anything.** It answers; it does not act.

## Call it

```bash
# defaults to the public mainnet RPC; set HELIUS_RPC_URL for reliability
node index.mjs '{"mint":"4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump"}'

HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." \
  node index.mjs '{"mint":"<base58 mint>"}'
```

```jsonc
// example output ($Z's own mint)
{
  "mint": "4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump",
  "program": "token-2022",
  "oldest_signature": "<sig>",
  "created_at": "2026-07-12T05:xx:xx.000Z",
  "created_slot": 3xxxxxxxx,
  "age_seconds": 12345,
  "age": "3h 25m",
  "mint_authority": null,
  "freeze_authority": null,
  "mint_authority_revoked": true,
  "freeze_authority_revoked": true,
  "signatures_scanned": 6,
  "caveats": [],
  "reason": "created 2026-07-12T05:xx:xx.000Z (3h 25m old); mint authority revoked; freeze authority revoked; token-2022 program",
  "checked_at": "2026-07-12T09:xx:xx.000Z"
}
```

## Config

| Key | Where | Default |
|---|---|---|
| `mint` | **input** | required; never hardcoded |
| `HELIUS_RPC_URL` | **env** (or `inputs.config`) | falls back to `https://api.mainnet-beta.solana.com` |

The RPC endpoint is the only config, and it is never committed. A public RPC works for low
volume; Helius is recommended for reliability.

## Reliability posture

- **Fail closed, never open.** If the RPC is down, the account is missing, or the account is not
  a token mint, `run` throws rather than return a soft answer. It never invents an age or an
  authority.
- **Honest about limits.** If the mint has no signatures, or the oldest signature carries no
  `blockTime`, the age fields are `null` and a caveat says why. If the signature scan hits its
  page cap before reaching the end, the reported age is a **lower bound** and a caveat says so —
  the true creation may be older.
- **Authority is what the chain says now.** `mint_authority`/`freeze_authority` are the live
  values from `getAccountInfo` at `checked_at`; a `null` means revoked.

## Smoke test

```bash
node smoke.mjs   # stubs the RPC with Token and Token-2022 fixtures, asserts shape + logic. No keys. Exits 0 on pass.
```

## Author

Fill `author` in `skill.json` with your `member_id`, numeric `github_id`, and `wallet`.
