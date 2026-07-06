<!-- One skill per PR. Title: `skill: <name>` -->

## Skill

- **Name:** `<skills/your-skill>`
- **What it does (one line):**
- **Member id:** assigned automatically at wallet-link time (nothing to mint)

## Checklist

- [ ] Folder follows `SKILL_SPEC.md` (skill.json, README.md, index.mjs, smoke.mjs)
- [ ] `node skills/<name>/smoke.mjs` passes locally (no private keys, no paid calls)
- [ ] `author` in `skill.json` filled in (member_id, github_id, wallet)
- [ ] No secrets committed (config via env / config.json which is gitignored)
- [ ] I have linked my wallet ↔ GitHub at https://link.societyz.xyz

<!--
Automated checks:
  society-z/smoke        runs your smoke test
  society-z/holder-gate  reads your linked wallet's $Z balance (required to merge)
A human maintainer reviews and merges greens. On merge you are witnessed and attributed.
-->
