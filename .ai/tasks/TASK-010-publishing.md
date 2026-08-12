# TASK-010 — Publishing

## OBJECTIVE
Implement draft→QA→approval→freshness→AUTO/ASSISTED→result state machine.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement draft→QA→approval→freshness→AUTO/ASSISTED→result state machine.

## OUT OF SCOPE
No bypass of gates.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Stale offer blocks publish; assisted packet preserves attribution IDs.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
