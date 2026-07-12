// state smoke test: deterministic, no network, no keys.
// Two passes. First against this repo's own skills/ directory (the real, small, offline
// fixture): the snapshot must be honest about a tiny society. Second against an injected set of
// manifests plus an injected activity summary, to check author classification, the fail-closed
// member/usage fields, and the rendered markdown, with no filesystem and no git.
import { run } from "./index.mjs";

let failed = false;
const assert = (c, m) => { if (!c) { console.error("FAIL:", m); failed = true; } };

// Pass 1: the real repo. Uses skills/ on disk and local git history. Assert shape and the
// honest floor (at least the three genesis skills exist, none over-claimed as member work).
let out = await run({});
assert(typeof out.as_of === "string", "as_of is an ISO string");
assert(out.skills && typeof out.skills.count === "number", "skills.count is a number");
assert(out.skills.count >= 3, "at least the three genesis skills are present");
const names = out.skills.list.map((x) => x.name);
for (const n of ["gate", "verify", "roster"]) assert(names.includes(n), `library includes ${n}`);
assert(!names.includes("_template"), "_template is excluded");
assert(out.skills.member_authored + out.skills.genesis_authored === out.skills.count, "author kinds partition the count");
assert(out.skills.member_authored === 0, "at genesis no skill is member-authored (all placeholder authors)");
assert(out.members.count === null && out.members.derivable === false, "member count reported as not derivable");
assert(out.usage.determinable === false, "usage reported as not determinable");
assert(out.activity === null || out.activity.source === "git" || out.activity.source === "record",
  "activity source is git, record, or null (fail closed)");
assert(typeof out.markdown === "string" && out.markdown.includes(`Skills in the library: ${out.skills.count}`),
  "markdown reflects the real skill count");
assert(out.markdown.includes("not publicly derivable"), "markdown states member count is not derivable");
assert(!out.markdown.includes("—"), "markdown uses no em dashes");

// Pass 2: injected manifests + injected activity. Fully deterministic, no fs, no git.
const manifests = [
  { name: "gate", version: "0.1.0", description: "d", author: { member_id: "mem_TODO_maintainer", github_id: 0, wallet: "TODO" } },
  { name: "roster", version: "0.1.0", description: "d", author: { member_id: "mem_maintainer", github_id: 0, wallet: "TODO" } },
  { name: "aria", version: "0.1.0", description: "d", author: { member_id: "mem_aria", github_id: 4242, wallet: "9UH61sRealWallet1111111111111111111111119LMA" } },
  { name: "_template", version: "0.1.0", description: "d", author: { member_id: "mem_TODO", github_id: 0, wallet: "TODO" } },
];
const activity = {
  source: "git",
  merges: 1,
  last_merge: { sha: "c22db4f000", date: "2026-07-12T03:00:00.000Z", subject: "Merge pull request #1 from society-z/skill/roster" },
  last_commit: { sha: "c22db4f000", date: "2026-07-12T03:00:00.000Z", subject: "Merge pull request #1 from society-z/skill/roster" },
  record_public: false,
  note: "injected",
};
out = await run({ skills: manifests, activity });
assert(out.skills.count === 3, "_template excluded from injected manifests");
assert(out.skills.member_authored === 1, "one real triple counts as member-authored");
assert(out.skills.genesis_authored === 2, "two placeholder authors count as genesis");
const aria = out.skills.list.find((x) => x.name === "aria");
assert(aria && aria.author_kind === "member", "a real author triple classifies as member");
const gate = out.skills.list.find((x) => x.name === "gate");
assert(gate && gate.author_kind === "genesis", "a placeholder author triple classifies as genesis");
assert(out.skills.list[0].name === "aria", "skills sorted by name (aria first)");
assert(out.activity.merges === 1, "injected activity passes through");
assert(out.markdown.includes("(last: Merge pull request #1"), "markdown shows the last merge");
assert(/1 skill.*1 member-authored.*1 merge/.test(out.verdict) || out.verdict.includes("member-authored"), "verdict summarizes state");

// Pass 3: empty library, no activity. Honest at zero, fail closed.
out = await run({ skills: [], activity: null, recordPath: "/nonexistent/record.jsonl", root: "/nonexistent" });
assert(out.skills.count === 0, "empty library => zero skills");
assert(out.markdown.includes("Skills in the library: 0"), "markdown honestly prints zero skills");

console.log(failed ? "SMOKE FAIL" : "SMOKE PASS: state");
process.exit(failed ? 1 : 0);
