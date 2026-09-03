---
name: matt-review
description: Review a branch or diff on two separate axes: repository standards and originating task/spec fidelity; use before declaring implementation ready for human review.
---

# Matt-derived Two-Axis Review

Derived from `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76` (MIT). Repository policy always wins.

## 1. Pin the comparison

Identify the fixed point (`main`, merge-base, tag or explicit commit) and review the diff from that point to the candidate HEAD. Do not review an undefined moving target.

## 2. Identify sources

**Standards sources:** repository agent instructions, engineering/security rules, accepted ADRs and coding standards relevant to the changed area.

**Spec sources:** the originating task/issue/spec, acceptance criteria, contracts and explicit user decisions that define what should have been built.

Do not substitute generic best practice for an explicit repository rule.

## 3. Review the axes separately

### Standards

Report concrete deviations from repository standards and meaningful code smells introduced by the diff. Focus on correctness, security, maintainability, locality, naming, duplication, unnecessary abstraction and dependency creep. Skip style issues already enforced automatically by tooling unless the tool is failing.

### Spec

Report:

- requested behavior missing or only partially implemented;
- behavior added without authorization (scope creep);
- implementation that appears inconsistent with the requirement/contract;
- acceptance evidence that is missing or does not actually prove the claim.

Keep Standards and Spec findings separate so one cannot mask the other.

## 4. Severity and evidence

Every finding should name the relevant file/hunk or behavior and the rule/requirement it conflicts with. Distinguish hard violations from judgement calls. Avoid speculative criticism that has no consequence for this task.

## 5. Completion

A review is complete when both axes have either findings or an explicit pass/no-material-findings result. Review does not self-approve architecture, release or merge. The repository's human-control and evidence gates remain authoritative.
