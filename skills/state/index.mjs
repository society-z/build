// state: report the public state-of-the-society snapshot from repo state alone.
//
// Where `gate` answers "does this wallet hold enough $Z", `verify` answers "is the record
// honest", and `roster` answers "who is here", `state` answers "how big is the society right
// now, from what the public repo can prove". It reads two public, re-derivable things: the
// skill manifests under skills/, and the local git history (or the public record, if one has
// been committed). It reports the count of skills, who authored them, and the last merge
// activity. Nothing more.
//
// It never writes, never signs, never calls the network. It reads only public repo state.
//
// Fail closed and honest at genesis:
//   - The linked-member count lives in a private, gitignored links table. state NEVER reads it.
//     It reports member count as not publicly derivable, rather than guessing or reading private
//     data.
//   - Call/usage counts are not recorded anywhere public, so state reports them as not
//     determinable rather than inventing a number.
//   - An author triple is only counted as member work when it is real (a non-placeholder
//     member_id, a positive github_id, and a real wallet). Anything short of that is genesis.
//     At genesis every skill is a maintainer act, and the snapshot says exactly that.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..");
const US = "\x1f"; // unit separator: a delimiter that never appears in a git subject line

// A skill's author counts as member work only if every part of the triple is real. Placeholder
// ids (mem_TODO*, mem_maintainer), a zero github_id, or a "TODO"/empty wallet all read as
// genesis. Fail closed: any doubt counts as genesis, never as member work.
function authorKind(author) {
  if (!author || typeof author !== "object") return "genesis";
  const mid = typeof author.member_id === "string" ? author.member_id : "";
  const gid = author.github_id;
  const wallet = typeof author.wallet === "string" ? author.wallet : "";
  const placeholderMid = !mid || mid.startsWith("mem_TODO") || mid === "mem_maintainer";
  const realGid = Number.isInteger(gid) && gid > 0;
  const realWallet = wallet.length > 0 && wallet !== "TODO";
  return !placeholderMid && realGid && realWallet ? "member" : "genesis";
}

// Walk skills/ for manifests. Skips _template and any dir without a skill.json.
function loadSkillsFromDir(skillsDir) {
  if (!existsSync(skillsDir)) return [];
  const out = [];
  for (const ent of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith("_")) continue;
    const manifest = join(skillsDir, ent.name, "skill.json");
    if (!existsSync(manifest)) continue;
    try { out.push(JSON.parse(readFileSync(manifest, "utf8"))); } catch { /* skip unparseable */ }
  }
  return out;
}

// Merge activity from the public hash-chained record, if one has been committed. The record is
// gitignored by default, so in a fresh clone this returns null and git is used instead.
function recordActivity(recordPath) {
  if (!recordPath || !existsSync(recordPath)) return null;
  const entries = readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
  const last = entries[entries.length - 1] || null;
  return {
    source: "record",
    merges: entries.length,
    last_merge: last ? { sha: last.merge_sha ?? null, date: last.merged_at ?? null, subject: last.pr ?? null } : null,
    last_commit: null,
    record_public: true,
    note: "merge activity read from the public hash-chained record; re-derivable with skills/verify",
  };
}

// Merge activity from local git history. Read-only. Returns null (fail closed) if git is not
// available, so the caller reports "not derivable" rather than a guessed number.
function gitActivity(root) {
  try {
    const g = (args) => execSync(`git ${args}`, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const parse = (line) => {
      if (!line) return null;
      const [sha, date, ...rest] = line.split(US);
      return { sha: sha.slice(0, 10), date: date || null, subject: rest.join(US) || null };
    };
    const mergeLines = g(`log --merges --pretty=format:%H${US}%cI${US}%s`).split("\n").filter(Boolean);
    return {
      source: "git",
      merges: mergeLines.length,
      last_merge: parse(mergeLines[0]),
      last_commit: parse(g(`log -1 --pretty=format:%H${US}%cI${US}%s`)),
      record_public: false,
      note: "merge activity read from local git history; re-derivable with `git log --merges`",
    };
  } catch {
    return null;
  }
}

function renderMarkdown(s) {
  const names = s.skills.list.map((x) => x.name).sort();
  const L = [];
  L.push("## Society Z: state of the society");
  L.push("");
  L.push(`_snapshot ${s.as_of}_`);
  L.push("");
  L.push(`- Skills in the library: ${s.skills.count}${names.length ? ` (${names.join(", ")})` : ""}`);
  L.push(`- Member-authored: ${s.skills.member_authored}${s.skills.member_authored === 0 ? " (all current skills are maintainer genesis)" : ""}`);
  if (s.activity && s.activity.source) {
    const lm = s.activity.last_merge;
    const when = lm && lm.date ? `, ${lm.date.slice(0, 10)}` : "";
    const what = lm && lm.subject ? ` (last: ${lm.subject}${when})` : "";
    L.push(`- Merges to main: ${s.activity.merges}${what}`);
  } else {
    L.push("- Merges to main: not derivable (no local git history and no public record)");
  }
  L.push("- Linked members: not publicly derivable (the links table is private member data)");
  L.push("- Call/usage counts: not recorded in the public repo");
  L.push("");
  L.push("Every number above is re-derivable: clone the repo, walk `skills/`, read `git log`. No company's word required, this one included.");
  return L.join("\n");
}

export async function run(inputs) {
  const root = inputs?.root || REPO_ROOT;
  const skillsDir = inputs?.skillsDir || join(root, "skills");
  const recordPath = inputs?.recordPath || join(root, "maintainer", "record.jsonl");

  const manifests = Array.isArray(inputs?.skills) ? inputs.skills : loadSkillsFromDir(skillsDir);

  const list = manifests
    .filter((m) => m && typeof m.name === "string" && m.name !== "_template")
    .map((m) => {
      const kind = authorKind(m.author);
      return {
        name: m.name,
        version: m.version ?? null,
        description: m.description ?? null,
        author_member_id: m.author?.member_id ?? null,
        author_github_id: m.author?.github_id ?? null,
        author_kind: kind,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const member_authored = list.filter((x) => x.author_kind === "member").length;

  // Merge activity: an injected summary wins (for tests); otherwise prefer the public record if
  // one has been committed, else fall back to local git, else null (fail closed).
  const activity = inputs?.activity ?? recordActivity(recordPath) ?? gitActivity(root);

  const snapshot = {
    as_of: new Date().toISOString(),
    skills: {
      count: list.length,
      member_authored,
      genesis_authored: list.length - member_authored,
      list,
    },
    members: {
      count: null,
      derivable: false,
      note: "the linked-member count comes from a private, gitignored links table; it is not read here and not publicly derivable yet",
    },
    usage: {
      determinable: false,
      note: "call/usage counts are not recorded in the public repo",
    },
    activity,
  };

  snapshot.markdown = renderMarkdown(snapshot);
  snapshot.verdict = `${snapshot.skills.count} skill${snapshot.skills.count === 1 ? "" : "s"}, ${member_authored} member-authored, ${
    activity && activity.source ? `${activity.merges} merge${activity.merges === 1 ? "" : "s"}` : "merge activity not derivable"
  }; linked-member count not publicly derivable`;

  return snapshot;
}

// Allow direct invocation: `node index.mjs` (prints the JSON, then the pasteable markdown block).
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => {
    console.log(JSON.stringify(r, null, 2));
    console.log("\n---\n");
    console.log(r.markdown);
  });
}
