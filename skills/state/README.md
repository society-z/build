# state: the public state of the society

**Report the state-of-the-society snapshot from public repo state alone. No external service.
No company's word required, this one included.**

How many skills are in the library, who authored them, and when the last merge landed. This
skill reads two public, re-derivable things and reports them: the skill manifests under
[`../`](../), and the local git history (or the committed public record, if one exists). It
produces both a JSON object and a rendered markdown block you can paste into a README or a post.

Where [`gate`](../gate/) answers "does this wallet hold enough $Z", [`verify`](../verify/)
answers "is the record honest", and [`roster`](../roster/) answers "who is here", `state`
answers "how big is the society right now, from what the repo can prove".

## What it reports

- **Skills:** the count, and one line per skill (`name`, `version`, `author_member_id`,
  `author_github_id`, `author_kind`). An author counts as `member` work only when its triple is
  real: a non-placeholder `member_id`, a positive `github_id`, and a real wallet. Anything short
  of that is `genesis`. `member_authored` and `genesis_authored` always sum to the count.
- **Merge activity:** the number of merges and the last one, read from the committed public
  record if one exists, otherwise from local `git log --merges`. If neither is available it
  reports "not derivable" rather than a guess.

## What it will not pretend to know

- **Linked members.** The member count lives in a private, gitignored links table
  (`maintainer/links.json`). This skill **never reads it**. It reports member count as `null`
  with `derivable: false`, because it is not derivable from public repo state yet. A member
  count is member data; a public snapshot does not fabricate it.
- **Call/usage counts.** Nothing public records how often a skill is called, so `state` reports
  usage as `determinable: false` rather than inventing a number.

## Honest at genesis

Today the society is small: three skills, all maintainer genesis, one merge. The snapshot says
exactly that. It never pads the count, never projects growth, and never invents members or
usage. A tiny true snapshot is the point.

It never writes, never signs, never calls the network. Everything it reports is re-derivable by
cloning the repo.

## Call it

```bash
node index.mjs        # prints the JSON snapshot, then the pasteable markdown block
```

```jsonc
// snapshot of this repo at genesis (shape; timestamps and hashes vary)
{
  "as_of": "2026-07-12T03:14:00.000Z",
  "skills": {
    "count": 3,
    "member_authored": 0,
    "genesis_authored": 3,
    "list": [
      { "name": "gate", "version": "0.1.0", "author_member_id": "mem_TODO_maintainer", "author_github_id": 0, "author_kind": "genesis" },
      { "name": "roster", "version": "0.1.0", "author_member_id": "mem_maintainer", "author_github_id": 0, "author_kind": "genesis" },
      { "name": "verify", "version": "0.1.0", "author_member_id": "mem_maintainer", "author_github_id": 0, "author_kind": "genesis" }
    ]
  },
  "members": { "count": null, "derivable": false, "note": "not read here; not publicly derivable yet" },
  "usage": { "determinable": false, "note": "call/usage counts are not recorded in the public repo" },
  "activity": { "source": "git", "merges": 1, "last_merge": { "subject": "Merge pull request #1 from society-z/skill/roster" } },
  "markdown": "## Society Z: state of the society ...",
  "verdict": "3 skills, 0 member-authored, 1 merge; linked-member count not publicly derivable"
}
```

The rendered markdown block (the `markdown` field, also printed after the JSON):

```md
## Society Z: state of the society

_snapshot 2026-07-12T03:14:00.000Z_

- Skills in the library: 3 (gate, roster, verify)
- Member-authored: 0 (all current skills are maintainer genesis)
- Merges to main: 1 (last: Merge pull request #1 from society-z/skill/roster, 2026-07-12)
- Linked members: not publicly derivable (the links table is private member data)
- Call/usage counts: not recorded in the public repo
```

You can also pass manifests and an activity summary directly instead of touching the
filesystem or git:

```js
import { run } from "./index.mjs";
const out = await run({ skills: [/* manifests */], activity: { source: "git", merges: 1, last_merge: {/*...*/} } });
```

## Smoke test

```bash
node smoke.mjs   # runs against this repo's own skills/ (offline fixture), then against injected
                 # manifests + activity: checks author classification, the fail-closed member and
                 # usage fields, and the rendered markdown. No network, no keys.
```

## Author

Genesis skill, the fourth worked example. It reads two public things (the skill manifests and
the git history) and reports one thing (the snapshot), and it tells the truth about how small
the society is today: three skills, zero member-authored, one merge, member count not yet
public.
