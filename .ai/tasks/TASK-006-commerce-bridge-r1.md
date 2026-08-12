# TASK-006 — Commerce Bridge R1

## OBJECTIVE
Implement read-only product/offer/snapshot/content-pack path with freshness validation.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement read-only product/offer/snapshot/content-pack path with freshness validation.

## OUT OF SCOPE
No production catalog mutation endpoints.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Real/staging offer builds pack; stale price/stock triggers REFRESH/BLOCK.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
