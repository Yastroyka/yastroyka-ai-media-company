# TASK-012 — Golden Evals Release Gate

## OBJECTIVE
Turn R1 acceptance criteria into executable/reviewable release gate.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Turn R1 acceptance criteria into executable/reviewable release gate.

## OUT OF SCOPE
No release with hard gate failure.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Every hard gate emits evidence and blocks on FAIL.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
