# Launch-night deploy: the $Z merge gate

Date: 2026-07-11
Repo: github.com/society-z/build (public)
Purpose: take the gate from tested code to a live merge gate the moment $Z mints on
pump.fun. Andy holds every key and runs every key-holding action himself. Nothing in this
doc auto-executes.

This is a read-and-plan document. It does not change any code. It records what runs where,
the exact wiring order at T-0, what only Andy can do, and the honest gaps for tonight.

---

## 0. Test results (run 2026-07-11, node v22.23.0)

All five suites pass, no network, no keys. Verbatim tails:

```
=== gate smoke ===        SMOKE PASS: gate        exit:0
=== verify smoke ===      SMOKE PASS: verify      exit:0
=== template smoke ===    SMOKE PASS: _template   exit:0

=== maintainer e2e ===
... (28 assertions) ...
E2E PASS: maintainer      exit:0

=== linking ===
... (crypto sanity + cases 1-9) ...
ALL LINKING TESTS PASS    exit:0
```

Commands (unchanged, not modified):
`node skills/gate/smoke.mjs`, `node skills/verify/smoke.mjs`, `node skills/_template/smoke.mjs`,
`node maintainer/test/e2e.test.mjs`, `node linking/test/link.test.mjs`.

The maintainer e2e proves the load-bearing behavior: holder + review pass merges and writes a
record; non-holder does not merge and status is FAIL; no-link comments the link URL; holder
with failing smoke does not merge; auto-merge off leaves it eligible-awaiting-human. The
linking suite proves the SIWS trust root with real ed25519 keypairs: valid link, tampered sig,
impersonation, replay, wrong-domain, expiry, lookup, one-wallet-per-github, and audit
re-derivation from signatures alone.

---

## a. DEPLOYMENT MAP

Every component, where it runs, its config keys, and readiness.

| Component | File(s) | Runs where | Config it reads | Readiness |
|---|---|---|---|---|
| Holder gate (on-chain read) | `skills/gate/index.mjs` | Inside the GitHub Action (Node), per PR | `Z_MINT`, `Z_THRESHOLD`, `HELIUS_RPC_URL`, `SECOND_RPC_URL` (opt), `GATE_SIGNING_SECRET_KEY` (opt) | GREEN (real Helius call, real threshold math, fail-closed). Depends on Andy-supplied config. |
| Maintainer bot core | `maintainer/index.mjs` | GitHub Action, per PR + `merge_group` | `LINK_URL`, `autoMerge`, plus gate config | GREEN (dependency-injected, fully tested) |
| Production wiring | `maintainer/action.mjs` | GitHub Action entrypoint (`node maintainer/action.mjs`) | all env above + `GITHUB_TOKEN`/`APP_INSTALLATION_TOKEN`, `GITHUB_REPOSITORY`, `LINKS_FILE`, `RECORD_FILE` | GREEN, with one wiring caveat (links source, see below) |
| GitHub client | `maintainer/github.mjs` | GitHub Action | `token`, `repo` | GREEN (real fetch against api.github.com) |
| Links lookup (author -> wallet) | `maintainer/links.mjs` | GitHub Action | `LINKS_FILE` (JSON) | YELLOW. `fileLinks()` (JSON file) is real and works; `supabaseLinks()` is an intentional throwing stub. Real linking data needs the linking service live. |
| AI review pass | `maintainer/review.mjs` | GitHub Action | `REVIEW_MODEL` (opt) | GREEN for the deterministic `stubJudge` (smoke + one-skill rule). `llmJudge` is a documented stub, no model wired. |
| Record (hash-chained ledger) | `maintainer/record.mjs` | GitHub Action, writes `RECORD_FILE` | `RECORD_FILE` | GREEN, real and complete. Only writes on actual merge (AUTO_MERGE=1). See gap on persistence. |
| Verify skill | `skills/verify/index.mjs` | Anyone, anywhere (read-only, no network) | `path`/`RECORD_FILE` | GREEN |
| GitHub Action workflow | `.github/workflows/maintainer.yml` | GitHub Actions runner on `pull_request` + `merge_group` | all secrets by name via `secrets.*` / `vars.*` | GREEN as written; inert until secrets exist and branch protection requires the check |
| Linking service (SIWS + OAuth) | `linking/*.mjs` | Would run at `link.societyz.xyz` (a server: Vercel/Next.js or any Node host) | `SOCIETY_Z_DOMAIN`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, `LINK_DB_URL`, `LINK_DB_SERVICE_KEY` | YELLOW. Crypto core (verify, store, audit) is real and tested. The OAuth server and the deployed web page are NOT built here (README says so explicitly). |
| holder-gate GitHub App | `.github/holder-gate/README.md` (spec only) | Would be an installed GitHub App on the society-z org | App id, private key, installation token | RED. Spec only. Not built. The Action + `GITHUB_TOKEN` is the cold-start substitute. |
| Verdict signing | `skills/gate/index.mjs` `signVerdict()` | GitHub Action | `GATE_SIGNING_SECRET_KEY` + `tweetnacl` + `bs58` | RED for tonight. Deps absent (see gaps); verdicts return unsigned even if the key is set. |
| build.societyz.xyz web app | not in repo | future | n/a | RED (not built, not needed tonight; README frames it as next) |

Where processes actually run tonight: there is exactly one runtime that matters for the gate,
the GitHub Actions runner executing `maintainer/action.mjs` on every PR and merge-group event.
Everything the gate does on-chain is a single read-only Helius RPC call from inside that runner.
The linking service is a separate server that must exist for real members to link, but the gate
does not import it directly at runtime; the Action reads a links source (`LINKS_FILE` JSON today,
Supabase later).

---

## b. THE WIRING ORDER at T-0

Sequence from "mint address known" to "first gated merge possible." Each step names the exact
place the value goes. Andy does all of these.

1. **$Z mints on pump.fun.** Copy the SPL mint address. This is `Z_MINT`.

2. **Pick the threshold.** Decide a dollar target (README suggests ~$50-100 of $Z), read the
   launch price, divide, get a token amount (uiAmount). This is `Z_THRESHOLD`. It is a decimal
   token count, not a raw lamport amount, because the gate sums `uiAmount`.

3. **Create the Helius key + RPC URL.** `HELIUS_RPC_URL` =
   `https://mainnet.helius-rpc.com/?api-key=<key>`.

4. **Set repo secrets** on `society-z/build` (Settings -> Secrets and variables -> Actions ->
   Secrets):
   - `Z_MINT` = the mint from step 1
   - `Z_THRESHOLD` = the number from step 2
   - `HELIUS_RPC_URL` = step 3
   - (optional) `SECOND_RPC_URL` = a second provider for fail-closed agreement
   These land in `maintainer/action.mjs` via the workflow `env:` block, which passes them into
   `config`, which `skills/gate/index.mjs` `loadConfig()` reads.

5. **Provide the links source.** Two honest options tonight:
   - **Fast path (JSON):** commit nothing secret; instead have the Action write a
     `maintainer/links.json` from a secret, or point `LINKS_FILE` at a path the Action
     populates. `fileLinks()` reads `{ "<github_id>": { wallet, member_id, ... } }`. This works
     but every linked member must be entered by hand.
   - **Real path (Supabase):** stand up `link.societyz.xyz`, then implement `supabaseLinks()` in
     `maintainer/links.mjs` and set `LINK_DB_URL` / `LINK_DB_SERVICE_KEY`. Until that function is
     implemented it throws, and the bot fails closed (no merges). See gap G2.

6. **Keep `AUTO_MERGE` unset (v1).** The workflow reads `vars.AUTO_MERGE`. Leave it empty so the
   bot marks PRs eligible-awaiting-human and a maintainer clicks merge. This is the intended v1
   posture and it is what seeds reputation.

7. **Turn on branch protection** on `main` (Settings -> Branches -> add rule for `main`):
   - Require status checks to pass before merging: add **`society-z/holder-gate`**.
   - (Recommended) Enable the merge queue so the check re-runs at the front of the queue, which is
     what closes the "held yesterday, sold today" hole. The workflow already listens on
     `merge_group`.
   Once this is on, GitHub itself refuses the merge button until the gate is green.

8. **First gated merge is now possible.** Open a test PR from a linked, holding wallet; the Action
   runs, posts `society-z/holder-gate` = success, comments eligible-awaiting-human; a maintainer
   merges; `maintainer/record.mjs` appends the first hash-chained entry crediting that wallet.

Order that matters: secrets (4) before branch protection (7), or the required check will sit
pending/red on every PR. Links source (5) before any real contributor PR, or every author reads
as no-link.

---

## c. NEEDS-FROM-ANDY

Only the founder can do these. Copy-paste ready.

### 1. Helius API key + RPC URL

- Go to https://dashboard.helius.dev , create a free/dev project, copy the API key.
- Build the URL: `https://mainnet.helius-rpc.com/?api-key=<YOUR_KEY>`
- (Optional second provider for fail-closed agreement) create any second Solana RPC URL and keep
  it for `SECOND_RPC_URL`.
- Sanity check before trusting it (replace both placeholders):

```bash
curl -s "https://mainnet.helius-rpc.com/?api-key=<YOUR_KEY>" \
  -X POST -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":"1","method":"getTokenAccountsByOwner","params":["<ANY_WALLET>",{"mint":"<Z_MINT>"},{"encoding":"jsonParsed"}]}' | head -c 400
```

### 2. Create + install the holder-gate GitHub App (or use the Action fallback tonight)

The spec (`.github/holder-gate/README.md`) prefers an App; the tested path tonight is the Action
with the built-in `GITHUB_TOKEN`, which needs no App. If you want the App identity:

- https://github.com/organizations/society-z/settings/apps -> New GitHub App.
- Name: `society-z holder-gate`. Homepage: `https://societyz.xyz`.
- Webhook: the current code does NOT run a webhook server. It runs inside GitHub Actions on the
  `pull_request` and `merge_group` events. So set Webhook -> Active = OFF. (A webhook is only
  needed if you later run the bot as a standalone service instead of an Action.)
- Permissions (exact, this is what the code calls):
  - Repository -> Commit statuses: **Read and write** (posts `society-z/holder-gate`)
  - Repository -> Pull requests: **Read and write** (labels + comments)
  - Repository -> Contents: **Read and write** (squash merge; only used when AUTO_MERGE=1)
  - Repository -> Metadata: **Read-only** (mandatory default)
- Install it on the `society-z` org, repo `build`.
- Generate an installation token and set it as the `APP_INSTALLATION_TOKEN` secret. The workflow
  prefers it over `GITHUB_TOKEN` automatically (`action.mjs`: `APP_INSTALLATION_TOKEN || GITHUB_TOKEN`).
- If you skip the App tonight: do nothing here. The workflow's `GITHUB_TOKEN` already carries the
  `contents/statuses/pull-requests: write` permissions declared in `maintainer.yml`.

### 3. Set the Actions secrets and variables

On https://github.com/society-z/build -> Settings -> Secrets and variables -> Actions:

Secrets (Repository secrets):
```
Z_MINT               = <the $Z SPL mint address from pump.fun>
Z_THRESHOLD          = <token uiAmount for the propose tier, e.g. 25000>
HELIUS_RPC_URL       = https://mainnet.helius-rpc.com/?api-key=<key>
SECOND_RPC_URL       = <optional second RPC URL>
APP_INSTALLATION_TOKEN = <only if you made the App in step 2; else omit>
GATE_SIGNING_SECRET_KEY = <optional; see gap G4 before relying on it>
```
Variables (Repository variables):
```
LINK_URL   = https://link.societyz.xyz
AUTO_MERGE = <leave empty for v1 human-merge; "1" only later>
```

### 4. DNS for link.societyz.xyz

The linking page must exist for real members to link (the gate reads what it writes). If you host
on Vercel:
- Deploy the linking front end to a Vercel project, add domain `link.societyz.xyz`.
- In your DNS for `societyz.xyz`, add a CNAME:
  ```
  link  CNAME  cname.vercel-dns.com
  ```
  (or the exact target Vercel shows you). Then set `SOCIETY_Z_DOMAIN=societyz.xyz` on that host so
  the SIWS message domain line matches; the verifier rejects any other domain.
- Note: the OAuth server and page are not in this repo (see gap G2). DNS alone does not make
  linking work; the app behind it has to be built.

### 5. Branch protection requiring the gate

https://github.com/society-z/build -> Settings -> Branches -> Add branch ruleset (or classic
protection) for `main`:
- Require status checks to pass: add **`society-z/holder-gate`** (exact string; it is the fixed
  `STATUS_CONTEXT` in `maintainer/github.mjs`).
- Require branches to be up to date: on.
- (Recommended) Require merge queue: on, so the check re-runs at the front of the queue and the
  balance is confirmed seconds before the merge commit.
- Do not enable auto-merge in v1.

(Then, the two data entries that are also Andy-only, already covered above: the `Z_MINT` address
and the `Z_THRESHOLD` number.)

---

## d. GAPS

What the code expects that does not exist yet, and what the site promises that the code cannot
deliver tonight. Smallest honest fix for each.

### G1 (RISKIEST TONIGHT). The site promises token LOCKING with a cooldown; the code only checks hold-at-merge.

The live FAQ says, verbatim: *"Running an agent that acts in your name takes locking $Z as well;
locked tokens stay yours and unlock after a cooldown, in amounts fixed at launch."* The home page
says: *"Seating it takes locking $Z, in amounts fixed at launch."*

The code has no locking, no escrow, no staking program, and no cooldown. `skills/gate/index.mjs`
does one thing: sums `uiAmount` of $Z the wallet currently holds via `getTokenAccountsByOwner` and
compares to `Z_THRESHOLD`. That is hold-at-merge-time, spendable the next block. There is no
on-chain lock, no seat accounting, nothing that could enforce "locked and unlocks after a
cooldown." Building real locking means a Solana program (escrow/stake vault) plus seat state, which
is not tonight's work and must not be faked (a fake lock that is really a balance check is a
security-theater claim about member funds).

Smallest honest fix for tonight: do not ship the locking language as live. Two clean options:
- Scope the launch to what the code does: gate on **holding** $Z at merge. Mark agent-seat locking
  as "coming," not live, on the site, so the FAQ matches the mechanism. The README already frames
  agent contribution as "the agent's own wallet holds $Z and passes the same gate," which is
  hold-based and true tonight; lean on that wording.
- If a seat concept is needed at launch, the honest minimum is a **hold** threshold for the agent
  wallet (identical gate, applied to the agent's linked wallet), explicitly described as "held,
  not locked," until a real lock program exists.

The riskiest part is not code, it is the claim: the site currently tells members their tokens get
locked and released on a cooldown, and tonight nothing locks anything. Fix the words before mint,
or you are making an unfulfillable promise about people's funds on day one.

### G2. The real links source (Supabase) and the linking page are not built.

`maintainer/links.mjs` `supabaseLinks()` throws by design; only `fileLinks()` (a JSON file) is
real. `linking/` has a real, tested crypto core (SIWS verify, store, audit) but README states the
OAuth server and the `link.societyz.xyz` page are a sketch, not built. So tonight there is no live
place for a member to link, and no live table for the bot to read.

Smallest honest fix: run v1 on the JSON `fileLinks()` path with a hand-maintained
`maintainer/links.json` for the first known builders, entered by Andy from SIWS payloads he
collects manually (the `linking/` CLI can verify them: `node linking/link.mjs link '<json>'`). This
is enough to gate the genesis PRs. Stand up the OAuth page + Supabase table right after, then
implement `supabaseLinks()` (return `normalize(row)`) and set `LINK_DB_URL`/`LINK_DB_SERVICE_KEY`.
Until then, be clear that self-serve linking at link.societyz.xyz is not yet live.

### G3. The re-link cooldown (~7 days) is documented but not enforced in code.

`CONTRIBUTING.md` and the SQL schema (`last_relink_at`) promise a ~7-day cooldown so one whale
wallet cannot be hot-potatoed across accounts. `linking/store.mjs` `latestByGithubId()` is plain
latest-wins with no time check, and there is no cooldown gate in `linkAccount()`. The
one-wallet-per-github unique constraint IS enforced (test case 8), which blocks the same wallet
linking to two ids simultaneously, but nothing blocks rapid re-linking over time.

Smallest honest fix: for tonight the unique-wallet constraint plus manual link entry (G2) covers
the abuse case, because Andy is entering links by hand. When self-serve linking goes live, add a
cooldown check in `linkAccount()` against `last_relink_at` before merging real member traffic. Do
not advertise the cooldown as active until it is.

### G4. Signed verdicts are unavailable tonight (signing deps absent).

`skills/gate/index.mjs` `signVerdict()` dynamically imports `tweetnacl` and `bs58`. Neither is in
`package.json` and both are absent (`node -e import` confirms ABSENT). So even if
`GATE_SIGNING_SECRET_KEY` is set, `signVerdict()` catches the missing import and returns `""`; the
verdict is unsigned and the record's `gate_signature` field is empty. The code is honest about this
(README: "if absent, verdicts unsigned"), but anyone expecting signed, independently-verifiable
verdicts in the ledger tonight will not get them.

Smallest honest fix: accept unsigned verdicts for v1 (the hash chain itself is still intact and
re-derivable via `skills/verify`), and do not set `GATE_SIGNING_SECRET_KEY` expecting signatures.
If signatures are wanted, add `tweetnacl` + `bs58` to `package.json` dependencies and ensure the
Action runs `npm install` (the current workflow does `actions/checkout` + `setup-node` but no
install step, so add one). This is a follow-up, not a launch blocker.

### G5. The record file is not persisted across Action runs.

`maintainer/record.mjs` appends to a local `RECORD_FILE` (`maintainer/record.jsonl`, gitignored).
A GitHub Actions runner is ephemeral: the file written during a merge run vanishes when the job
ends. Nothing in the workflow commits the record back to the repo or ships it anywhere. So the
"permanent, public, hash-chained record" is real code but has no durable home in the current
wiring. This only bites when AUTO_MERGE=1 (the bot writes the entry); in v1 human-merge, the bot
returns eligible-awaiting-human and does not write at all, so the point where the record must be
produced is deferred.

Smallest honest fix for v1: since v1 humans merge and the bot does not write the record, decide the
record-writing home before flipping AUTO_MERGE=1. Options: a post-merge Action step that appends and
commits `record.jsonl` to the repo, or a small always-on service. Do not enable AUTO_MERGE until the
record has a durable, committed home, or merges will be witnessed to a file that immediately
disappears.

### G6. Six-step vs five-step naming.

The task references a six-step mechanism (SIWS link, PR, holder check, maintainer review,
hash-chained record). The live site itself says "Five checks, then it's written to the record," and
the repo README lists 7 numbered flow lines. This is a wording mismatch, not a code gap. The code
delivers: link (SIWS) -> open PR -> holder gate at merge -> smoke+review -> human merge ->
hash-chained record. Pick one count and make site, README, and CONTRIBUTING agree. No code change.

---

## Readiness summary

- gate skill: GREEN (needs Andy config)
- maintainer core + github client + record: GREEN
- review (stub judge): GREEN; llmJudge: not wired (fine for v1)
- links lookup: YELLOW (JSON works; Supabase stub throws; page not built)
- linking crypto core: GREEN; linking page/OAuth: YELLOW (not built)
- holder-gate GitHub App: RED (spec only; Action+GITHUB_TOKEN is the tested substitute)
- verdict signing: RED tonight (deps absent; unsigned is acceptable for v1)
- record persistence across Action runs: RED before AUTO_MERGE=1
- site locking/cooldown promise vs code: RED (claim exceeds mechanism)

Bottom line: the gate itself is ready and tested. It goes live tonight with Andy's five inputs
(Helius URL, Z_MINT, Z_THRESHOLD, links source, branch protection) on the Action path, no GitHub
App required. The single thing to fix before mint is not code but the site's locking/cooldown
language, which promises something the code does not do.
