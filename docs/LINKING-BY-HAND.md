# Linking your wallet by hand (the first-members path)

The hosted link page at `link.societyz.xyz` is coming. Until it ships, the first
members link their wallet to their GitHub account by hand. It is a few minutes of
work and it uses the exact same signature the hosted page will, so nothing about
your link changes when the page lands.

Linking proves one thing: that a Solana wallet belongs to a GitHub account. The
gate then reads that wallet's $Z balance at merge time. Linking never touches your
keys. The only signature involved is you signing one message, in your own wallet,
that binds your GitHub id to your wallet.

> We only ever ask you to sign at `societyz.xyz`. Any other site asking you to
> "sign for Society Z" is phishing.

## What you need

- A Solana wallet (Phantom, Solflare, any Wallet-Standard wallet) holding $Z.
- A GitHub account.
- Your wallet's ability to **sign a message** (every major wallet has this — it is
  not a transaction, costs nothing, and moves no funds).

## The steps

### 1. Open a link request

Open an issue in this repo titled `link: <your-github-login>`. A maintainer replies
with a fresh single-use **nonce** (a random string). The nonce stops anyone from
replaying an old signature, so you must use the one the maintainer gives you.

### 2. Build the exact message

Fill this template with your values and the maintainer's nonce. It must match
character for character:

```
societyz.xyz wants you to sign in with your Solana account:
<YOUR_WALLET_PUBKEY>

Link this wallet to GitHub @<YOUR_LOGIN> (id <YOUR_NUMERIC_GITHUB_ID>) for Society Z contribution.

URI: https://societyz.xyz
Chain ID: solana:mainnet
Nonce: <NONCE_FROM_MAINTAINER>
Issued At: <ISO8601_NOW>
Expiration Time: <ISO8601_NOW_PLUS_10_MIN>
```

Your numeric GitHub id (not your username) is at
`https://api.github.com/users/<YOUR_LOGIN>` in the `id` field. We bind to the
numeric id so your link survives a username change.

### 3. Sign it in your wallet

Use your wallet's **Sign Message** feature (not Send, not Approve a transaction):

- **Phantom:** the sign-message prompt appears when a dapp requests it; for a manual
  sign, use a signing tool that calls `signMessage`, or the hosted page when it
  lands. Advanced users can sign with the wallet's message-signing API.
- **Solflare:** Settings has a "Sign Message" utility; paste the message, sign,
  copy the resulting signature.

Copy the resulting **base58 signature**.

### 4. Submit the link PR

Open a pull request adding one line to `linking/links.jsonl`:

```json
{ "github_id": <YOUR_ID>, "github_login": "<YOUR_LOGIN>", "wallet": "<YOUR_PUBKEY>", "siws_message": "<THE EXACT MESSAGE FROM STEP 2>", "siws_signature": "<BASE58 SIGNATURE FROM STEP 3>", "linked_at": "<ISO8601_NOW>" }
```

### 5. The maintainer verifies and merges

A maintainer runs the real verifier over your row before merging. It passes only if
**all** of these hold (this is the same check the hosted page runs — see
`linking/README.md`):

1. **Key control** — the signature verifies against your wallet over the exact
   message bytes. Pasting someone else's address proves nothing; only the private
   key holder can produce the signature.
2. **Identity binding** — the message names `(id <github_id>)` and it must equal the
   id on the PR. A signature over id 777 cannot be replayed to link id 778.
3. **Domain binding** — the first line names `societyz.xyz`. A signature phished on
   another site does not verify here.
4. **Replay protection** — the nonce must be the one the maintainer issued, unused.
5. **Freshness** — the expiration time must still be in the future.

On merge, your wallet is linked. From then on the gate reads that wallet's $Z
balance whenever you open a PR, and your merges are attributed to your GitHub id.

## Why this is safe even by hand

The link store is fully re-derivable from the `(siws_message, siws_signature)`
pairs alone. `auditLinks()` re-verifies every row and drops any the signature does
not justify, so even a tampered links file collapses to exactly the rows members
actually signed. The signatures are the source of truth, not the file.

## Changing your wallet later

Re-linking a new wallet to the same GitHub id has a cooldown (about seven days) so
one wallet cannot be passed across many accounts to game the gate. Your record
attaches to your GitHub id, not the wallet, so it survives a key rotation.
