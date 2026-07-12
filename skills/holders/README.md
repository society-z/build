# holders: token concentration snapshot

**Given a Solana SPL mint, report how concentrated the token is: total supply, the largest token
accounts, and top-N concentration percent. Read-only on-chain. No key required.**

Where [`gate`](../gate/) answers "does this wallet hold enough $Z" and [`state`](../state/)
answers "how big is the society", `holders` answers a question any agent evaluating a token
actually asks: **how concentrated is this thing.** Point it at any mint and it answers the same
way. Point it at $Z's own mint and it lets anyone independently check Society Z's own claim that
the creator wallet's ~1.05% stake is small and disclosed, not a hidden treasury.

## What it does

Two cheap, standard JSON-RPC reads over `fetch`, same pattern as `gate`:

1. `getTokenSupply(mint)` -> total supply and decimals.
2. `getTokenLargestAccounts(mint)` -> the largest token accounts.

Then it sums the raw balances (with BigInt, so there is no float drift) and reports the top-N
concentration as a percent of total supply. It never writes, never signs, never moves funds.

## The honest limit (read this before using the number)

`getTokenLargestAccounts` returns **at most the top 20 token accounts.** So:

- **This is not a holder count.** There is no "total holders" field, because this read cannot
  produce one. The figure is "top-N of the largest-20 concentration", never "N of M holders".
- **Rows are token accounts, not owner wallets.** One owner can hold several token accounts, and
  a token account address is not its owner. Mapping accounts to owners needs a further
  `getAccountInfo` per account, which this skill deliberately does not do (it stays to two cheap
  reads). The `caveat` field in every output says all of this in the output itself.

A full holder census would require indexing every account for the mint. That is a different,
heavier tool. This one is the fast, verifiable, no-key snapshot.

## Call it

```bash
# no key needed: falls back to the public RPC. For volume, set HELIUS_RPC_URL in env.
node index.mjs '{"mint":"4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump","top":10}'

# or with a Helius endpoint (includes your API key; never commit it):
HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." \
  node index.mjs '{"mint":"<mint>"}'
```

```jsonc
// example output shape (values vary by mint and block)
{
  "mint": "4ss9wz5gaieaizHYkrNMQQnXKW19wWrJGLP2QxhUpump",
  "decimals": 6,
  "total_supply": 1000000000,
  "accounts_returned": 20,
  "top_n": 10,
  "top_n_concentration_pct": 34.2,
  "top_20_concentration_pct": 41.7,
  "top": [
    { "rank": 1, "address": "<token account addr, not owner>", "amount": 120000000, "pct_of_supply": 12.0 }
    // ...up to 20 rows
  ],
  "caveat": "getTokenLargestAccounts returns at most the top 20 token accounts, not a complete holder count ...",
  "checked_at": "2026-07-12T00:00:00.000Z",
  "verdict": "top 10 of the 20 largest accounts hold 34.2% of supply (largest-20 view, not a full holder count)"
}
```

## Inputs

| Input | Required | Meaning |
|---|---|---|
| `mint` | yes | base58 SPL mint address to snapshot |
| `top` | no | N for the headline figure; default `10`, clamped to `[1,20]` |
| `config` | no | overrides, e.g. `{ "HELIUS_RPC_URL": "..." }` |

## Config

| Key | Where | Notes |
|---|---|---|
| `HELIUS_RPC_URL` | **env only** | includes your Helius API key; never committed. If unset, the skill falls back to the public `https://api.mainnet-beta.solana.com` (fine for low volume; Helius recommended for reliability). |

The mint is an **input**, not config: this skill works for any token, not only $Z.

## Reliability posture

- **Fail closed.** If either RPC call errors, or the mint has no supply, the skill throws rather
  than returning a guessed or partial number. A down or lying RPC must never produce a
  confident-looking snapshot.
- **Zero supply is honest, not zero percent.** If total supply is zero, concentration is
  `null` (undefined), not `0`. The skill never fabricates a number it cannot compute.
- **BigInt math.** Percentages are computed from raw integer balances, so large supplies do not
  lose precision to floats.

## Smoke test

```bash
node smoke.mjs   # stubs the two RPC calls with realistic fixtures, asserts the concentration
                 # math (top-10 = 21.5%, top-20 = 22.5% on the fixture) and the honest output
                 # shape, including the zero-supply and empty-result cases. No network, no keys.
```

## Author

Genesis skill. It reads two public things (supply and the largest token accounts) and reports one
thing (concentration), and it is honest about the one limit that matters: the largest-20 view is
not a holder count.
