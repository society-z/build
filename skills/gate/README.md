# gate — the genesis skill

**Given a Solana wallet, verify it holds `>= threshold` $Z and return a signed pass/fail verdict.**

This is contribution number one: the mechanism that makes contribution number two possible. The
Society cannot accept a merge until it can check who holds $Z. The organism's first organ is its
own mouth. The first name in the ledger is whoever built the door everyone else walks through.

## What it does

1. Reads the wallet's $Z balance **on-chain, read-only** via Helius `getTokenAccountsByOwner`
   (filtered by the $Z mint), summing `uiAmount` across the owner's token accounts.
2. Compares to the configured threshold.
3. Returns a verdict object, optionally **signed** (ed25519) by the gate key so the verdict is
   independently verifiable and can be appended to the witness chain.

It **never signs or moves funds.** The only signature it emits is an attestation over its own
verdict. This is the read that the `society-z/holder-gate` status check calls per PR (see
[`../../.github/holder-gate/README.md`](../../.github/holder-gate/README.md)).

## Call it

```bash
# with config.json present (copy from config.example.json) and HELIUS_RPC_URL in env:
HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." \
  node index.mjs '{"wallet":"<base58 pubkey>","pr":"societyz/core#210"}'
```

```jsonc
// example output
{
  "wallet": "9UH61s...9LMA",
  "mint": "<Z_MINT>",
  "balance": 41000,
  "threshold": 25000,
  "pass": true,
  "reason": "holds 41000 $Z (>= 25000)",
  "checked_at": "2026-07-06T18:04:00.000Z",
  "pr": "societyz/core#210",
  "signature": "<base58 ed25519 sig, or \"\" if GATE_SIGNING_SECRET_KEY unset>"
}
```

## Config (placeholders — Andy provides at launch)

Copy `config.example.json` -> `config.json` (gitignored) or set env vars. **No real values are
committed.**

| Key | Where | Who sets it |
|---|---|---|
| `Z_MINT` | config.json / env | **Andy** — the canonical $Z mint address after pump.fun launch |
| `Z_THRESHOLD` | config.json / env | **Andy** — token amount for the propose tier, from a dollar target |
| `HELIUS_RPC_URL` | **env only** | includes the Helius API key; never committed |
| `GATE_SIGNING_SECRET_KEY` | **env only** | base58 ed25519 secret of the gate's verdict key; if unset, verdicts are unsigned |
| `SECOND_RPC_URL` | **env only** | optional second provider; on disagreement the gate **fails closed** |

## Reliability posture

- **Fail closed, never open.** If a second RPC is configured and the two reads disagree, the
  gate takes the conservative (lower) balance rather than trusting a possibly-wrong read. A
  down/lying RPC must never grant a merge.
- **Check at merge time, not PR-open.** Balances move every block. The status check re-runs at
  the front of the merge queue so the balance is confirmed seconds before the merge commit,
  closing the "held yesterday, sold today" hole.

## Smoke test

```bash
node smoke.mjs   # stubs the RPC, asserts pass/fail math + verdict shape. No keys. Exits 0 on pass.
```

## Optional deps for signed verdicts

`tweetnacl` + `bs58`. If absent, `run` still works and returns an **unsigned** verdict
(`signature: ""`). The status-check bot can require a non-empty signature in production.

## Author

Maintainers' genesis skill. Fill `author` in `skill.json` with the maintainer passport that
builds the door.
