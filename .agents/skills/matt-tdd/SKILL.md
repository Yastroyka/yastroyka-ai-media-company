---
name: matt-tdd
description: Behavior-first TDD for implementation tasks with a stable public seam; use vertical red-green slices and avoid implementation-coupled tests.
---

# Matt-derived TDD

Derived from `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT). Repository policy always wins.

## Before the loop

1. Read the current task/spec and the repository authority documents relevant to the change.
2. Identify the highest useful **public seam** where behavior can be observed without reaching into internals.
3. Treat a seam already named by the task/spec/acceptance tests as pre-agreed. If the seam is materially ambiguous, surface that ambiguity before creating a new testing boundary.
4. Prefer existing seams over adding test-only interfaces.

## Vertical red-green loop

For one behavior at a time:

1. **Red:** write the smallest test that expresses externally visible behavior and verify that it fails for the intended reason.
2. **Green:** implement only enough production behavior to make that test pass.
3. Run the focused test/typecheck immediately.
4. Repeat with the next vertical slice. Do not write a horizontal pile of speculative tests first.
5. Once the behavior is green, refactor only where the completed slice reveals real duplication, poor naming or a shallow boundary.

## Test quality

Keep tests stable across refactors. Prefer known-good literals, worked examples, contracts or acceptance criteria as expected values. Avoid tests that:

- mock internal collaborators instead of observing a public interface;
- call private methods;
- reproduce the implementation algorithm in the assertion;
- add a new seam only to make a trivial unit test possible;
- assert incidental ordering/formatting that the contract does not require.

## Completion

Before claiming the task is implemented:

- focused tests for the changed behavior pass;
- repository-required type/lint/static checks pass;
- the repository's full required validation is run at the normal completion gate;
- evidence references the commands/checks actually executed;
- no unrelated refactor remains in the diff.

This skill governs implementation technique only. It cannot weaken security, evidence, approval, migration, rollback or release requirements.
