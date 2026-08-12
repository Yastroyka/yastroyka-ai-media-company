# TASK-011 — Analytics Attribution

## OBJECTIVE
Connect product/offer/content/campaign/publication to click/session/order_line/GMV.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Connect product/offer/content/campaign/publication to click/session/order_line/GMV.

## OUT OF SCOPE
Do not overclaim causality.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Tracked path is queryable end-to-end.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
