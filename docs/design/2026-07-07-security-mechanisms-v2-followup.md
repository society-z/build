# Security mechanisms v2 — a harder second pass, and what actually held up

Follow-up to `2026-07-06-security-mechanisms-v1.md`. That document named five residuals and called
them accepted, monitored exposures. The founder's direct instruction afterward: these should be
pushed on harder before being accepted. This document is the result of that push: a research pass
using prior art the first round didn't touch, a redesign pass, and an adversarial pass that
attacked the redesigns the same way the first round's mechanisms were attacked. Nothing here is
built. Everything below is the final, pressure-tested status, not the optimistic first draft of it.

## 1. Revocation (GitHub-account-takeover)

**What closed:** hardware-bound commit signing (FIDO2/WebAuthn keys requiring a physical touch per
signature, verified independently by Society Z rather than trusted from GitHub's own "Verified"
badge, which is satisfiable through the web UI with no hardware at all) turns "steal a session,
wait, act" into "physically steal a specific hardware key" for ordinary contributor accounts.

**What didn't:** an attacker who compromises an *admin* session doesn't need any of this. GitHub
admins can weaken or disable branch protection, required signed commits, and required status
checks using nothing but the normal web interface. At genesis, with one member who is also the
sole admin, this is not a distant edge case. State this precisely in any future security writeup:
the mechanism protects ordinary contributor sessions; it does not protect the admin session, and
right now those are the same account.

## 2. External anchoring (proving history wasn't quietly rewritten)

**What closed:** witnessing pull requests and issues at the moment they're *opened* (not merged)
catches a reviewer who buries someone else's already-submitted, inconvenient content. This is a
direct transplant of Certificate Transparency's precertificate pattern: witness intent before the
decision, not after.

**What didn't:** this only works when the submitter and the decider are different people. A sole
maintainer who is also the only author never has to open anything they don't want witnessed. This
is not a flaw in the mechanism. It is what the current genesis state (one member, no other
submitters) actually looks like, stated plainly rather than implied away.

## 3. Sybil resistance (seed capture)

**What closed:** replacing EigenTrust (validated only by simulation, with a documented single point
of failure in its seed set) with the Advogato/Levien max-flow trust metric gives the design an
actual worst-case, adversary-parameterized damage proof instead of an empirical robustness claim.
This is real progress, and it's the recommended computation going forward.

**What didn't:** the core case survives regardless of which metric runs underneath it. A small
number of real wallets, doing genuinely good work indistinguishable from any other genuinely good
work, can legitimately earn trusted standing near the seed. No trust metric, proven or not, can
flag a signal that was never forged. At genesis, with one member, earning a foothold near the seed
and capturing the one person who holds it are the same event.

## 4. Non-transferable Standing (confirmed structural, not merely unsolved)

This was tested harder than "no known system solves it." An active attempt was made to find a
mechanism that would: quadratic-funding-style correlation discounting, and a more exotic
zero-knowledge unprovability scheme generalized from voting theory. Both were checked against the
literature and both fail against two people simply agreeing to collude.

The underlying reason is a direct conflict, not a missing invention. Every real mechanism that
defeats bribery (going back to foundational work on secret, receipt-free ballots) works by making
the bribed action unprovable to whoever is paying for it. Standing's entire value is the opposite:
a merge is maximally provable to everyone, on purpose, because that provability is what makes the
record worth trusting in the first place. A system cannot make an action both fully public and
unprovable to a third party. Standing can be made unbuyable, and is. It cannot, without giving up
the thing that makes it trustworthy, be made unrentable.

**Status: structural. Not a gap for future engineering to close.**

## 5. Capital-gate exclusion (splitting beats concentrating)

The original design tried to blunt whale advantage by compressing the capacity $Z buys along a
square-root curve. That was tested harder and the finding sharpened rather than softened: any curve
with this shape (diminishing returns for concentrating capital) mathematically rewards splitting
that same capital across many identities instead. This is not specific to a square root and not
specific to Society Z. It is the same reason quadratic funding, using the identical curve for the
identical reason, has never closed Sybil-splitting from inside its own mechanism in a decade of real
deployment, ever, in any deployment, without importing external proof-of-personhood, which this
project has already and deliberately ruled out.

The honest fix is not a better curve. There isn't one. The honest fix is to stop claiming the curve
does work it cannot do. Access is priced, in whatever quantity capital can buy, exactly as this
project's own law already says: membership can be bought. That was never the protected side. The
protected side is Standing, computed only from used, surviving work, moved by nothing else,
including how much access anyone bought to get in the door.

**Status: structural. The mitigation is precision about what was never protected, not a fix.**

## What this means for the thesis

Two of five turned out to be provable limits, not unclosed research. Both trace to the same place:
this project's central promise, that a merge is public, permanent, and checkable by anyone, is also
what makes a merge visible and valuable to someone willing to pay for it however they got in the
door. That is not a contradiction of "reputation cannot be bought." Rental and bulk access never
buy Standing; they buy labor and admission, which this project's own law already prices openly. The
three that remain (admin-session takeover, a maintainer with nothing yet to bury, and a handful of
real actors legitimately earning trust) are genuinely narrower after this pass, and get smaller
again once the built mechanisms above ship.
