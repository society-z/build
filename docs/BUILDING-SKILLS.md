# Building a skill that belongs here

`SKILL_SPEC.md` tells you the file shape a skill must have. `CONTRIBUTING.md` tells you how a
skill gets merged. This document tells you what makes a skill **correct** — the standard the
two genesis skills set, written down so every skill after them holds the same line.

A skill that follows the spec but breaks these rules will not merge. A maintainer reviewing a
PR reads this list top to bottom.

## The shape: read one thing, prove one thing, no side effects

`skills/verify/` is the canonical example. It reads the record, recomputes every hash, and
reports where the chain breaks, if anywhere. It never writes, never calls the network, and
never asks you to trust it — you can re-run it yourself.

`skills/gate/` is the same shape under load: it reads a balance on-chain, compares it to a
threshold, and returns a verdict. The only signature it ever produces is an attestation over
its own verdict.

Every skill answers one question an agent would actually ask. If your skill answers two
questions, it is two skills. If it performs an action instead of answering a question, stop:
see "skills never act" below.

## The rules, and where each one comes from

1. **Verifiable over trusted.** The society's core promise is "no company's word required."
   A skill must not make its caller trust a company, an API key holder, or us. Prefer sources
   the caller could check themselves: on-chain reads, the repo's own history, public
   endpoints. If a skill consumes a privileged source, its output must say so plainly.
   (Source: /how — "clone the repo, run skills/verify, and re-derive the whole chain
   yourself"; verify's own README.)

2. **Import the primitive, never reimplement it.** verify imports `canonical()` and
   `sha256()` from the maintainer's own `record.mjs` rather than copying them, so the checker
   can never silently drift from the writer. If the thing you are proving has one canonical
   implementation in this repo, import it. A second implementation of a security primitive is
   a fork of the truth. (Source: skills/verify/index.mjs.)

3. **Fail closed.** When a skill cannot know the answer — an RPC is down, two sources
   disagree, a file is missing — it reports failure or the conservative reading. It never
   guesses in the caller's favor. The gate takes the lower of two disagreeing balances; your
   skill inherits that posture. (Source: skills/gate/README.md, reliability posture.)

4. **Skills never act.** No skill signs transactions, moves funds, posts, sends, or mutates
   anything outside its own folder's declared outputs. Skills answer; principals act. An
   agent may *prepare* an unsigned transaction as data; only a human principal signs.
   The gate is read-only on-chain, forever, and it is the most powerful skill here.
   (Source: CONTRIBUTING.md, "What needs a maintainer"; gate README.)

5. **Honest at genesis.** A skill's README and outputs state exactly what is true now. Zero
   members means the roster prints zero members. An empty record is a valid, honest output.
   Never pad, never project, never fabricate example data that looks like live data.
   (Source: /record — "No member merges yet. The society is at genesis.")

6. **Deterministic smoke, offline.** `smoke.mjs` passes with no keys, no network, no paid
   calls, using fixtures or the repo itself. It asserts the shape of outputs, not live
   values. A skill whose test needs someone's API key is a skill nobody can verify.
   (Source: SKILL_SPEC.md.)

7. **No secrets, no exceptions.** Mint address, thresholds, RPC keys, signing keys: env or
   gitignored config at runtime. The example config commits placeholders only.
   (Source: SKILL_SPEC.md; gate config table.)

8. **Name it how it is used.** The folder name is the verb an agent calls. `gate`, `verify`,
   `roster` — not `z-holder-balance-checker-v2`. One word if possible.
   (Source: CONTRIBUTING.md.)

9. **Small enough to witness.** One skill per PR, roughly the size of gate or verify. The
   record entry for your merge should be reviewable by a human in one sitting. Big bundles
   merge slower, review worse, and mint a muddier record.
   (Source: CONTRIBUTING.md.)

10. **Attributed or it did not happen.** `author` in `skill.json` carries the triple —
    member id, numeric GitHub id, wallet. That triple is what the merge hash-chains into the
    record. A skill with a placeholder author merges only as a maintainer genesis act,
    never as member work. (Source: SKILL_SPEC.md, attribution triple.)

## What to build

The society builds itself first. The organs the site names as member work — the roster, the
record reader, the public state snapshot, better agents, better tools — are open. Check
`skills/` for what exists before you start: a skill that duplicates a merged skill will not
merge; extend the existing one instead.

A good first skill reads one real thing about the society or its chain and proves or reports
it. Copy `skills/verify/` and start there.

## What will not merge

- A skill that acts (signs, sends, posts, mutates) instead of answering.
- A skill whose smoke test needs the network or a key.
- A skill that reimplements a primitive this repo already has.
- A skill that trusts where it could verify.
- A skill whose README claims activity, members, or usage that does not exist.
- Two skills in one PR.
- Anything with a secret in it, including "just an example" keys.
