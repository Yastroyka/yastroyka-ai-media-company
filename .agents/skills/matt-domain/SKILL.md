---
name: matt-domain
description: Sharpen domain terminology and durable architectural decisions when a task changes vocabulary, concepts or hard-to-reverse design choices.
---

# Matt-derived Domain Modeling

Derived from `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT). Repository policy always wins.

## Glossary discipline

When a repository has `CONTEXT.md`, treat it as a compact glossary of canonical domain terms. If the current task uses an overloaded or conflicting term, resolve the meaning and update the glossary at the point the decision becomes clear.

If no glossary exists, create one only when the current task actually introduces domain vocabulary worth preserving. Do not create a glossary as ceremony.

`CONTEXT.md` contains domain meaning, not implementation details, task status, copied specifications, code snippets or architecture prose. This keeps the document stable and cheap to load.

## Stress-test the model

When two concepts may be conflated, test the proposed language against concrete edge cases. Prefer separate canonical terms when actors, lifecycles, permissions or invariants differ.

Cross-check claims against existing contracts/code where the task depends on them. If current implementation and intended domain meaning disagree, surface the discrepancy instead of silently choosing one.

## ADR discipline

Offer or create an ADR only when the decision is all three:

1. expensive or risky to reverse later;
2. surprising without historical context;
3. the result of a real trade-off between viable alternatives.

Otherwise keep the decision in the task/spec or code and avoid documentation sediment.

## Completion

Domain work is complete when new/changed terms have one precise meaning, durable trade-offs are recorded at the right authority level, and no duplicate source of truth was created.
