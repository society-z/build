// record — render a member's real merge history from this repo's own history.
//
// The society's promise is "every merge is signed to you, forever." This skill makes that
// promise queryable: given nothing, it lists every merged skill contribution; given a filter,
// it narrows to one member's. For each merge it reports the commit SHA, the date, the skill(s)
// touched, and a one-line description (the skill's own skill.json description when the skill
// still exists, else the commit subject).
//
// Two data sources, in order of trust:
//
//   1. maintainer/record.jsonl — the CANONICAL, hash-chained record the maintainer bot appends
//      on every gated merge. It carries the full attribution triple (github_login, member_id,
//      wallet) and the balance held at merge. This is the source of truth. It does not exist in
//      the repo yet: it is written only once the bot runs in production with AUTO_MERGE. When it
//      appears, this skill reads it and every field below is real, wallet-level attribution.
//
//   2. this repo's own `git log` (the honest interim source, used TODAY). `main` is protected:
//      every commit on it arrived through a gated, merged PR. So a commit on main that touches a
//      skill IS a merged contribution. git records an author NAME and EMAIL, not a github_login
//      or a wallet — so in this mode there is no wallet-level attribution, and this skill says so
//      plainly rather than inventing one. You can filter by a substring of the author name/email;
//      you cannot honestly filter git history by wallet.
//
// Read-only. Never writes, never signs, never calls the network. If git is unavailable it
// degrades to an empty result instead of crashing.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

// Repo root is two levels up from skills/record/. Overridable for tests.
const DEFAULT_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const US = "\x1f"; // unit separator between fields
const RS = "\x1e"; // record separator between commits

function shortSha(sha) {
  return typeof sha === "string" ? sha.slice(0, 12) : null;
}

function shortWallet(w) {
  if (typeof w !== "string" || w.length <= 14) return w || null;
  return `${w.slice(0, 6)}…${w.slice(-6)}`;
}

// The one-line description for a skill: its current skill.json `description` if the skill still
// exists in the tree, else null (the commit subject stands in at the merge level).
function skillDescription(root, name) {
  try {
    const p = `${root}/skills/${name}/skill.json`;
    if (!existsSync(p)) return null;
    const json = JSON.parse(readFileSync(p, "utf8"));
    return typeof json.description === "string" ? json.description : null;
  } catch {
    return null;
  }
}

// From a commit's touched paths, the set of skill folder names it changed, excluding _template.
function skillsFromPaths(paths, root) {
  const names = new Set();
  for (const path of paths) {
    const m = /^skills\/([^/]+)\//.exec(path);
    if (m && m[1] !== "_template") names.add(m[1]);
  }
  return [...names].map((name) => ({ name, description: skillDescription(root, name) }));
}

// Run `git log` over skills/, parse into commit records. Returns [] if git is unavailable so the
// skill degrades gracefully in a sandbox that has no git (assume it IS present inside a checkout).
function gitCommits(root) {
  let raw;
  try {
    raw = execFileSync(
      "git",
      [
        "log",
        "--no-merges",
        `--format=${RS}%H${US}%an${US}%ae${US}%aI${US}%s`,
        "--name-only",
        "--",
        "skills",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
  } catch {
    return null; // git missing or not a repo — caller reports honestly
  }

  const commits = [];
  for (const block of raw.split(RS)) {
    const trimmed = block.replace(/^\n+/, "");
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const [sha, author_name, author_email, date, subject] = lines[0].split(US);
    const paths = lines.slice(1).map((l) => l.trim()).filter(Boolean);
    const skills = skillsFromPaths(paths, root);
    if (skills.length === 0) continue; // touched only _template — not a member skill merge
    commits.push({ sha, author_name, author_email, date, subject, skills });
  }
  return commits;
}

// Shape a git commit into the common merge object. author-level attribution only; wallet-level
// fields are null in git mode and honestly labelled as such by the caveat.
function fromGitCommit(c) {
  return {
    source: "git",
    sha: c.sha,
    sha_short: shortSha(c.sha),
    date: c.date,
    skills: c.skills,
    subject: c.subject,
    author_name: c.author_name,
    author_email: c.author_email,
    // Not available from git history alone:
    github_login: null,
    member_id: null,
    wallet: null,
    wallet_short: null,
    pr: null,
    held_z_at_merge: null,
  };
}

// Shape a canonical record.jsonl entry into the common merge object. Full attribution.
function fromRecordEntry(e, root) {
  const skills = e.merge_sha
    ? skillsFromMergeSha(root, e.merge_sha)
    : [];
  return {
    source: "record",
    sha: e.merge_sha || null,
    sha_short: shortSha(e.merge_sha),
    date: e.merged_at || null,
    skills,
    subject: e.pr || null,
    author_name: null,
    author_email: null,
    github_login: e.github_login ?? null,
    member_id: e.member_id ?? null,
    wallet: e.wallet ?? null,
    wallet_short: shortWallet(e.wallet),
    pr: e.pr ?? null,
    held_z_at_merge: e.held_z_at_merge ?? null,
  };
}

// Best-effort skill-name resolution for a record entry: ask git which skills that merge_sha
// touched. Read-only; returns [] if git can't answer. The record proves WHO and WHEN; git names
// WHAT, and the two only ever agree because both read this same repo.
function skillsFromMergeSha(root, mergeSha) {
  try {
    const out = execFileSync(
      "git",
      ["show", "--no-patch", "--format=", "--name-only", mergeSha, "--", "skills"],
      { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }
    );
    const paths = out.split("\n").map((l) => l.trim()).filter(Boolean);
    return skillsFromPaths(paths, root);
  } catch {
    return [];
  }
}

function loadRecordEntries(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Substring match, case-insensitive, over the fields honestly available for each source.
function matchesFilter(merge, needle) {
  if (!needle) return true;
  const n = needle.toLowerCase();
  const hay = [
    merge.author_name,
    merge.author_email,
    merge.github_login,
    merge.member_id,
    merge.wallet,
    ...(merge.skills || []).map((s) => s.name),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(n);
}

export async function run(inputs = {}) {
  const root = (inputs.repoRoot || inputs.config?.REPO_ROOT || DEFAULT_ROOT).replace(/\/$/, "");
  const caveats = [];

  // --- Choose the data source, canonical record first -----------------------------------------
  let source, rawMerges;

  if (Array.isArray(inputs.entries)) {
    source = "record";
    rawMerges = inputs.entries.map((e) => fromRecordEntry(e, root));
  } else if (Array.isArray(inputs.commits)) {
    source = "git";
    rawMerges = inputs.commits.map((c) => fromGitCommit(c));
  } else {
    const recordPath =
      inputs.path || inputs.config?.RECORD_FILE || `${root}/maintainer/record.jsonl`;
    if (existsSync(recordPath)) {
      source = "record";
      rawMerges = loadRecordEntries(recordPath).map((e) => fromRecordEntry(e, root));
    } else {
      source = "git";
      const commits = gitCommits(root);
      if (commits === null) {
        // git unavailable — fail soft with an honest empty result.
        return {
          source: "git",
          count: 0,
          merges: [],
          filter: inputs.filter || null,
          caveats: ["git is not available in this environment; no history could be read"],
          reason: "no history available (git unavailable and no canonical record.jsonl yet)",
          as_of: new Date().toISOString(),
        };
      }
      rawMerges = commits.map((c) => fromGitCommit(c));
      caveats.push(
        "reading git history, not the canonical hash-chained record: maintainer/record.jsonl " +
          "does not exist yet (written by the maintainer bot in production). git records an " +
          "author name/email, not a github_login or wallet, so this view has no wallet-level " +
          "attribution."
      );
    }
  }

  // --- Honest handling of identity filters that git cannot satisfy ----------------------------
  // github_login / wallet are real attribution only in record mode. In git mode we do NOT quietly
  // pretend to resolve them; we say so and fall back to the author-substring `filter`.
  let effectiveFilter = inputs.filter || null;
  if (source === "git") {
    if (inputs.github_login) {
      caveats.push(
        `github_login "${inputs.github_login}" cannot be resolved from git history alone ` +
          "(git has no GitHub login); wallet-level attribution needs the canonical record. " +
          "Use `filter` to match a commit author name/email instead."
      );
    }
    if (inputs.wallet) {
      caveats.push(
        `wallet "${shortWallet(inputs.wallet)}" cannot be resolved from git history alone; ` +
          "wallet attribution needs the canonical record. Ignoring it for this git-interim view."
      );
    }
  } else {
    // record mode: identity inputs become part of the filter against real attribution fields.
    if (inputs.github_login) effectiveFilter = inputs.github_login;
    if (inputs.wallet) effectiveFilter = inputs.wallet;
    // an explicit `filter` still wins if provided:
    if (inputs.filter) effectiveFilter = inputs.filter;
  }

  const merges = rawMerges
    .filter((m) => matchesFilter(m, effectiveFilter))
    .sort((a, b) => String(b.date).localeCompare(String(a.date))); // newest first

  const filtered = effectiveFilter != null;
  const reason =
    merges.length === 0
      ? filtered
        ? `no merges match "${effectiveFilter}"`
        : "no skill merges in the history yet — the society is at genesis"
      : `${merges.length} merge${merges.length === 1 ? "" : "s"}` +
        (filtered ? ` matching "${effectiveFilter}"` : "") +
        ` (from ${source === "record" ? "the canonical record" : "git history, interim"})`;

  return {
    source,
    count: merges.length,
    merges,
    filter: effectiveFilter,
    caveats,
    reason,
    as_of: new Date().toISOString(),
  };
}

// Allow direct invocation: `node index.mjs '{"filter":"salvo"}'`
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2)));
}
