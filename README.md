# build

**This is Society Z. One public project on GitHub, built by its members and their AI
agents. Hold $Z to build on it. Every merge is signed to you, forever.**

This repo is called `build` because its first real product is **build.societyz.xyz** — a
web app that lets anyone connect whatever tools they have and go from an idea to an
opened, wallet-gated pull request, without needing their own local coding-agent setup.
That app's own source code lives here, in this repo, built the same way everything else
here gets built: hold $Z, open a PR, get merged.

Anyone can read this repo and fork it. Only members — people who hold $Z — can get a pull
request merged. There is no separate product. This repo is the gate logic, the member
list, the merge history, the web app, and the rules, and the people who hold $Z build all
of it.

> **Membership can be bought. Reputation cannot.**
> Holding $Z gets your pull requests eligible to merge. It does not earn you Standing — that
> comes only from work that actually merges. See [`/standing`](https://societyz.xyz/standing)
> for how Standing is computed and why it decays.

---

## What's in this repo right now

The repo is at genesis. Before the `build.societyz.xyz` web app exists, the repo needed
the mechanism that makes every future merge here real: a way to check that a contributor
holds $Z, and a way to prove a wallet and a GitHub account belong to the same person.
Both are built and tested:

- [`skills/gate`](./skills/gate/) — verifies a Solana wallet holds enough $Z and returns a
  signed pass/fail verdict. The check every merge runs through.
- [`linking/`](./linking/) — Sign-In-With-Solana wallet↔GitHub binding (ed25519,
  domain-and-nonce bound, replay-proof).
- [`maintainer/`](./maintainer/) — the real, tested merge bot: resolves a PR author's
  linked wallet, checks the gate, runs review, and merges. Auto-merge is off in v1; a
  human maintainer clicks merge.
- [`skills/verify`](./skills/verify/) — the second worked example: re-derives Society Z's own
  hash-chained record and reports whether it's intact. No external service.

Contributions here are structured as **skills** — a small, self-contained, runnable unit
an AI agent can call. See [`SKILL_SPEC.md`](./SKILL_SPEC.md) for the manifest format.
**One skill = one PR = one merge = one permanent, witnessed, attributed entry.**

## What gets built next: build.societyz.xyz

The web app is not built yet. The plan, grounded in how real tools do this (v0, bolt.new,
GitHub's own Copilot coding agent, Replit Agent, OpenHands):

- **Bring your own key.** You paste your own Anthropic/OpenAI/OpenRouter key. It's stored
  client-side. Society Z pays for none of your inference and never sees your key.
- **Real attribution, not a bot.** A GitHub App using the "on-behalf-of-user" OAuth flow
  opens the pull request as *you*, not as a service account.
- **No in-browser sandbox in v1.** Server-side generation only: describe what you want,
  review the diff, open the PR. Running/previewing the code live is a later problem.
- **The same gate, unchanged.** Whether your PR comes from your own coding agent or from
  build.societyz.xyz, the same holder-gate check and the same maintainer review apply.

## How a contribution works today

```
1. READ / FORK      anyone, no token           (it is a public repo)
2. LINK             link your wallet <-> GitHub via Sign-In-With-Solana
                     (sign once, at link.societyz.xyz — available at launch)
3. OPEN A PR         you, your own agent, or (once it ships) build.societyz.xyz
4. HOLDER GATE       the `society-z/holder-gate` check reads your linked wallet's $Z
                     balance on-chain (Helius). Meets the threshold => green. This is a
                     REQUIRED status check, so GitHub itself blocks merge until it passes.
5. SMOKE + REVIEW    the bot separately runs your skill's smoke test as part of its review
                     pass and comments the result. A human maintainer reads that comment
                     before merging (it does not itself flip the holder-gate status).
6. HUMAN MERGE       a maintainer reviews and clicks merge (v1 — no auto-merge)
7. WRITTEN TO THE RECORD
                     on merge, the entry is hash-chained into Society Z's own record and
                     attributed to your wallet. Permanent. Public. Yours. Re-derive it
                     yourself with skills/verify — no company to trust.
```

You never hand anyone a private key. The **only** signature the system ever asks for is
you signing in with your own wallet to prove you control it. The gate is **read-only
on-chain**.

## Why hold $Z to build this

- **Your merges stay attributed to you, permanently.** They're hash-chained into the record
  and signed to your wallet, even if you later sell your $Z.
- **You build the tools your own agent then runs** — and, once it ships, the web app
  everyone without their own agent setup uses to get in.
- **Standing is earned, not bought.** Holding $Z gets you in the door. Only shipping merged,
  *used* work builds Standing, and Standing decays if you stop contributing — see
  [`/standing`](https://societyz.xyz/standing) for why that's the point, not a bug.
- **Usage-weighted.** Contributions get called or run, so authors are weighted by real,
  distinct usage, not by how many they shipped. The anti-slop mechanism.

## Repo layout

```
build/
  README.md              <- you are here
  CONTRIBUTING.md        <- how a human or agent contributes (start here to build)
  SKILL_SPEC.md          <- the minimal standard every skill folder follows
  skills/
    _template/           <- copy this to start a new skill
    gate/                <- GENESIS: the $Z merge-gate skill
    verify/              <- WORKED EXAMPLE: re-derive and check the record yourself
  maintainer/            <- the real, tested merge bot (resolves wallet, checks $Z, reviews, merges)
  linking/               <- the real, tested Sign-In-With-Solana wallet<->GitHub binding
  .github/
    workflows/maintainer.yml   <- CI wiring that runs the real maintainer bot on every PR
    holder-gate/README.md      <- the GitHub App vs Action design spec, links-table schema
```

## Status

This repo is at genesis. It is nearly empty — the commit history starts with the first
builders — and it must become a live construction site before $Z mints, not stay an empty
lot. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) to add the next thing, starting with
build.societyz.xyz itself.

The record is Society Z's own: a local, hash-chained log, in this repo, that anyone can clone
and re-derive without asking anyone's permission or trusting anyone's word — run `skills/verify`
yourself. Membership identity is a member id assigned at wallet-link time, not an issued
credential from anywhere else. Crest Deployment Systems built this genesis code and is the
first to buy in and build on it, same as any member — it does not operate the record, and
nothing here depends on it staying online.

More at [societyz.xyz](https://societyz.xyz) · [@therealsocietyz](https://x.com/therealsocietyz)

---

*Not financial advice. $Z is an access credential for contribution rights, not an
investment, and its price can go to zero.*
