---
name: yastroyka-task-bootstrap
description: Bootstrap any YASTROYKA repository implementation or review task before edits. Use when Codex must establish authority sources, scope, risk, branch, acceptance criteria, tests, rollback, evidence, and blockers; return BLOCKED/CONFLICT when requirements disagree.
---

# Bootstrap a YASTROYKA task

1. Read `AGENTS.md`, `docs/PROJECT_CONSTITUTION.md`, `ENGINEERING_RULES.md`, `docs/agentic/AGENT_EXECUTION_CONTRACT.md`, and the current task file.
2. Read only the ADRs, contracts, schemas, tests, runbooks, and implementation relevant to the requested change.
3. Produce a task envelope containing objective, scope, out-of-scope, authority references, acceptance criteria, risk class, allowed branch/worktree, tests, security constraints, rollback, evidence, and reviewer gate.
4. Compare the request with the authority chain. Return `BLOCKED/CONFLICT` with exact sources when they conflict or material inputs are missing.
5. Record only explicit, testable assumptions that do not broaden scope, permissions, data access, or production authority.
6. Confirm that the work is isolated from protected `main` before editing.
7. Keep implementation within the approved envelope and escalate any risk increase.
