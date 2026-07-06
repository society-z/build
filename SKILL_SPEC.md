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
| `author` | object | yes | `{ member_id, github_id, wallet }` — the attribution triple |
| `config` | object | no | non-secret config keys with placeholder values; secrets go in env |
| `tags` | string[] | no | discovery tags, e.g. `["solana","gate"]` |
| `witnessed` | object | no | filled in on merge: `{ merged_at, entry_hash, pr }` — do not set by hand |

### Author attribution triple

Every skill is credited to a member id, a GitHub id, and a wallet:

```json
"author": {
  "member_id": "mem_...",        // assigned at wallet-link time (linking/), yours alone
  "github_id": 12345,            // numeric GitHub id (survives username changes)
  "wallet": "<base58-or-0x>"     // the wallet that passed the holder gate
}
```

The `member_id` is the durable identity. Society Z's own record hash-links the merged entry to
it, so your record survives key rotation and username changes.

## Minimal `skill.json` example

```json
{
  "name": "verify",
  "version": "0.1.0",
  "description": "Re-derive Society Z's own hash-chained record and report whether it's intact.",
  "runtime": "node",
  "entry": "index.mjs#run",
  "inputs": {
    "path": { "type": "string", "description": "path to a record.jsonl file", "required": false }
  },
  "outputs": {
    "count": { "type": "number" },
    "head": { "type": "string" },
    "valid": { "type": "boolean" },
    "broken_at": { "type": "number", "description": "index of the first break, or null" },
    "verdict": { "type": "string", "description": "one-line human summary" }
  },
  "example": {
    "call": { "path": "record.jsonl" },
    "result": { "count": 2, "valid": true, "broken_at": null }
  },
  "smoke": "node smoke.mjs",
  "author": { "member_id": "mem_TODO", "github_id": 0, "wallet": "TODO" },
  "tags": ["verification", "record", "no-external-dependency"]
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
