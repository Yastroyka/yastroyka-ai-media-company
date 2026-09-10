# Matt Pocock Engineering Methods Integration Plan

> **For agentic workers:** Execute this plan only on a task branch. Do not modify `main` directly.

**Project:** `Yastroyka/yastroyka-ai-media-company` — **YASTROYKA AI factory / AI Media Company**, not the separate YASTROYKA marketplace/site product.

**Goal:** Add pinned, selective Matt Pocock engineering methods without replacing the AI factory's existing TASK bootstrap, owned skill registry, security, evidence or release workflow.

**Architecture:** Existing `AGENTS.md`, Constitution, ADRs, contracts, tests and the fixed YASTROYKA-specific `.agents/skills/` registry remain authoritative. Matt techniques are adapted as pointer-loaded documentation for TDD, debugging, code review, domain language and handoff. They do not become registered project skills and do not introduce a competing issue/task lifecycle.

**Tech Stack:** Markdown engineering methods, GitHub, existing Codex bootstrap.

**Upstream:** `mattpocock/skills@6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT).

## Global Constraints

- Do not replace `.ai/tasks/` or YASTROYKA AI-factory task bootstrap.
- Preserve the Codex invariant that this repository has exactly its owned initial skill set.
- Do not replace `yastroyka-security-review` or `yastroyka-evidence-package`.
- Do not alter runtime code, dependencies, schemas or CI behavior in this PR.
- External methods are subordinate to the authority order in `AGENTS.md`.
- Token-heavy planning/orchestration methods are intentionally excluded.

### Task 1: Add upstream policy and provenance

- [x] Add compact policy with pinned SHA, license, precedence, project identity and token controls.

### Task 2: Add non-conflicting engineering methods

- [x] Add TDD, debugging, two-axis review, domain-language and handoff methods as `docs/agents/matt-engineering-methods.md`.
- [x] Keep `.agents/skills/` unchanged after CI proved the registry is intentionally fixed.

### Task 3: Connect existing AGENTS instructions

- [x] Add a small pointer section to `AGENTS.md` without changing its authority order or Definition of Done.
- [x] Explicitly distinguish the AI factory from the separate YASTROYKA marketplace/site product.

### Task 4: Verify change isolation

- [x] Compare the branch with `main`: only AGENTS/docs/provenance files remain changed.
- [ ] Full CI/release gate must pass on the corrected branch before human merge review.
- [x] Draft PR opened; do not merge automatically.

## Debugging note

The first attempt placed Matt adapters under `.agents/skills/`. The repository's own `codex:smoke` correctly rejected this because it requires the owned initial skill count. The fix preserves that guardrail rather than weakening it: Matt material is now progressive-disclosure documentation outside the skill registry.
