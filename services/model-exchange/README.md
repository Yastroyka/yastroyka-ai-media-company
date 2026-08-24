# Model Exchange Core

TASK-007 implements the provider-neutral YASTROYKA routing authority. It validates canonical
`CapabilityRecord` and `RoutingRequest` inputs, applies lifecycle and hard eligibility gates before
scoring, orders eligible candidates deterministically, records `WHY THIS MODEL`, and returns a
decision only after its sanitized trace has been persisted.

## R1 policy

- `PRODUCTION` candidates may participate in every routing mode.
- `CANARY` candidates may participate only in `EXPERIMENT`.
- Every other lifecycle is ineligible for authoritative winner and fallback selection.
- The score is read from `CapabilityRecord.scores[RoutingRequest.mode]` and must be finite.
- Supported requirements are exact `provider` and `revision` matches. Unknown requirement keys are
  rejected instead of being interpreted.
- Ranking is descending score, then ascending `model_id`, `provider`, and `revision`.
- `REDUNDANT` and `CRITICAL` require at least two eligible candidates.

The exported `InMemoryCapabilityRegistry` is a deterministic test double only. Production-owned
capability and decision state is implemented by the PostgreSQL adapters in `@yastroyka/db`; no
provider or external gateway can supply an override or become routing authority.

## Persistence and rollback

Migration `0003-model-exchange-core` creates the canonical capability registry and adds a unique
request-id index to the existing `routing_decisions` table. The decision trace is stored in that
table's JSONB `payload` after runtime validation and sanitization. The migration `down()` removes
the index and capability registry; application rollback is a Git revert followed by a separately
controlled migration rollback only when schema rollback is required and safe.
