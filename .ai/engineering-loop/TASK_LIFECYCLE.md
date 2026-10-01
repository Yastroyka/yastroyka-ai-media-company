# TASK-026 — Engineering Run Lifecycle Contract

## Authority

`EngineeringRunState` in `services/orchestrator/src/engineering-run.ts` remains the single canonical in-process state model for autonomous engineering runs. TASK-026 does not introduce a second state machine.

## Owner-facing projection

`createEngineeringOwnerDecisionSnapshot(state, observedAt)` exposes a read-only, versioned projection for Control Room and orchestration consumers.

Schema version:

`engineering-owner-decision/v1`

## Decision states

The snapshot may expose only one of these canonical decision claims:

- `PENDING` — the run is still progressing and `blockerReason` must be `null`.
- `READY_FOR_OWNER_DECISION` — the run status must be `ready_for_owner_decision`, model selection must exist, the Draft PR must exist, every required validation check must have PASS evidence, and `blockerReason` must be `null`.
- `BLOCKED` — the run status must be `blocked` and a non-empty canonical blocker reason must exist.

Any contradiction fails closed instead of publishing ambiguous owner evidence.

## Lifecycle ownership

The underlying Milestone-03 lifecycle remains authoritative:

`approved -> executing -> validating -> reviewing -> draft_pr_pending -> awaiting_ci -> ready_for_owner_decision`

A run may transition to `blocked` from the governed state machine when policy, evidence, authorization, routing, workspace, validation, CI, or retry-budget requirements fail.

## Human gate

`READY_FOR_OWNER_DECISION` is evidence, not authorization to mutate protected repository state. Ready-for-review and merge remain separate explicit owner actions.

## Non-goals

TASK-026 does not add autonomous merge, production deployment, secret access, provider-specific routing authority, or a parallel runner/state implementation.
