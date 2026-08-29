# TASK-019 — VK Community Signed Execution Verifier

## OBJECTIVE
Add a read-only operator command that verifies a short-lived owner grant against a freshly re-read canonical VK Community publication immediately before any secret-bearing execution path exists.

## CONTEXT
TASK-017 established the read-only PostgreSQL approval-packet operator. TASK-018 established separate offline owner signing. TASK-019 closes the gap between signing and execution by recomputing canonical state and verifying the signed grant without Secret Provider access or external writes.

## SCOPE
- share the existing read-only PostgreSQL publication-state lease between publishing operators;
- add `vk:verify-execution <publicationId> <owner-grant.json> <non-secret-manifest.json>`;
- require the canonical production metadata preflight to be READY before reading the grant or opening PostgreSQL;
- parse owner-grant JSON without reflecting rejected input;
- open only the shared read-only PostgreSQL state boundary;
- re-read the exact canonical `VK_COMMUNITY + AUTO` publication;
- recompute the exact canonical preview and preview fingerprint;
- verify the owner grant with the configured Ed25519 public key, exact publication ID, exact destination, exact fresh preview fingerprint, and current time;
- emit only a sanitized READY execution binding or BLOCKED reason;
- close the read-only database lease before returning output;
- document the operator sequence and test freshness/expiry/failure paths.

## OUT OF SCOPE
- no owner private key;
- no Secret Provider access;
- no VK access token;
- no publishing-identity HMAC value;
- no service identity issuance;
- no publication mutation;
- no VK transport;
- no `wall.post`;
- no production activation.

## RISK
R2. Production-adjacent but read-only and incapable of external publication.

## ACCEPTANCE
- usage/invalid metadata/grant JSON failures open no database when avoidable;
- blocked production metadata returns before grant file access and before PostgreSQL;
- PostgreSQL access uses the TASK-017 read-only connection boundary;
- canonical publication state is re-read after signing;
- any change to message/destination/fingerprint invalidates the signed grant;
- expired/future/invalid-signature grants fail closed;
- READY output contains only publication ID, owner ID, preview fingerprint, grant ID and grant expiration;
- no secret-like material is emitted;
- database lease closes for READY and BLOCKED paths;
- exact-head CI passes.

## EXIT CODES
- `0` — signed execution binding READY;
- `2` — safe BLOCKED state;
- `64` — CLI usage error;
- `65` — invalid operator input;
- `70` — sanitized operational failure.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema or deployment rollback is required.

## CONFLICT RULE
Fail closed. Never guess publication state, destination, fingerprint, signature validity, or time freshness.
