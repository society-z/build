// link.mjs — the linking service entry point.
//
// Public surface:
//   linkAccount(input)          -> verify a SIWS payload and append the link (the write path)
//   walletForGithubId(id)       -> the maintainer bot's read: which wallet to balance-check
//   githubIdForWallet(pubkey)   -> reverse lookup (one wallet <-> one github id)
//   auditLinks()                -> re-derive the whole table from stored signatures alone
//   buildSiwsMessage / verifyLink / issueNonce  -> for the linking page
//
// The bot in .github/holder-gate/ calls getLink(author).wallet; that is exactly
// walletForGithubId(author). Keep this interface stable.

import { buildSiwsMessage, verifyLink } from "./siws.mjs";
import {
  createLinkStore,
  createNonceStore,
  createAuditNonceStore,
} from "./store.mjs";

const DOMAIN = process.env.SOCIETY_Z_DOMAIN || "societyz.xyz";

// Default singletons (jsonl-backed). Callers may inject their own for tests/DB swap.
const defaultLinks = createLinkStore();
const defaultNonces = createNonceStore();

export { buildSiwsMessage } from "./siws.mjs";
export function issueNonce(store = defaultNonces) {
  return store.issue();
}

// --- WRITE PATH: verify signature + bindings, then append an auditable link row -----------
export function linkAccount({
  github_id,
  github_login,
  wallet,
  message,        // the exact SIWS message the wallet signed
  signature,      // base58 ed25519 signature
  domain = DOMAIN,
  linkStore = defaultLinks,
  nonceStore = defaultNonces,
  now = new Date(),
}) {
  const v = verifyLink({ github_id, wallet, message, signature, expectedDomain: domain, nonceStore, now });
  if (!v.ok) return { ok: false, code: v.code, detail: v.detail };

  // Enforce one-wallet-per-github (design §1a): reject binding a wallet already owned
  // by a DIFFERENT github id. Re-linking the same pair, or a new wallet for the same id,
  // is allowed (latest wins in the store).
  const ownedBy = linkStore.githubIdForWallet(wallet);
  if (ownedBy !== null && ownedBy !== Number(github_id)) {
    return { ok: false, code: "wallet-taken", detail: `wallet already linked to github_id ${ownedBy}` };
  }

  const record = {
    github_id: Number(github_id),
    github_login: github_login ?? v.github_login,
    wallet,
    siws_message: message,
    siws_signature: signature,
    linked_at: now.toISOString(),
  };
  linkStore.append(record);
  return { ok: true, record };
}

// --- READ PATH: what the maintainer bot calls ---------------------------------------------
export function walletForGithubId(github_id, linkStore = defaultLinks) {
  return linkStore.walletForGithubId(github_id);
}

export function githubIdForWallet(wallet, linkStore = defaultLinks) {
  return linkStore.githubIdForWallet(wallet);
}

// --- ADAPTER for the maintainer bot -------------------------------------------------------
// The bot (../maintainer/links.mjs) consumes a provider with `async getLink(githubId) -> Link|null`
// where Link = { github_id, github_login, wallet, revoked }. This makes the SIWS linking service
// the drop-in real backend: replace `fileLinks(path)` with `linkingProvider()` at launch.
export function linkingProvider(linkStore = defaultLinks) {
  return {
    async getLink(githubId) {
      const row = linkStore.latestByGithubId().get(Number(githubId));
      if (!row) return null;
      return {
        github_id: Number(row.github_id),
        github_login: row.github_login || null,
        wallet: row.wallet,
        revoked: !!row.revoked,
      };
    },
  };
}

// --- AUDIT: re-derive the github_id -> wallet table from stored signatures ALONE ----------
// Ignores linked_at/revoked metadata and re-verifies every stored (message, signature).
// A row whose signature/binding no longer verifies is dropped (and reported). This is the
// mitigation for "the link DB is a single point of trust": even a tampered DB collapses to
// only the rows the signatures actually justify.
export function auditLinks({ linkStore = defaultLinks, domain = DOMAIN } = {}) {
  const rows = linkStore.readAll();
  const valid = [];
  const invalid = [];
  const table = new Map(); // github_id -> wallet (latest valid wins)
  const auditNonces = createAuditNonceStore(); // fresh per run; rejects duplicate/replayed nonces
  for (const r of rows) {
    const v = verifyLink({
      github_id: r.github_id,
      wallet: r.wallet,
      message: r.siws_message,
      signature: r.siws_signature,
      expectedDomain: domain,
      nonceStore: auditNonces,
    });
    if (v.ok && !r.revoked) {
      valid.push(r);
      table.set(Number(r.github_id), r.wallet);
    } else if (v.ok && r.revoked) {
      // A signature-valid revoke removes the active mapping, matching store.latestByGithubId()
      // (store.mjs), which drops a github_id whose latest row is revoked. Applying set/delete in
      // file order reproduces latest-wins + revoke, so the audit table and the store agree.
      table.delete(Number(r.github_id));
      invalid.push({ github_id: r.github_id, wallet: r.wallet, code: "revoked" });
    } else {
      invalid.push({ github_id: r.github_id, wallet: r.wallet, code: v.code });
    }
  }
  return { table, valid, invalid };
}

// --- CLI: node link.mjs '<json>'  (issue-nonce | link | wallet-for | github-for | audit) ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const json = () => JSON.parse(arg || "{}");
  const out = (x) => console.log(JSON.stringify(x, null, 2));
  switch (cmd) {
    case "issue-nonce": out({ nonce: issueNonce() }); break;
    case "link": out(linkAccount(json())); break;
    case "wallet-for": out({ wallet: walletForGithubId(json().github_id) }); break;
    case "github-for": out({ github_id: githubIdForWallet(json().wallet) }); break;
    case "audit": {
      const { table, valid, invalid } = auditLinks();
      out({ links: Object.fromEntries(table), valid: valid.length, invalid });
      break;
    }
    default:
      console.error("usage: node link.mjs <issue-nonce|link|wallet-for|github-for|audit> '<json>'");
      process.exit(1);
  }
}
