# Matt Pocock Skills Integration Implementation Plan

> **For agentic workers:** Execute this plan only on a task branch. Do not modify `main` directly.

**Goal:** Add a pinned, selective engineering-skill layer to YASTROYKA without replacing its existing TASK bootstrap, security, evidence or release workflow.

**Architecture:** Existing `AGENTS.md`, Constitution, ADRs, contracts, tests and YASTROYKA-specific skills remain authoritative. Matt Pocock techniques are installed only as narrow engineering helpers for TDD, debugging, code review, domain language and handoff. They must not introduce a competing issue/task lifecycle.

**Tech Stack:** Markdown Agent Skills, GitHub, Codex-compatible `.agents/skills` layout.

**Upstream:** `mattpocock/skills@6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT).

## Global Constraints

- Do not replace `.ai/tasks/` or YASTROYKA task bootstrap.
- Do not replace `yastroyka-security-review` or `yastroyka-evidence-package`.
- Do not alter runtime code, dependencies, schemas or CI behavior in this PR.
- External skills are subordinate to the authority order in `AGENTS.md`.
- Token-heavy planning/orchestration skills are intentionally not installed here.

### Task 1: Add upstream policy and provenance

- [ ] Add a compact policy document with pinned SHA, license, precedence and token controls.

### Task 2: Add non-conflicting engineering helpers

- [ ] Add TDD, debugging, two-axis code-review, domain-language and handoff adapters.
- [ ] Keep their names distinct from existing YASTROYKA skills.

### Task 3: Connect existing AGENTS instructions

- [ ] Add a small pointer section to `AGENTS.md` without changing its authority order or Definition of Done.

### Task 4: Verify change isolation

- [ ] Review the branch diff and confirm only docs/agent-skill files plus the AGENTS pointer changed.
- [ ] Open a PR for human review; do not merge automatically.
