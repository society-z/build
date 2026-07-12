# request-build — the gated door in front of OpenHands

**Given a wallet, a GitHub login, and an idea in words, verify the wallet holds `>= threshold`
$Z and return the exact GitHub issue that _would_ trigger an OpenHands build. It never creates
the issue.**

This is how a non-coder goes from "an idea, in words" toward "an opened PR" without their own
local coding-agent setup: OpenHands' resolver watches for the `fix-me` label on an issue and
automatically generates a diff and opens a PR (see `.github/workflows/openhands-resolve.yml`).
But that resolver has **no built-in abuse or cost protection** — every trigger spends the repo
owner's paid `LLM_API_KEY`, and on a public repo anyone could fire it. So the resolver is not the
public entry point. **This skill is.** No $Z, no build request.

## What it does

1. Reads the requester wallet's $Z balance **on-chain, read-only**, by **reusing the `gate`
   skill** (`import { run as gate } from "../gate/index.mjs"`) — the exact same balance check,
   threshold math, and fail-closed multi-RPC agreement the merge gate uses. It is imported, not
   reimplemented, so the door in front of builds can never drift from the door in front of merges.
2. If the wallet holds `>= threshold` $Z, returns the **exact issue that would fire OpenHands**:
   a title derived from the idea, a body crediting the requester and recording the verified
   balance, and the `fix-me` label.
3. If the wallet is below threshold, it **fails closed**: `authorized: false`, `would_create: null`.

## What it does NOT do (on purpose)

It **never calls the GitHub API, never opens an issue, never applies a label.** It answers a
question and returns the answer as data. Creating the issue + `fix-me` label is a **mutation with
real consequences** (it triggers OpenHands and spends `LLM_API_KEY`), and it needs a bot
identity/token this skill does not hold. Per `docs/BUILDING-SKILLS.md` rule 4 — **"skills never
act"** — a skill answers, a principal acts. So the `would_create` object is handed to a human
principal, or to a future deliberately-built, write-capable maintainer action, to execute.

`dry_run` in the output is **always `true`.**

## Call it

```bash
# with config.json present (copy skills/gate/config.example.json) and HELIUS_RPC_URL in env:
HELIUS_RPC_URL="https://mainnet.helius-rpc.com/?api-key=..." \
  node index.mjs '{"wallet":"<base58 pubkey>","github_login":"octocat","idea":"Add a dark mode toggle to the roster page"}'
```

```jsonc
// example output (authorized)
{
  "authorized": true,
  "reason": "authorized to request a build: holds 2000000 $Z (>= 1000000)",
  "wallet": "9UH61s...9LMA",
  "github_login": "octocat",
  "balance": 2000000,
  "threshold": 1000000,
  "gate": { "pass": true, "signature": "<gate attestation, or \"\">" },
  "would_create": {
    "action": "create_issue_and_apply_label",
    "title": "[build] Add a dark mode toggle to the roster page",
    "body": "**Build requested by @octocat** ...",
    "labels": ["fix-me"],
    "triggers_workflow": ".github/workflows/openhands-resolve.yml",
    "note": "DRY RUN — no issue was created and no label applied. ..."
  },
  "dry_run": true,
  "checked_at": "2026-07-12T00:00:00.000Z"
}
```

Below threshold, `authorized` is `false` and `would_create` is `null`.

## Config

Same keys as `gate` (this skill passes `config` straight through to it). Copy
`skills/gate/config.example.json` → `config.json` (gitignored) or set env vars. **No real values
are committed.**

| Key | Where | Who sets it |
|---|---|---|
| `Z_MINT` | config.json / env | **Andy** — the canonical $Z mint address |
| `Z_THRESHOLD` | config.json / env | **Andy** — token amount for the build tier, from a dollar target |
| `HELIUS_RPC_URL` | **env only** | includes the Helius API key; never committed |
| `SECOND_RPC_URL` | **env only** | optional second provider; on disagreement the gate **fails closed** |

## Reliability posture

- **Fail closed, never open.** Inherited from `gate`: an RPC error, missing config, or two RPCs
  disagreeing yields no authorization. A down or lying RPC must never grant a build request.
- **Answers, never acts.** The most it produces is data describing a mutation. A human or a
  write-capable action performs it, deliberately.

## Smoke test

```bash
node smoke.mjs   # stubs the RPC, runs the real imported gate, asserts authorize/deny + issue shape. No keys. Exits 0 on pass.
```

## Two deliberate gaps left for a human decision

1. **The resolver is inert.** `.github/workflows/openhands-resolve.yml` does nothing until
   `LLM_API_KEY` is set as a real secret — a separate, deliberate decision.
2. **This skill is dry-run only.** It returns the issue it would create; it does not create it.
   Wiring a write-capable step (bot token) to execute `would_create` is a separate, deliberate
   decision, for the same reason the key is unset: real cost, real spam surface.

## Author

Maintainers' skill (gates the OpenHands door). Fill `author` in `skill.json` with the maintainer
member id at merge time.
