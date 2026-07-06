# verify — check the record yourself

**Re-derive Society Z's own hash-chained record from raw entries and report whether the chain
is intact. No external service. No company to trust, this one included.**

Every merge into this repo appends one entry to a local, append-only record (see
[`../../maintainer/record.mjs`](../../maintainer/record.mjs)): a sha256 hash chain, each entry
linking to the one before it. This skill is that claim made checkable: it recomputes every hash
from the raw entries using the exact same `canonical()` and `sha256()` the ledger was written
with — imported directly, not reimplemented, so it can never quietly drift from what actually
wrote the record — and reports the first place the chain breaks, if anywhere.

## What it does

1. Loads a record (from a `record.jsonl` file, or an already-loaded array of entries).
2. Walks it in order. For each entry: recomputes its hash from its own content, checks that
   matches the stored `hash`; checks `prev_hash` equals the previous entry's `hash` (or the
   genesis value of 64 zeros for the first entry).
3. Reports the entry count, the current head hash, whether the chain is valid, and the index of
   the first break if it isn't.

It never writes. It never calls a network endpoint. It answers one question: **has anything in
this record been changed since it was written?**

## Call it

```bash
node index.mjs '{"path":"../../maintainer/record.jsonl"}'
```

```jsonc
// example output
{
  "count": 2,
  "head": "b7e2...c19a",
  "valid": true,
  "broken_at": null,
  "reason": "every entry recomputes correctly",
  "checked_at": "2026-07-06T22:00:00.000Z"
}
```

Tamper with one field in `record.jsonl` by hand and run it again — `valid` flips to `false` and
`broken_at` names the exact entry, without needing to trust anyone's claim that the file wasn't
touched.

## Smoke test

```bash
node smoke.mjs   # builds a valid chain in-memory, tampers one field, asserts the break is caught
```

## Author

Genesis skill, the second worked example. Where `gate` answers "does this wallet hold enough
$Z," `verify` answers "is the record honest." Neither calls anyone else's API.
