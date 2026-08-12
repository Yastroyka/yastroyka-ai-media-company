# TASK-007 — Model Exchange Core

## OBJECTIVE
Implement Capability Registry, hard gates, routing, lifecycle and WHY THIS MODEL.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement Capability Registry, hard gates, routing, lifecycle and WHY THIS MODEL.

## OUT OF SCOPE
External gateway cannot override policy.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- 3 task classes, >=2 eligible candidates each; decision trace stored.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
