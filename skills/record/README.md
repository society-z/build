# record — a member's real merge history, from this repo's own history

**"Every merge is signed to you, forever." This skill makes that promise queryable.** Given
nothing, it lists every merged skill contribution. Given a filter, it narrows to one member's.
For each merge it reports the commit SHA, the date, the skill(s) touched, and a one-line
description. No external service. No company's word required, this one included.

Where [`gate`](../gate/) answers "does this wallet hold enough $Z," [`verify`](../verify/)
answers "is the record honest," and [`roster`](../roster/) answers "who is here," `record`
answers "what has this member actually shipped, and when."

## Two sources, canonical first — and it tells you which one it used

1. **`maintainer/record.jsonl` — the canonical, hash-chained record.** The maintainer bot
   appends one entry per gated merge, carrying the full attribution triple (`github_login`,
   `member_id`, `wallet`) and the $Z balance held at merge. That is the source of truth, and
   [`verify`](../verify/) proves it is intact.

2. **This repo's own `git log` — the honest interim source, used today.** The canonical record
   **does not exist in the repo yet**: it is written only once the maintainer bot runs in
   production with `AUTO_MERGE`. Until then, `record` reads git history instead. This is not a
   fallback that pretends to be the real thing — the output's `source` field says `"git"` and a
   caveat says so in words.

`main` is protected: every commit on it arrived through a gated, merged PR (the
`society-z/holder-gate` check is required). So **a commit on `main` that touches a skill is a
merged contribution.** That is what git mode reports: the non-merge commits on `main` that
added or changed a skill folder (excluding `_template`), newest first.

## The honest limit of git mode

Git records an author **name and email**, not a `github_login` and not a **wallet**. So in git
mode there is no wallet-level attribution, and this skill refuses to invent one:

- `filter` matches a substring of the commit author name/email (and the skill names touched).
- `github_login` and `wallet` are **real attribution only in the canonical record**. Pass them
  in git mode and the skill does not silently guess — it returns a caveat explaining that git
  history cannot resolve them, and leaves those fields `null` on every merge.

Real wallet-level "this merge is signed to this wallet" attribution requires the maintainer
bot's `record.jsonl`. When that file lands, `record` reads it automatically, `source` becomes
`"record"`, and `github_login` / `wallet` become exact filters over real, hash-chained data.

## Call it

```bash
# every merged skill contribution, newest first
node index.mjs '{}'

# narrow to one contributor by author substring (git mode)
node index.mjs '{"filter":"salvo"}'
```

```jsonc
// git-mode output (today, at genesis — abridged)
{
  "source": "git",
  "count": 4,
  "merges": [
    {
      "source": "git",
      "sha": "e54dbdce6d9e2684663241a64f91c99ab873d00e",
      "sha_short": "e54dbdce6d9e",
      "date": "2026-07-11T23:17:16-04:00",
      "skills": [
        { "name": "roster", "description": "Read the SIWS-proven links table and report Society Z's current member list, with no external service." }
      ],
      "subject": "Genesis prep: roster skill + manual SIWS signing tool",
      "author_name": "Andy Salvo",
      "author_email": "ajs10845@psu.edu",
      "github_login": null,
      "member_id": null,
      "wallet": null,
      "wallet_short": null,
      "pr": null,
      "held_z_at_merge": null
    }
  ],
  "filter": null,
  "caveats": [
    "reading git history, not the canonical hash-chained record: maintainer/record.jsonl does not exist yet ..."
  ],
  "reason": "4 merges (from git history, interim)",
  "as_of": "2026-07-12T04:00:00.000Z"
}
```

The one-line `description` on each skill is the skill's **own current `skill.json`
description** when the skill still exists in the tree; when a skill was later removed or
renamed, its description is `null` and the commit `subject` stands in at the merge level. That
is honest: the description reflects the skill as it stands, the subject reflects the merge as it
happened.

Once the canonical record exists you filter by real identity:

```bash
node index.mjs '{"github_login":"ada"}'     # record mode: exact, wallet-level
node index.mjs '{"wallet":"AdaWallet…"}'    # record mode: exact
```

You can also pass data directly instead of touching disk or git — `entries` (canonical record
rows) or `commits` (git-log-shaped rows):

```js
import { run } from "./index.mjs";
const out = await run({ entries: [{ github_login: "ada", member_id: "mem_ada", wallet: "…",
  pr: "society-z/build#7", merge_sha: "…", held_z_at_merge: 1000, merged_at: "2026-07-09T00:00:00Z" }] });
```

## Genesis is honest

If the history holds no member skill merges, `record` reports zero. It never pads the list,
never projects, and never fabricates a merge that did not happen. An empty history is a true
history.

## Reliability posture

Read-only: it never writes, never signs, never calls the network. It reuses git — the repo's
own history — rather than a mirror it would have to be trusted to keep in sync. If git is
unavailable in some sandbox it returns an empty result with a caveat instead of crashing (assume
git is present inside a checkout).

## Smoke test

```bash
node smoke.mjs   # runs against this repo's REAL git log (offline, no keys), plus in-memory
                 # fixtures for the canonical-record path and identity filtering. Prints
                 # SMOKE PASS / SMOKE FAIL, exits 0 on pass.
```

## Author

Genesis skill, a worked example. It reads one thing (this repo's own merge history) and reports
one thing (who shipped what, and when), and it is explicit about the one thing git history
cannot tell you: which wallet a merge is signed to. That answer waits for the canonical record.
