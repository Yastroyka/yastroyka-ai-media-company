# Matt-derived Engineering Methods for the YASTROYKA AI Factory

This document belongs to **`Yastroyka/yastroyka-ai-media-company` — the YASTROYKA AI factory / AI Media Company**. It is not an instruction set for the separate YASTROYKA marketplace/site product.

Source: `mattpocock/skills@6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT). These are selectively adapted engineering methods, not registered YASTROYKA skills. The repository keeps its owned `.agents/skills/` registry unchanged.

Read only the section that matches the current task. Repository Constitution, ADRs, contracts, task bootstrap, security, evidence and release controls always win.

## Behavior-first TDD

Use when implementing new or changed behavior at a stable public seam.

1. Identify the highest useful public seam; prefer an existing seam already expressed by task acceptance criteria or tests.
2. **Red:** write the smallest behavior test and verify it fails for the intended reason.
3. **Green:** implement only enough behavior to pass it.
4. Run focused test/typecheck immediately, then repeat one vertical slice at a time.
5. Refactor only after the behavior is green and only for real duplication/naming/locality problems revealed by the slice.

Avoid private-method tests, internal-collaborator mocks, tautological assertions and test-only interfaces without a real boundary reason.

## Disciplined debugging

Use when behavior is broken, flaky, unexpectedly failing or slow and the cause is uncertain.

1. Build the smallest fast, red-capable feedback loop for the user's exact symptom.
2. Reproduce, then minimize until each remaining input/config/step is load-bearing.
3. Write 3–5 ranked falsifiable hypotheses before editing.
4. Instrument narrowly; change one variable at a time. Redact secrets and sensitive payloads.
5. At a correct public seam, turn the minimized case into a failing regression test, apply the smallest coherent fix, verify it passes, then rerun the original reproduction.
6. Remove temporary instrumentation and record the root cause in task/PR evidence.

If no honest reproduction can be built with current access, report the missing evidence/access instead of guessing.

## Two-axis code review

Use near completion of a code-changing task.

Review the candidate diff from a fixed point on two separate axes:

- **Standards:** Constitution/ADR/engineering/security rules, correctness, maintainability, locality, unnecessary abstraction/dependency creep.
- **Spec:** missing/partial requested behavior, scope creep, contract mismatch, or evidence that does not actually prove acceptance.

Keep the two reports separate. Every finding should point to the concrete behavior/file and governing rule/requirement. This review cannot self-approve architecture, production publication, release or merge.

## Domain language and ADR discipline

Use only when the task genuinely introduces or changes domain vocabulary or a hard-to-reverse design decision.

- Keep any glossary/`CONTEXT.md` concise: canonical terms and meanings only, not copied specs, code or task status.
- Stress-test potentially conflated concepts with edge cases; separate them when actors, lifecycles, permissions or invariants differ.
- Create an ADR only when the decision is expensive/risky to reverse, surprising without history, and represents a real trade-off.
- Never create a second source of truth for a contract already owned elsewhere.

## Context handoff

Use only when another agent/session actually needs to continue the work.

Include the current objective, exact next action, task/branch/PR identifiers, uncaptured decisions, blockers, unresolved questions, and verification already performed. Point to durable specs/ADRs/issues/commits rather than copying them. Redact secrets and sensitive data.

A handoff is an index into authoritative state, not another state store.

## Cost and token rule

For a normal task use the smallest applicable method: **TDD or debugging**, followed by review. Do not automatically run every method, do not create handoff documents on routine tasks, and do not spawn extra agents solely because the upstream version used parallel agents. YASTROYKA AI factory orchestration and model-budget policy remain authoritative.
