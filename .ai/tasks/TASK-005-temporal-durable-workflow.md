# TASK-005 — Temporal Durable Workflow

## OBJECTIVE
Implement first campaign workflow with approval wait, retries and assisted fallback.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement first campaign workflow with approval wait, retries and assisted fallback.

## OUT OF SCOPE
Do not move trivial jobs to Temporal.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Worker restart does not lose workflow state.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
