# Temporal Campaign Workflow — TASK-005

`@yastroyka/temporal-workflows` owns the first durable campaign workflow.

## Guarantees

- A campaign draft activity is retried by Temporal up to three times.
- Exhausted generation retries enter an explicit assisted fallback activity.
- The workflow then waits for a human `approved` or `rejected` signal.
- Workflow state and approval signals are held by Temporal, not by the AI provider or worker
  process.
- Restarting the worker replays the workflow history and resumes the approval wait.

## Boundaries

- Activities receive only the campaign identifier and objective. Provider credentials and
  canonical business state do not enter workflow history through this package.
- `stateRef` is an owned reference only; PostgreSQL remains the canonical business System of
  Record.
- Temporal is used for the long-running approval workflow. Trivial/background jobs remain in
  BullMQ.
- This package requires no Temporal Cloud account. Development and tests use the open-source
  Temporal test server downloaded by `@temporalio/testing`.

## Validation

```sh
pnpm --filter @yastroyka/temporal-workflows run typecheck
pnpm --filter @yastroyka/temporal-workflows run test
```

The restart integration test stops the first worker while the workflow is waiting, sends the
approval while no worker is running, starts a second worker, and verifies successful completion.

## Rollback

Revert the TASK-005 commit. The package adds no database migration, production deployment,
credential, paid service, or irreversible action.
