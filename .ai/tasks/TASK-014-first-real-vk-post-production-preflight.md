# TASK-014 — FIRST REAL VK POST Production Preflight

## OBJECTIVE
Add the final operator-facing preflight and owner-grant package before production credential provisioning and the first real VK Community write.

## CONTEXT
Build on TASK-010 and the merged FIRST REAL VK POST transport, persistence, runtime gate, Ed25519 owner approval, and exact preview fingerprint controls.

## SCOPE
- define one canonical owner-grant assertion/signing payload shared by offline owner-side signing and runtime verification;
- provide an offline Ed25519 signing helper that requires a caller-supplied private KeyObject and never stores or returns private key material;
- provide production activation metadata validation for exact VK Community ID, owner Ed25519 public key, VK credential secret reference, and publishing-identity secret reference;
- provide a read-only preflight result with READY/BLOCKED reasons;
- never read secret values during metadata preflight;
- update runtime verification to consume the shared owner-grant contract;
- document the exact operator sequence.

## OUT OF SCOPE
- no production VK Community ID committed until independently confirmed;
- no production VK access token;
- no owner Ed25519 private key;
- no production publishing-identity HMAC value;
- no real VK network request;
- no production deployment activation;
- no external publish.

## RISK
R3. Production activation boundary adjacent to credentials and publishing.

## ACCEPTANCE
- signer and verifier use the exact same canonical payload;
- runtime still accepts only the owner public key;
- owner private key is never persisted, serialized, logged, or returned by helper APIs;
- production preflight is side-effect free and does not touch Secret Provider or network;
- invalid/missing community ID, public key, or secret references produce explicit BLOCKED reasons;
- valid metadata produces READY with sanitized metadata only.

## TESTS
Automated tests first. Exact-head CI required.

## ROLLBACK
Close Draft PR before merge or revert squash commit. No migration rollback expected.

## EVIDENCE
Exact diff, exact-head CI, security review, test counts, open operational gates.

## CONFLICT RULE
Return BLOCKED instead of guessing production destination or credentials.
