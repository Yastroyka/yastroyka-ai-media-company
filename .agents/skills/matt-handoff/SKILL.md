---
name: matt-handoff
description: Compact current work for another agent or fresh session without duplicating durable artifacts; explicit invocation only.
disable-model-invocation: true
---

# Matt-derived Handoff

Derived from `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT).

Create a compact handoff only when a session/agent transition is actually needed.

Include:

- current objective and exact next action;
- branch/PR/task identifiers;
- decisions not yet captured elsewhere;
- blockers and unresolved questions;
- verification already performed and its result;
- suggested repo-local skills for the next agent.

Do **not** copy specs, ADRs, issues, commits, diffs, logs or other durable artifacts into the handoff. Reference them by path/URL/identifier instead. Redact secrets, credentials, personal data and sensitive payloads.

A good handoff is an index into authoritative state, not a second source of truth.
