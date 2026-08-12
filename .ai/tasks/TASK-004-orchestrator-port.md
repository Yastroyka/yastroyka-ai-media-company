# TASK-004 — Orchestrator Port

## OBJECTIVE
Implement provider-neutral orchestration interface, Claude primary adapter and fake adapter.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement provider-neutral orchestration interface, Claude primary adapter and fake adapter.

## OUT OF SCOPE
No business state inside provider session.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Adapter replaceability test passes; provider outage preserves state.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
