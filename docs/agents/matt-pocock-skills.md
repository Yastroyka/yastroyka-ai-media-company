# Matt Pocock Engineering Methods Adoption Policy

## Project identity

This policy belongs to **`Yastroyka/yastroyka-ai-media-company` — the YASTROYKA AI factory / AI Media Company**. It is separate from the YASTROYKA marketplace/site product and must not be used to collapse those two projects into one codebase, task system or product context.

## Purpose

The AI factory uses a narrow subset of `mattpocock/skills` as engineering methodology. The methods do not replace this repository's task bootstrap, security review, evidence package, Constitution/ADR authority order, release gate or Definition of Done.

Pinned upstream:

- repository: `mattpocock/skills`
- commit: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- license: MIT
- adoption mode: selective `ADAPT`, never floating `latest`

## Registry decision

Matt-derived material is **not installed into `.agents/skills/`** in this repository. The YASTROYKA AI factory has an owned Codex bootstrap that deliberately validates its own fixed skill set. Adding third-party skill directories would create a competing registry and break that invariant.

Instead, the adapted methods live in `docs/agents/matt-engineering-methods.md` and are loaded by pointer only when a task benefits from them.

## Precedence

The authority order in root `AGENTS.md` remains unchanged. Existing YASTROYKA-specific `.agents/skills/yastroyka-*` skills remain the only registered project skills and take precedence over general methodology.

## Adopted methods

| Method | Invocation posture | Intended use |
| --- | --- | --- |
| TDD | task-matched by pointer | behavior-first implementation at accepted seams |
| Debugging | task-matched by pointer | reproduce/minimize/diagnose before fixing |
| Two-axis review | near completion | separate repository-standards and task/spec review |
| Domain modeling | narrow/on-demand | sharpen vocabulary and selective ADR discipline |
| Handoff | explicit/manual | compact context between sessions/agents |

Not adopted here: Matt issue-triage, spec-to-ticket, implementation orchestration, wayfinder, wizard and experimental `implement-spec`. The AI factory already owns task/security/evidence/release orchestration, so competing workflows would add ambiguity rather than value.

## Token and cost controls

- `AGENTS.md` contains only a short pointer; the method body is loaded only when relevant.
- A normal task should use the smallest relevant process: TDD **or** debugging, then review.
- Do not run a YASTROYKA-specific skill and a Matt-derived method when they duplicate the same responsibility.
- Handoff is explicit only; do not create handoff artifacts on every task.
- Do not spawn additional agents merely because upstream Matt methods mention parallel agents. Use AI-factory/harness concurrency and model-budget policy.
- Keep domain glossary material concise; contracts, schemas and task files remain separate sources of truth.

## Update protocol

Never update from `latest` automatically. Review upstream changes from the pinned SHA, adapt only useful deltas, run the full release/quality gate, and change the pin only in a reviewed PR.

## Safety property

These are development-time Markdown instructions only. No runtime dependency, marketplace/site code, application code, schema, deployment configuration, production permission or credential handling is added by this integration.
