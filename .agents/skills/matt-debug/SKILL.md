---
name: matt-debug
description: Disciplined debugging for broken, failing, flaky or slow behavior; build a red-capable feedback loop before fixing, then minimize, hypothesize, instrument and regression-test.
---

# Matt-derived Debugging

Derived from `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT). Repository policy always wins.

## 1. Build the feedback loop first

Before theorizing about the cause, create the smallest agent-runnable check that can catch the user's exact symptom. Prefer, in order, a focused test, HTTP/CLI probe, headless-browser check, captured-trace replay, or a throwaway harness.

The loop should be:

- **red-capable**: it fails on this bug, not merely on a nearby error;
- **deterministic enough** to reason from;
- **fast** enough to run repeatedly;
- **safe**: secrets, auth headers and sensitive payloads are redacted.

If no honest reproduction loop can be built with current access, stop guessing. Record what was tried and what evidence/access is missing.

## 2. Reproduce and minimize

Run the loop and confirm the observed failure matches the reported symptom. Shrink inputs, data, config and steps one at a time until each remaining element is load-bearing.

## 3. Hypothesize before editing

Write 3-5 ranked, falsifiable hypotheses. Each must make a prediction: if it is the cause, changing or observing a specific variable should change the failure in a specific way.

Do not anchor on the first plausible explanation.

## 4. Instrument narrowly

Change one variable at a time. Prefer debugger/REPL inspection, then targeted temporary logs. Tag temporary instrumentation so it can be removed reliably. For performance regressions, measure a baseline before attempting a speed fix.

## 5. Lock the fix down

Where a correct public seam exists:

1. turn the minimized reproduction into a failing regression test;
2. observe it fail;
3. apply the smallest coherent fix;
4. observe the regression test pass;
5. rerun the original feedback loop.

If no correct seam exists, document that architectural limitation instead of adding a misleading shallow test.

## 6. Cleanup and completion

- original symptom no longer reproduces;
- regression coverage passes or the missing seam is documented;
- temporary instrumentation and throwaway harnesses are removed;
- root cause is stated in the task/PR evidence;
- repository-required validation passes;
- no unrelated cleanup is smuggled into the bug fix.
