# TASK-001 — Repo Governance

## OBJECTIVE
Initialize monorepo, TypeScript baseline, package/workspace policy, CI skeleton, PR/evidence rules.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Initialize monorepo, TypeScript baseline, package/workspace policy, CI skeleton, PR/evidence rules.

## OUT OF SCOPE
No business features.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Repository installs/builds; no Python; PR requires tests/evidence/rollback.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
