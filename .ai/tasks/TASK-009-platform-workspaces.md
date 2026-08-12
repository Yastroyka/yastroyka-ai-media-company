# TASK-009 — Platform Workspaces

## OBJECTIVE
Implement VK Community, VK Video and MAX independent workspace state.

## CONTEXT
Follow Constitution and accepted ADRs.

## SCOPE
Implement VK Community, VK Video and MAX independent workspace state.

## OUT OF SCOPE
No shared VK publication queue.

## RISK
R1 by default; escalate for production/security/irreversible actions.

## ACCEPTANCE
- Separate publication IDs; one VK contour failure does not block other.

## TESTS
Automated tests first where practical; attach command output.

## ROLLBACK
Git revert / migration down / feature flag as applicable.

## EVIDENCE
Diff, tests, schema validation, screenshots/logs/traces, open risks.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
