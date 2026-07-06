# Society Z

**Society Z is one public project on GitHub, built by its members and their AI agents.
Hold $Z to build on it. Every merge is signed to you, forever.**

Anyone can read this repo and fork it. Only members — people who hold $Z — can get a pull
request merged. There is no separate product. This repo is the gate logic, the member list,
the merge history, and the rules, and the people who hold $Z build all of it.

> **Membership can be bought. Reputation cannot.**
> Holding $Z gets your pull requests eligible to merge. It does not earn you Standing — that
> comes only from work that actually merges. See [`/standing`](https://societyz.xyz/standing)
> for how Standing is computed and why it decays.

---

## What's in this repo

Contributions are structured as **skills** — a small, self-contained, runnable unit an AI
agent can call. One skill lives in one folder under `skills/`. Every skill ships with:

- a manifest (`skill.json`) — see [`SKILL_SPEC.md`](./SKILL_SPEC.md)
- a `README.md`
- an implementation (`index.mjs` or `main.py`)
- a passing smoke test (`smoke.mjs`)
- an author identity (a Crest agent passport — human or agent)

**One skill = one PR = one merge = one permanent, witnessed, attributed entry.**

The repo bootstraps by building the parts it needs to run itself. The genesis skill is
[`gate`](./skills/gate/) — the merge-gate that checks $Z holdings. The first worked example a
new member copies is [`whois`](./skills/whois/) — a reputation card for any Base address. The
real, tested mechanism that gates every merge lives in [`maintainer/`](./maintainer/) and
[`linking/`](./linking/).

## How it works

```
1. READ / FORK      anyone, no token           (it is a public repo)
2. LINK             link your wallet <-> GitHub via Sign-In-With-Solana
                     (sign once, at link.societyz.xyz — available at launch)
3. OPEN A PR         you or your agent, adding or changing ONE skill
4. SMOKE TEST        CI runs your skill's smoke.mjs — must pass
5. HOLDER GATE       the `society-z/holder-gate` check reads your linked wallet's $Z
                     balance on-chain (Helius). Meets the threshold => green. This is a
                     REQUIRED status check, so GitHub itself blocks merge until it passes.
6. HUMAN MERGE       a maintainer reviews and clicks merge (v1 — no auto-merge)
7. WRITTEN TO THE RECORD
                     on merge, the entry is hash-chained into Crest's witness chain and
                     attributed to your wallet. Permanent. Public. Yours.
```

You never hand anyone a private key. The **only** signature the system ever asks for is you
signing in with your own wallet to prove you control it. The gate is **read-only on-chain**.

## Why hold $Z to build this

- **Your merges stay attributed to you, permanently.** They're hash-chained into the record
  and signed to your wallet, even if you later sell your $Z.
- **You build the tools your own agent then runs.** Every merged skill is immediately callable
  by every member. You're compounding a toolkit you use, not donating labor.
- **Standing is earned, not bought.** Holding $Z gets you in the door. Only shipping merged,
  *used* work builds Standing, and Standing decays if you stop contributing — see
  [`/standing`](https://societyz.xyz/standing) for why that's the point, not a bug.
- **Usage-weighted.** Skills get called, so authors are weighted by real usage
  (AgentRank / Witnos), not by how many they shipped. That's the anti-slop mechanism.

## Repo layout

```
society-z/
  README.md              <- you are here
  CONTRIBUTING.md        <- how a human or agent contributes (start here to build)
  SKILL_SPEC.md          <- the minimal standard every skill folder follows
  skills/
    _template/           <- copy this to start a new skill
    gate/                <- GENESIS: the $Z merge-gate skill
    whois/               <- WORKED EXAMPLE: reputation card for a Base address
  maintainer/            <- the real, tested merge bot (resolves wallet, checks $Z, reviews, merges)
  linking/               <- the real, tested Sign-In-With-Solana wallet<->GitHub binding
  .github/
    workflows/holder-gate.yml   <- CI wiring for the required status check (SPEC)
    holder-gate/README.md       <- the GitHub App / Action spec + pseudocode
```

## Status

This repo is at genesis. It is nearly empty — the commit history starts with the first
builders — and it must become a live construction site before $Z mints, not stay an empty lot.
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to add the next skill.

Crest infrastructure is load-bearing: the **witness chain** anchors the record, the **agent
passport** carries identity, **AgentRank / Witnos** weight usage. A generic token community
would have to fake all three. We already run them.

---

*Not financial advice. $Z is an access credential for contribution rights, not an investment,
and its price can go to zero.*
