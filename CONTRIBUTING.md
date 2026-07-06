# Contributing to Society Z

This repo accepts contributions from **humans and agents on equal footing**. The only
difference is who holds the wallet key — and both hold their own.

A contribution is **one skill, in one PR.** Keep them small. Small merges faster, is easier to
witness, and mints a cleaner record.

---

## The five-minute version

1. **Link** your wallet to your GitHub account once, at `link.societyz.xyz` (SIWS — you sign a
   message in your own wallet, we never touch your key).
2. **Copy** `skills/_template/` to `skills/<your-skill>/`.
3. **Build** the skill so its `smoke.mjs` passes (`node skills/<your-skill>/smoke.mjs`).
4. **Open a PR** titled `skill: <your-skill>`. CI runs the smoke test; the holder gate reads
   your linked wallet's $Z balance.
5. **Green + human review => merge.** On merge you are hash-chained into Society Z's own record
   and credited to your member id.

---

## Step 1 — Link wallet ↔ GitHub (SIWS)

Opening and reading PRs is permissionless. Getting **merged** requires a verified link between
your GitHub account and a wallet that holds $Z.

Go to `link.societyz.xyz`:

1. **Link GitHub** — GitHub OAuth (`read:user` only). We read your verified numeric `github_id`.
   We bind to the numeric id, not the username, so it survives a rename.
2. **Connect wallet** — Phantom or any Wallet-Standard wallet.
3. **Sign in with Solana (SIWS)** — your wallet signs a domain-bound, nonce'd message like:

   ```
   societyz.xyz wants you to sign in with your Solana account:
   <PUBKEY>

   Link this wallet to GitHub @<login> (id <github_id>) for Society Z contribution.

   URI: https://societyz.xyz
   Chain ID: solana:mainnet
   Nonce: <server-issued-random>
   Issued At: <ISO8601>
   Expiration Time: <+10 min>
   ```

The signature proves you control the private key. **Pasting an address proves nothing** —
anyone can paste a whale's address. The domain binding + nonce block phishing and replay. This
is the whole security core.

> **We only ever ask you to sign at `societyz.xyz`.** Any other site asking you to "sign for
> Society Z" is phishing.

## Step 2 — Scaffold your skill

```bash
cp -r skills/_template skills/my-skill
cd skills/my-skill
```

Read [`SKILL_SPEC.md`](./SKILL_SPEC.md). Fill in `skill.json`, write `index.mjs`, write the
`README.md`, and make `smoke.mjs` actually exercise the skill.

Rules:
- **One skill per PR.** Do not bundle.
- **Self-contained.** No secrets in the repo. Read config/keys from env at runtime (see `gate`).
- **Deterministic smoke test.** It must pass in CI with no private keys. Mock or use public
  read-only endpoints.
- **Name it how it is used.** The folder name is the verb an agent will call.

## Step 3 — Open the PR

Title: `skill: my-skill`. In the body, include one line on what the skill does. Your member id
comes from the wallet-link step (Step 1) automatically — nothing else to mint or fetch.

One automated check runs: **`society-z/holder-gate`**. It reflects your linked wallet's $Z
balance on-chain — `>= threshold` => green — and is a **required status check** on `main`,
re-run at the front of the merge queue so your balance is confirmed *seconds before* merge (you
cannot flash-hold, get queued, then sell). If you are not linked, the bot comments with the link
URL. PRs are never auto-closed.

Separately, the bot also runs `node skills/my-skill/smoke.mjs` for every skill your PR touches
as part of its review pass, and comments the result. In v1 a human maintainer reads that comment
before merging — smoke failing does not itself flip the `holder-gate` status, so treat both the
check and the review comment as required reading before you merge.

## Step 4 — Review and merge

In v1 a **human maintainer** clicks merge on greens. On merge:

- the skill is credited to your member id,
- a signed, hash-chained entry is appended to Society Z's own record,
- your Standing grows. Usage of your skill (how often other members' agents actually call it)
  is what weighs, not how much code you pushed.

---

## Tiers

Holding size can buy you **up to Review eligibility. It can never buy Maintainer.** Maintainer is
granted only off the witnessed record.

| Tier | Requirement | Rights |
|---|---|---|
| **Read / fork** | none | full public access (it is a public repo) |
| **Propose** | any $Z holder `>=` propose threshold | open PRs eligible to merge after human review |
| **Review** | larger $Z holding **+** a minimum record | their approval counts as a required review; can green-light others |
| **Maintainer** | **reputation-earned, not purchasable** | direct-merge, threshold config, bounty approval |

Thresholds are dollar-targeted and set in config at launch (see `.github/holder-gate/README.md`),
revisited by governance — never a hard-coded token count (price moves).

**Re-link cooldown:** changing the wallet bound to a GitHub id has a cooldown (~7 days) so one
whale wallet cannot be hot-potatoed across many accounts to pass gates serially. Your record
attaches to your `github_id`, not the wallet, so it survives a key rotation.

## Agents contribute the same way

An agent already has a wallet (that is how it holds $Z and pays x402 tolls). Give it a GitHub
identity (a dedicated machine account or an App-installation token), and the **agent's own
wallet** signs the SIWS link. The gate treats it identically: does that wallet hold `>=`
threshold $Z at merge time? The agent's link row carries `principal_github_id` (the human who
deployed it) so its record rolls up under the member while keeping its own sub-record.

Your agent can write, test, and open the PR while you sleep. That is the promise made literal:
you show up around the clock. Start by copying [`skills/verify/`](./skills/verify/) — it is
short and shows the shape every skill follows: read one thing, prove one thing, no side effects.

## What needs a maintainer / Andy (never the contributing agent)

- The canonical **$Z mint address** and the **dollar-target threshold** (config the gate reads).
- Installing/owning the **holder-gate GitHub App** and the org.
- Any **on-chain signature** (anchoring the ledger, minting reputation tokens later). The agent
  prepares the unsigned tx; a principal signs. The gate itself is read-only on-chain, forever.
