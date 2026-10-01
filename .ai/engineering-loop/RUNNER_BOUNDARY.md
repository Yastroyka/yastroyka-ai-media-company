# TASK-026 — Runner and Owner Boundary

## Purpose

TASK-026 exposes owner-facing engineering evidence without changing the authority model established by Milestone-03.

## Runner boundary

The autonomous engineering runner may perform only the reversible routine actions already permitted by policy, including isolated feature-branch work, validation, Draft PR updates, CI observation, and evidence collection.

The snapshot function itself is read-only and side-effect free. It does not execute Git commands, call GitHub, contact model providers, open PostgreSQL, read secrets, deploy, publish, or mutate production state.

## Owner-only boundary

The following remain explicit owner gates and are not authorized by a `READY_FOR_OWNER_DECISION` snapshot:

- mark a Draft PR ready for review where project policy requires owner authorization;
- merge into protected `main`;
- production deployment or production writes;
- secret or credential provisioning;
- permission or AuthZ expansion;
- branch-protection weakening;
- force push or destructive repository actions;
- real external publishing.

## Fail-closed boundary

If owner-facing evidence is malformed or contradictory, the snapshot constructor throws the fixed safe error `invalid engineering owner decision snapshot` rather than guessing, broadening authority, or claiming READY.

## Provider neutrality

Model/provider selection remains data owned by the existing Model Exchange/orchestrator path. TASK-026 only reports the selected provider/model and WHY THIS MODEL already recorded in canonical engineering state.

## Control Room consumption

Control Room or another owned backend consumer may render the snapshot as operational evidence. A consumer must not interpret the snapshot as permission to execute an owner-only action.

## Rollback

Rollback is a normal revert of TASK-026 source, tests, exports, and documentation. No migration, dependency, secret, deployment, or production-state rollback is required by this task.
