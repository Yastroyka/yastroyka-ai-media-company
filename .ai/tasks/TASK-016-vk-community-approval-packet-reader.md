# TASK-016 — Canonical VK Community Approval Packet Reader

## OBJECTIVE
Create one read-only path from canonical publication state to the exact owner-inspectable VK Community approval packet.

## CONTEXT
TASK-014 established the canonical owner-grant payload and production metadata preflight. TASK-015 added a non-secret operator preflight command. The next boundary before any owner signing is a read-only approval packet built from the same canonical preview implementation that the real publisher will recompute before credential access.

## SCOPE
- extract the existing canonical VK preview read path from the publishing adapter into a dedicated read-only reader;
- keep the publishing adapter on that exact same reader so approval and execution cannot drift;
- add a canonical approval-packet reader returning only the exact preview plus deterministic preview fingerprint;
- make the runtime approval-packet type reuse the canonical approval-packet contract;
- export the read-only APIs;
- add focused tests and update the publishing runbook.

## OUT OF SCOPE
- no production VK Community ID;
- no Secret Provider access;
- no VK access token;
- no publishing-identity HMAC value;
- no owner private Ed25519 key;
- no owner-grant signing command;
- no database mutation;
- no external network request;
- no VK publish;
- no production activation;
- no schema, migration, dependency, lockfile, or workflow changes.

## RISK
R2. Read-only production-adjacent boundary.

## ACCEPTANCE
- approval packet is produced only from an exact VK_COMMUNITY + AUTO canonical publication;
- approval packet contains only preview and previewFingerprint;
- preview includes publication ID, platform, deployment-bound owner ID, fromGroup, message, and deterministic idempotency key;
- fingerprint changes if deployment destination changes;
- malformed, wrong-platform, missing, non-AUTO, or unreadable publication state fails closed using canonical publishing errors;
- publishing execution still recomputes preview through the same canonical reader before secret access;
- exact-head CI passes.

## TESTS
Automated tests for deterministic packet generation, destination binding, state failures, malformed payloads, and no secret-like output.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema rollback required.

## CONFLICT RULE
Fail closed. Never synthesize or guess publication content or destination.
