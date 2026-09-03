# Matt Pocock Skills Adoption Policy

## Purpose

YASTROYKA uses a narrow subset of `mattpocock/skills` as engineering helpers. They do not replace the repository's existing task bootstrap, security review, evidence package, Constitution/ADR authority order or Definition of Done.

Pinned upstream:

- repository: `mattpocock/skills`
- commit: `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`
- license: MIT
- adoption mode: selective `ADAPT`, never floating `latest`

## Precedence

The authority order in root `AGENTS.md` remains unchanged. YASTROYKA-specific `.agents/skills/yastroyka-*` skills also take precedence over Matt-derived helpers when responsibilities overlap.

## Installed adapters

| Skill | Invocation posture | Intended use |
| --- | --- | --- |
| `matt-tdd` | task-matched | behavior-first implementation at accepted seams |
| `matt-debug` | task-matched | reproduce/minimize/diagnose before fixing |
| `matt-review` | task-matched | separate code-standards and task/spec review |
| `matt-domain` | narrow task-matched | sharpen domain vocabulary without replacing contracts |
| `matt-handoff` | explicit/manual | compact context between sessions/agents |

Not installed here on purpose: Matt issue-triage, spec-to-ticket, implementation orchestration, wayfinder and wizard workflows. YASTROYKA already has owned task/security/evidence/release mechanisms, so installing competing orchestration would add ambiguity rather than value.

## Token and cost controls

- Skill bodies are progressive-disclosure material; `AGENTS.md` carries only a short pointer.
- A normal task should use the smallest relevant process: TDD **or** debugging, then review.
- Do not run both a YASTROYKA-specific skill and a Matt-derived skill when they solve the same responsibility.
- `matt-handoff` is explicit only; do not create handoff artifacts on every task.
- Do not spawn additional agents just because an upstream method describes parallel review. Use repository/harness concurrency policy.
- Keep domain glossary material concise; contracts, schemas and task files remain separate sources of truth.

## Update protocol

Never update from `latest` automatically. Review upstream changes from the pinned SHA, adapt only useful deltas, run `pnpm run quality:check`, and change the pin only in a reviewed PR.

## Safety property

These are development-time Markdown instructions only. No runtime dependency, application code, schema, deployment configuration, production permission or credential handling is added by this integration.
