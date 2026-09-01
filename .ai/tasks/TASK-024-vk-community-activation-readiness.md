# TASK-024 — VK Community Activation Readiness Discovery

## OBJECTIVE

Add one read-only operator step that can discover canonical VK Community rehearsal candidates without knowing a publication ID in advance and without reading publication payloads, VK secrets, owner grants, or network state.

## CONTEXT

TASK-013 through TASK-023 already provide the guarded VK Community runtime, production preflight, approval packet, offline owner grant, execution verifier, live execution operator, release rehearsal, and destination resolver. TASK-012 provides the canonical R1 Golden Evals Release Gate.

Issue #30 tracks the remaining production activation. Repository visibility changes, production secret provisioning, owner private-key custody, and a real `wall.post` remain separate explicit owner actions.

The current publishing operator commands require an exact publication ID for approval/rehearsal/execution. The canonical PostgreSQL workspace store can read by ID or master-content ID, but there is no narrow operator discovery path for recent VK Community publication state.

## SCOPE

- add a PostgreSQL publication-discovery store that selects only safe metadata and never selects `payload`;
- list recent publications for one exact supported platform with a bounded limit;
- preserve canonical status validation and deterministic newest-first ordering;
- add a VK Community activation-readiness service that identifies `AUTO` publications only as rehearsal candidates;
- add `vk:activation-readiness` operator CLI with no publication ID argument;
- use a read-only PostgreSQL connection;
- emit only publication ID, master-content ID, workspace ID, platform, status, created/published timestamps, candidate count, and fixed safe reason/gate codes;
- return a blocked result when no `AUTO` VK Community candidate exists;
- close the PostgreSQL lease before emitting success/block output;
- add unit/CLI tests and PostgreSQL integration coverage;
- include TASK-024 DB integration in the existing canonical database integration command.

## OUT OF SCOPE

- no repository visibility change;
- no production secret provisioning or secret-provider access;
- no VK access token, publishing-identity secret, owner private key, or owner grant read;
- no network request or VK API call;
- no publication payload read or output;
- no publication creation, QA, approval, AUTO transition, status mutation, or result persistence;
- no production deployment or release;
- no `wall.post`;
- no automatic selection/invocation of `vk:release-rehearsal`;
- no claim that an `AUTO` candidate is production-ready;
- no new dependency, migration, or schema change.

## SAFETY / AUTHORITY

- PostgreSQL remains canonical state.
- Discovery uses `createReadOnlyDatabaseConnection()` and a metadata-only SELECT.
- `AUTO` means only that a canonical publication may proceed to the existing rehearsal gate. TASK-024 never bypasses production preflight, preview inspection, owner signing, execution verification, or the explicit real-publish gate.
- Output is sanitized and contains no `payload`, raw database error, environment value, credential, token, password, private key, or arbitrary exception text.
- Repository visibility and all production activation actions remain human-controlled.

## ACCEPTANCE

- recent publication discovery is platform-bounded and newest-first;
- query does not select publication `payload`;
- limit is bounded and invalid limits fail closed;
- VK Video/MAX records never appear in VK Community readiness output;
- `AUTO` records appear only as rehearsal candidates;
- no `AUTO` record returns `BLOCKED / NO_AUTO_REHEARSAL_CANDIDATE`;
- injected records with payload-like extra fields cannot leak those fields into readiness output;
- usage errors open no database;
- database open/close failures are generic and sanitized;
- exact-head canonical `Quality` / R1 release gate passes.

## RISK

R1/R2 boundary: read-only operator capability over canonical metadata. No schema, permission, secret, production, external-write, or irreversible action is introduced. Ready transition and merge remain separate owner gates.

## ROLLBACK

Revert the TASK-024 squash commit. No migration, production state, credential, or external-system rollback is required.

## OWNER GATES

Draft PR may be created autonomously. Ready transition, merge, repository visibility change, production secret provisioning, owner signing, and real VK publication all require separate explicit owner actions.
