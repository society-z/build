// github — the thin GitHub client the maintainer bot uses.
//
// Interface (everything the bot needs, nothing more):
//   setStatus({ sha, state, description })   -> post the `society-z/holder-gate` commit status
//   comment({ number, body })                -> post an issue comment on the PR
//   addLabel({ number, labels })             -> add labels
//   getDiff({ number })                      -> { files: [{ filename, additions, deletions }] }
//   merge({ number, sha })                   -> { merged, sha }  (squash merge)
//
// realGithub() implements this against api.github.com using fetch + a GitHub App/installation
// token (or GITHUB_TOKEN in the Action fallback). mockGithub() records every call for tests and
// never touches the network. The status context is fixed to `society-z/holder-gate` so it lines
// up with the required branch-protection check.

const STATUS_CONTEXT = "society-z/holder-gate";
const API = "https://api.github.com";

// REAL client. token = GitHub App installation token (preferred) or GITHUB_TOKEN (Action).
export function realGithub({ token, repo, fetchImpl = fetch }) {
  if (!token) throw new Error("realGithub requires a token (GitHub App installation or GITHUB_TOKEN)");
  if (!repo || !repo.includes("/")) throw new Error('realGithub requires repo as "owner/name"');

  async function gh(path, { method = "GET", body } = {}) {
    const res = await fetchImpl(`${API}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!res.ok) throw new Error(`GitHub ${method} ${path} -> ${res.status} ${await res.text()}`);
    return res.status === 204 ? {} : res.json();
  }

  return {
    async setStatus({ sha, state, description }) {
      // state: "success" | "failure" | "pending". Description shows on the PR checks row.
      return gh(`/statuses/${sha}`, {
        method: "POST",
        body: { state, context: STATUS_CONTEXT, description: description.slice(0, 140) },
      });
    },
    async comment({ number, body }) {
      return gh(`/issues/${number}/comments`, { method: "POST", body: { body } });
    },
    async addLabel({ number, labels }) {
      return gh(`/issues/${number}/labels`, { method: "POST", body: { labels } });
    },
    async getDiff({ number }) {
      const files = await gh(`/pulls/${number}/files?per_page=100`);
      return { files: files.map((f) => ({ filename: f.filename, additions: f.additions, deletions: f.deletions })) };
    },
    async merge({ number, sha }) {
      // sha pins the merge to the exact commit the gate verified — refuses if head moved.
      const r = await gh(`/pulls/${number}/merge`, {
        method: "PUT",
        body: { merge_method: "squash", ...(sha ? { sha } : {}) },
      });
      return { merged: !!r.merged, sha: r.sha };
    },
  };
}

// MOCK client for tests: records calls, returns deterministic results, no network.
export function mockGithub({ files = [], mergeSha = "mergedsha000" } = {}) {
  const calls = { setStatus: [], comment: [], addLabel: [], merge: [], getDiff: [] };
  return {
    calls,
    async setStatus(a) { calls.setStatus.push(a); return { ok: true }; },
    async comment(a) { calls.comment.push(a); return { id: calls.comment.length }; },
    async addLabel(a) { calls.addLabel.push(a); return a.labels; },
    async getDiff(a) { calls.getDiff.push(a); return { files }; },
    async merge(a) { calls.merge.push(a); return { merged: true, sha: mergeSha }; },
  };
}

export { STATUS_CONTEXT };
