# TASK-002 — Canonical DB + Outbox

## OBJECTIVE
Implement PostgreSQL/Sequelize canonical persistence and transactional outbox.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement PostgreSQL/Sequelize canonical persistence and transactional outbox.

## OUT OF SCOPE
No Elasticsearch indexing yet.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Migrations pass; canonical row and outbox commit atomically.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
