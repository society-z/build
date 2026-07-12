// request-build — turn "an idea, in words" into the EXACT GitHub issue that would trigger an
// OpenHands build (an issue titled from the idea + the `fix-me` label), but only for a wallet
// that holds >= threshold $Z. It answers one question: "may this wallet request a build, and
// what issue would fire if so?" It returns that issue as data. It does NOT create it.
//
// DRY-RUN / READ-ONLY, on purpose:
//   - The $Z balance check is the ONLY thing that touches the network, and it is READ-ONLY
//     on-chain. It is IMPORTED from the `gate` skill (../gate/index.mjs), never reimplemented,
//     so the door in front of OpenHands can never drift from the door in front of merges
//     (same principle as `verify` importing canonical()/sha256() from maintainer/record.mjs).
//   - This skill never calls the GitHub API, never opens an issue, never applies a label.
//     Creating a real issue is a MUTATION with real cost/spam consequences: the `fix-me` label
//     is what fires .github/workflows/openhands-resolve.yml, which spends the repo owner's paid
//     LLM_API_KEY. Per docs/BUILDING-SKILLS.md rule 4 ("skills never act"), a skill answers; a
//     principal (or a deliberately-built, write-capable maintainer action) acts. So this returns
//     the exact { title, body, labels } a human or that future action would create — deliberately.
//
// Why the gate exists at all: the OpenHands resolver has NO built-in abuse/cost protection.
// Exposed raw on a public repo, anyone could fire it. request-build is the thin holder-check in
// front of it: no $Z, no build request. Fail closed, exactly like the merge gate.

import { run as gate } from "../gate/index.mjs";

// The label the OpenHands resolver watches for. Applying it is what triggers a (paid) build.
const TRIGGER_LABEL = "fix-me";

// Build a stable, human-readable issue title from a free-text idea: first non-empty line,
// collapsed whitespace, capped so the title stays a title. Never throws on odd input.
function titleFromIdea(idea) {
  const firstLine = String(idea).split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "untitled build request";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  const MAX = 72;
  const clipped = collapsed.length > MAX ? collapsed.slice(0, MAX - 1).trimEnd() + "…" : collapsed;
  return `[build] ${clipped}`;
}

// The full issue body a maintainer/action would post. States who requested it, the VERIFIED
// balance the request rode in on, the full idea, and that the `fix-me` label is the trigger.
function bodyFromIdea({ idea, github_login, wallet, verdict }) {
  return [
    `**Build requested by @${github_login}** (wallet \`${wallet}\`).`,
    "",
    `Holder check passed: ${verdict.balance} $Z held (>= ${verdict.threshold} required), verified on-chain at ${verdict.checked_at}.`,
    "",
    "## The idea",
    "",
    idea.trim(),
    "",
    "---",
    `Applying the \`${TRIGGER_LABEL}\` label to this issue triggers the OpenHands resolver, which opens a PR with a proposed diff. That run spends the repo's LLM budget, which is why this request is gated to $Z holders.`,
  ].join("\n");
}

export async function run(inputs) {
  const { wallet, github_login, idea } = inputs || {};
  if (!wallet) throw new Error("wallet (base58 pubkey) is required");
  if (!github_login || typeof github_login !== "string") throw new Error("github_login (string) is required");
  if (typeof idea !== "string" || !idea.trim()) throw new Error("idea (non-empty string) is required");

  // Reuse the gate's exact on-chain read + threshold math + fail-closed multi-RPC agreement.
  // We pass config through so the caller/CI can inject Z_MINT/Z_THRESHOLD/RPC the same way.
  const verdict = await gate({ wallet, config: inputs.config });

  const base = {
    wallet,
    github_login,
    balance: verdict.balance,
    threshold: verdict.threshold,
    gate: verdict,          // the full (optionally signed) holder verdict, for auditability
    dry_run: true,          // ALWAYS true: this skill never mutates GitHub
    checked_at: new Date().toISOString(),
  };

  // Fail closed: a wallet under threshold gets no build request, same posture as the merge gate.
  if (!verdict.pass) {
    return {
      ...base,
      authorized: false,
      reason: `not authorized to request a build: ${verdict.reason}`,
      would_create: null,
    };
  }

  // Authorized: return the EXACT issue that WOULD be created. Nothing is created here.
  const would_create = {
    action: "create_issue_and_apply_label",
    title: titleFromIdea(idea),
    body: bodyFromIdea({ idea, github_login, wallet, verdict }),
    labels: [TRIGGER_LABEL],
    triggers_workflow: ".github/workflows/openhands-resolve.yml",
    note:
      "DRY RUN — no issue was created and no label applied. Executing this is a deliberate, " +
      "write-capable step (a maintainer action with a bot token, or a human principal). " +
      `Creating the issue and applying \`${TRIGGER_LABEL}\` will trigger OpenHands and spend the repo's LLM_API_KEY.`,
  };

  return {
    ...base,
    authorized: true,
    reason: `authorized to request a build: ${verdict.reason}`,
    would_create,
  };
}

// Allow direct invocation:
//   node index.mjs '{"wallet":"<pubkey>","github_login":"octocat","idea":"add a dark mode toggle"}'
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = JSON.parse(process.argv[2] || "{}");
  run(args).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
