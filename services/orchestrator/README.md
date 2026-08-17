# Orchestrator Port — TASK-004

`@yastroyka/orchestrator` owns the provider-neutral boundary between YASTROYKA workflows and
external AI providers.

## Guarantees

- Workflow code depends on `ProviderAdapter`, not on a provider SDK or provider session.
- `OrchestratorPort` writes operation state through the YASTROYKA-owned
  `OrchestrationStateStore` before calling a provider.
- A provider outage is normalized as `ProviderUnavailableError` and recorded without changing
  the referenced canonical business state.
- `ClaudeAdapter` maps the neutral request through an injected transport. It contains no API
  credentials, provider SDK, network client, retry policy, or business state.
- `FakeAdapter` is deterministic and can simulate an outage for tests and local development.

## Out of scope

- Live Claude credentials or production API calls.
- PostgreSQL, BullMQ, or Temporal implementations of the state store.
- Durable workflow retry and recovery; that belongs to TASK-005.
- Canonical business state in an external provider session.

## Rollback

Revert the TASK-004 commit. This package adds no migration, external state, secret, or irreversible
operation.
