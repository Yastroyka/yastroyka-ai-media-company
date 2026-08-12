# TASK-003 — AuthZ + Secrets

## OBJECTIVE
Implement default-deny authz, actor identities, scopes, risk classes and secret-provider boundary.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement default-deny authz, actor identities, scopes, risk classes and secret-provider boundary.

## OUT OF SCOPE
No raw production secrets.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Forbidden production write denied and audited.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
