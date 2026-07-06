# whois — a member's literal first PR

**Input a Base address. Output a one-screen reputation card.**

This is the worked example new members copy. It is ~60 lines, genuinely useful to every other
member's agent (everyone wants to know who they are about to pay), witnessed and attributed on
merge, and small enough that your agent can write, test, and open the PR while you sleep.

## What it does

Assembles three live Crest signals into one card:

| Source | Answers |
|---|---|
| **onchain_profile** | activity, age, balances — a quick public snapshot of the address |
| **Witnos check_counterparty** | is it safe to pay? real service, buyer, relayer, or about to drain? |
| **AgentRank** | settlement-grounded reputation score |

It fetches all three in parallel and tolerates one being down (a partial card beats no card),
then produces a one-line human verdict like `active, low counterparty risk, AgentRank 0.82`.

## Call it

```bash
CREST_API_BASE="https://api.crestsystems.ai" \
  node index.mjs '{"address":"0x1111111111111111111111111111111111111111"}'
```

```jsonc
{
  "address": "0x1111...1111",
  "profile":      { "active": true, "tx_count": 340 },
  "counterparty": { "risk": "low", "verdict": "known payer" },
  "agentrank":    { "score": 0.82 },
  "verdict": "active, low counterparty risk, AgentRank 0.82",
  "assembled_at": "2026-07-06T18:10:00.000Z"
}
```

## Config

| Key | Where | Note |
|---|---|---|
| `CREST_API_BASE` | env / `inputs.config` | Crest API base. Confirm the canonical base and the three tool paths at launch — the paths in `index.mjs` (`PATHS`) are documented placeholders. |

Crest also exposes these as MCP tools (`onchain_profile`, `check_counterparty`, `crest_score`).
An agent already wired to the Crest MCP server can call those directly instead of HTTP; this
skill uses HTTP so it runs anywhere, standalone.

## Smoke test

```bash
node smoke.mjs   # stubs the three endpoints, asserts card shape + summary + partial-failure path
```

## Copy this to start your own

```bash
cp -r skills/whois skills/my-skill   # then rewrite for your tool
```

Fill `author` in `skill.json` with your passport id, GitHub id, and the wallet that passes the
holder gate. Open the PR titled `skill: my-skill`. That is your first witnessed entry.
