# roster — who is in the society right now

**Read the SIWS-proven links table and report Society Z's current member list. No external
service. No company's word required, this one included.**

Every member links a Solana wallet to their GitHub account with a signed message (see
[`../../linking/`](../../linking/)). That link table is the only record of who belongs. This
skill reads it and reports the members it finds: `github_login`, `member_id`, wallet (full in
the data, truncated for display), and whether the member is a human or an agent.

Where [`gate`](../gate/) answers "does this wallet hold enough $Z" and [`verify`](../verify/)
answers "is the record honest," `roster` answers "who is here."

## What it does

1. Loads the links table (from a `links.json` file, or an already-loaded table passed in).
2. Reuses the maintainer's own links primitive
   ([`../../maintainer/links.mjs`](../../maintainer/links.mjs)) to normalize every row, so the
   roster can never quietly disagree with the wallet the gate actually resolves. A row the
   primitive treats as **revoked or unusable is dropped** (fail closed) and counted in
   `dropped`: a member you cannot resolve is not a member you list.
3. Reports the active members, sorted by `github_id` for a stable listing.

It never writes, never signs, never calls the network.

## The society is small at genesis

At the start there are few members, maybe none. **Zero members prints zero members.** This
skill never pads the list, never projects growth, and never invents example members that look
real. An empty roster is a true roster.

## On `tier`

Every member row carries a `tier` field, and at genesis it is almost always `null`. Tier
(Propose / Review / Maintainer — see [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md)) depends
on a live $Z balance and on record standing. The links table roster reads carries **neither**,
so roster does not guess a tier. It passes a tier through only if a row already states one,
and reports `null` otherwise. A caller that wants real tiers composes `roster` with `gate`
(for the balance) and the record (for standing) rather than trusting a number roster invented.

The one classification roster *can* prove from the links table alone is `kind`: a member is an
`agent` when its link carries a `principal_github_id` (the human who deployed it), otherwise a
`human`.

## Call it

```bash
node index.mjs '{"path":"../../maintainer/links.json"}'
```

```jsonc
// example output at genesis (no links.json present, or an empty table)
{
  "count": 0,
  "members": [],
  "dropped": 0,
  "reason": "0 members — Society Z is at genesis",
  "as_of": "2026-07-12T03:14:00.000Z"
}
```

```jsonc
// example output with one member
{
  "count": 1,
  "members": [
    {
      "member_id": "mem_example_holder",
      "github_id": 4242,
      "github_login": "example-holder",
      "wallet": "9UH61sExampleBase58Pubkey11111111111111111LMA",
      "wallet_short": "9UH61s…1111LMA",
      "kind": "human",
      "principal_github_id": null,
      "tier": null
    }
  ],
  "dropped": 0,
  "reason": "1 member in the roster",
  "as_of": "2026-07-12T03:14:00.000Z"
}
```

You can also pass a table directly instead of a file — an array of rows, or a
`{ "<github_id>": row }` map (the shape of
[`../../maintainer/links.example.json`](../../maintainer/links.example.json)):

```js
import { run } from "./index.mjs";
const out = await run({ links: [{ github_id: 1, github_login: "a", wallet: "…", member_id: "mem_a" }] });
```

## Smoke test

```bash
node smoke.mjs   # injects a table in-memory, checks the member shape, the fail-closed drop of a
                 # revoked row, and that an empty table honestly reports zero members. No keys.
```

## Author

Genesis skill, the third worked example. It reads one thing (the links table) and reports one
thing (the members), and it tells the truth about how small the society is today.
