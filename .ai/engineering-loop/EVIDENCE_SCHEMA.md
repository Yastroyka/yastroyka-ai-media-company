# TASK-026 — Owner Decision Evidence Schema

## Contract

The owner-facing snapshot is produced only from canonical `EngineeringRunState` and carries schema version `engineering-owner-decision/v1`.

## Fields

The projection contains:

- `schemaVersion` — exact contract version;
- `observedAt` — canonical ISO-8601 UTC timestamp;
- `run` — run ID, task ID, lifecycle status, decision state, risk class, attempt counters, base SHA, and feature branch;
- `modelSelection` — selected provider/model, WHY THIS MODEL, and ordered fallback providers, or `null` before selection;
- `validation.requiredChecks` — exact required check names;
- `validation.evidence` — check name and conclusion only;
- `pullRequest` — Draft PR number and exact head SHA, or `null` before publication;
- `blockerReason` — canonical blocker reason only when the run is BLOCKED.

## READY invariant

A snapshot must not claim `READY_FOR_OWNER_DECISION` unless:

1. lifecycle status is `ready_for_owner_decision`;
2. decision state is `READY_FOR_OWNER_DECISION`;
3. model selection exists;
4. Draft PR evidence exists and remains Draft;
5. PR head is an exact 40-character lowercase Git SHA;
6. every required validation check has exactly one PASS evidence record;
7. no blocker reason is present.

Missing, duplicate, failed, not-run, contradictory, or malformed evidence fails closed.

## Safety

The snapshot is a metadata projection. It must not contain secret values, environment values, raw provider responses, publication payloads, arbitrary review text, or production credentials.

Nested arrays and evidence objects are copied before exposure so consumers cannot mutate canonical engineering state through the projection.

## Evidence authority

The snapshot summarizes evidence but does not replace its authorities:

- GitHub owns repository, PR, commit, and CI truth;
- YASTROYKA Orchestrator owns engineering process state;
- Model Exchange owns routing decisions;
- AuthZ owns permissions;
- PostgreSQL owns durable canonical workflow evidence where persistence is required.
