# TASK-017 — VK Community Approval Packet Operator

## OBJECTIVE
Add the first real operator composition root that reads one canonical VK Community publication from PostgreSQL and emits the exact owner-inspectable approval packet, with no publishing capability.

## CONTEXT
TASK-015 added a non-secret production metadata preflight. TASK-016 established one canonical preview/approval-packet implementation shared with the real publishing adapter. TASK-017 must wire that read-only logic to canonical PostgreSQL state without making the orchestrator depend on infrastructure.

## SCOPE
- establish `services/publishing` as the upper composition package depending on `@yastroyka/db` and `@yastroyka/orchestrator`;
- expose `@yastroyka/db` through its package root;
- add a PostgreSQL connection factory that starts every session with `default_transaction_read_only=on`;
- integration-test that the read-only connection allows reads and rejects writes;
- add `vk:approval-packet <publicationId> <non-secret-manifest.json>`;
- require the same TASK-015 production metadata manifest to pass canonical preflight before opening PostgreSQL;
- read publication state only through `PostgresPlatformWorkspaceStore.findById`;
- generate the exact TASK-016 approval packet;
- emit only sanitized READY/BLOCKED operator JSON;
- close the database connection on every path;
- add publishing service typecheck/test gates to CI.

## OUT OF SCOPE
- no production VK Community ID;
- no VK access token;
- no publishing-identity HMAC value;
- no owner private Ed25519 key;
- no owner-grant signing;
- no publication mutation;
- no VK transport;
- no `wall.post`;
- no production activation.

## RISK
R2. Production-adjacent read-only operator composition.

## ACCEPTANCE
- malformed usage/input fails without opening PostgreSQL;
- production metadata must be READY before PostgreSQL opens;
- DB sessions used by this operator default to read-only and a write probe fails in integration CI;
- only exact VK_COMMUNITY + AUTO state can produce an approval packet;
- canonical publication errors are exposed only as safe block codes;
- DB/config/internal errors are not reflected to operator output;
- successful output contains exact preview + preview fingerprint and no credential/private-key material;
- database lease is always closed;
- exact-head CI passes.

## EXIT CODES
- `0` — approval packet READY;
- `2` — safe BLOCKED state;
- `64` — CLI usage error;
- `65` — invalid publication ID or non-secret manifest;
- `70` — sanitized operational failure.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema migration is introduced.

## CONFLICT RULE
Fail closed. Do not guess destination, publication content, database state, or secret material.
