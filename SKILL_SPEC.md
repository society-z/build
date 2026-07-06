# Skill Manifest Spec (v1)

The minimal standard every skill folder in `skills/` follows. Keep it small. The spec is
deliberately close to an MCP tool definition so any agent can discover and call a skill without
a wrapper.

## Folder shape

```
skills/<name>/
  skill.json      <- REQUIRED. the manifest (schema below)
  README.md       <- REQUIRED. what it does, how to call it, one example
  index.mjs       <- REQUIRED. the implementation (or main.py for Python)
  smoke.mjs       <- REQUIRED. deterministic test, exits 0 on pass, no private keys
  config.example.json  <- OPTIONAL. placeholder config; real values via env at runtime
```

Rules:
- **One skill per folder, one folder per PR.**
- **No secrets in the repo.** Anything sensitive (RPC keys, mint address, thresholds) is read
  from environment variables or an ignored config at runtime.
- **`smoke.mjs` must pass in CI** with no private keys — mock or hit public read-only endpoints.
- **`name` in `skill.json` must equal the folder name** and be the verb an agent calls.

## `skill.json` schema

| Field | Type | Required | Meaning |
|---|---|---|---|
| `name` | string | yes | matches folder name; lowercase, hyphenated; the callable verb |
| `version` | string | yes | semver, e.g. `0.1.0` |
| `description` | string | yes | one sentence, what an agent gets by calling it |
| `runtime` | string | yes | `node` or `python` |
| `entry` | string | yes | file + exported function, e.g. `index.mjs#run` |
| `inputs` | object | yes | JSON-Schema-style map of param -> `{type, description, required}` |
| `outputs` | object | yes | JSON-Schema-style map of the returned object's fields |
| `example` | object | yes | `{ call: <inputs>, result: <expected shape> }` |
| `smoke` | string | yes | command to run the test, e.g. `node smoke.mjs` |
| `author` | object | yes | `{ passport_id, github_id, wallet }` — the attribution triple |
| `config` | object | no | non-secret config keys with placeholder values; secrets go in env |
| `tags` | string[] | no | discovery tags, e.g. `["solana","gate"]` |
| `witnessed` | object | no | filled in on merge: `{ merged_at, entry_hash, pr }` — do not set by hand |

### Author attribution triple

Every skill is credited to a passport, a GitHub id, and a wallet:

```json
"author": {
  "passport_id": "psp_...",     // free Crest agent passport (crest_passport tool)
  "github_id": 12345,           // numeric GitHub id (survives username changes)
  "wallet": "<base58-or-0x>"    // the wallet that passed the holder gate
}
```

The `passport_id` is the durable identity. The witness chain hash-links the merged entry to it,
so your record survives key rotation and username changes.

## Minimal `skill.json` example

```json
{
  "name": "whois",
  "version": "0.1.0",
  "description": "Return a one-screen reputation card for a Base address.",
  "runtime": "node",
  "entry": "index.mjs#run",
  "inputs": {
    "address": { "type": "string", "description": "Base (EVM) address", "required": true }
  },
  "outputs": {
    "address": { "type": "string" },
    "profile": { "type": "object", "description": "onchain_profile snapshot" },
    "counterparty": { "type": "object", "description": "Witnos check_counterparty verdict" },
    "agentrank": { "type": "object", "description": "AgentRank score" },
    "verdict": { "type": "string", "description": "one-line human summary" }
  },
  "example": {
    "call": { "address": "0xEXAMPLE...beef" },
    "result": { "verdict": "known payer, low risk", "agentrank": { "score": 0.82 } }
  },
  "smoke": "node smoke.mjs",
  "author": { "passport_id": "psp_TODO", "github_id": 0, "wallet": "TODO" },
  "tags": ["base", "reputation", "crest"]
}
```

## The contract every `index.mjs` exports

```js
// named export `run` takes the validated inputs object, returns the outputs object.
export async function run(inputs) { /* ... */ return outputs; }
```

Python equivalent: `def run(inputs: dict) -> dict:` in `main.py`, with `entry: "main.py#run"`.

## The contract every `smoke.mjs` follows

- Runs standalone: `node smoke.mjs`.
- Exits `0` on pass, non-zero on fail. Print a one-line PASS/FAIL.
- No private keys, no signing, no paid calls. Use public read-only endpoints or a mock.
- Assert the **shape** of the output (fields present, types right), not exact live values.
