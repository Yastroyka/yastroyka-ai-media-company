# MILESTONE-03 — Autonomous Engineering Loop v0.1

## OBJECTIVE

Create the first safe autonomous engineering loop for YASTROYKA so routine repository work can proceed from approved task intent to a reviewed Draft PR with minimal owner intervention.

This milestone is intentionally inserted **after TASK-007 Model Exchange Core and before TASK-008 Control Room Shell**. It does not renumber or replace TASK-008 through TASK-012.

## CONTEXT

YASTROYKA already has the minimum safe Codex base from MILESTONE-02:

- project-scoped Codex configuration;
- repository-native task-bootstrap, security-review, and evidence-package skills;
- hooks that deny secret access, destructive commands, protected-branch pushes, force push, and direct PR merge;
- approval-on-request behavior;
- protected `main` and required GitHub Quality checks.

TASK-007 adds the provider-neutral Model Exchange core, which will become the routing authority for selecting execution models while keeping YASTROYKA in control.

The current manual engineering loop still requires the owner to copy task cards into Codex, manually shuttle test output back to the coordinator, and intervene in local Windows/VPN/pnpm execution. MILESTONE-03 removes most of that routine work without removing human control over high-risk actions.

## ARCHITECTURE GOAL

The target loop is:

1. Owner or AI COO approves an engineering objective.
2. Engineering Coordinator reads current `main`, canonical docs, task, contracts, tests, and relevant implementation.
3. Coordinator creates a bounded execution envelope and risk class.
4. A Codex worker operates in an isolated branch/worktree.
5. Worker implements only the approved scope.
6. Automated local/runner checks execute.
7. Failed checks return to the worker for bounded correction loops.
8. Independent review/security checks evaluate the resulting diff.
9. The system creates or updates a Draft PR only.
10. GitHub Actions runs canonical CI/integration validation.
11. Coordinator verifies exact head SHA, CI, evidence, review findings, and open risks.
12. Owner receives a decision-ready status such as `READY FOR OWNER DECISION` or `BLOCKED`.
13. Merge remains a separate explicit human action.

## OWNERSHIP AND AUTHORITY

The following invariants are mandatory:

- YASTROYKA Orchestrator owns engineering process state.
- PostgreSQL owns durable/canonical owned workflow state where persistence is required.
- AuthZ owns permissions.
- Model Exchange owns model routing policy.
- Temporal owns durable long-running workflows where used.
- GitHub remains the canonical source for repository state, branches, commits, PRs, CI evidence, and merged history.
- External AI providers, auto-routers, gateways, Claude, OpenAI, Codex, Qwen, Kimi, or other models are execution resources, never governance authority.
- The system must remain provider-neutral and continue operating if a preferred model/provider is unavailable.

## ENGINEERING RUNNER

Autonomous execution must not depend on the owner's Windows laptop, local VPN state, or manual PowerShell toggling.

Introduce a YASTROYKA-controlled Engineering Runner with a reproducible environment, initially targeting:

- Linux;
- Node.js 24.x;
- pnpm 11.20.0;
- Git;
- isolated worktrees/branches;
- repository quality/test tooling;
- access only to the minimum GitHub permissions required for feature-branch and Draft-PR workflows.

The owner's workstation remains a control surface, not a required runtime dependency for autonomous engineering.

## AUTONOMY LEVEL v0.1

Automate routine reversible engineering actions:

- inspect current `main`;
- read canonical task context;
- select the approved Codex mode from task risk policy;
- create isolated branch/worktree;
- implement bounded code/documentation changes;
- run `git diff --check` and repository validation;
- run typecheck/tests/schema/OpenAPI validation where applicable;
- run targeted security review;
- collect evidence;
- create coherent commits;
- push only feature branches;
- create/update Draft PRs;
- wait for and inspect GitHub Actions;
- feed bounded CI failures back into correction loops;
- verify exact PR head SHA and changed-file scope;
- produce owner-facing evidence and decision status.

## HUMAN GATES

The following MUST remain explicit human-owner gates and MUST NOT be autonomously performed in v0.1:

- merge into protected `main`;
- Ready-for-review transition when project policy requires owner approval;
- production deployment or hidden production write;
- permission/AuthZ expansion;
- access to new secrets or credentials;
- irreversible or dangerous database migrations;
- destructive data operations;
- financial actions;
- publication actions classified as high risk;
- branch protection weakening;
- force push;
- deletion of protected or active branches;
- changes to the security/governance policy itself without separate approval.

Only an exact explicit owner command may authorize merge.

## FAILURE AND RETRY POLICY

Autonomous correction loops must be bounded and evidence-driven.

- Do not retry indefinitely.
- Do not weaken tests, CI, AuthZ, branch protection, or security policy to obtain PASS.
- Do not fabricate PASS for commands that did not run.
- Repeated or unclear failure escalates to `BLOCKED` with exact evidence.
- Provider outage must trigger an allowed fallback path rather than bypassing YASTROYKA policy.
- Unknown external input remains untrusted and must fail closed at adapter/contract boundaries.

## NETWORK / PACKAGE-MANAGER POLICY

The autonomous runner must remove the current owner-workstation VPN/pnpm coupling.

- Package install and validation run in a controlled runner/network environment.
- Lockfile and existing supply-chain policy remain authoritative.
- No dependency may be added solely to work around runner/network setup unless approved by task scope.
- Local owner PowerShell execution becomes fallback/debug evidence only, not the normal execution path.

## SECURITY

- Default deny.
- Least privilege.
- No secrets in repository, prompts, logs, screenshots, PR bodies, or normal evidence.
- No direct protected-branch write.
- No force push.
- No autonomous merge.
- No production write by default.
- External provider output is untrusted input.
- All actionable autonomous mutations must be auditable.
- Every autonomous run records task, branch, base SHA, head SHA, model/provider choice, validation evidence, PR, CI, risks, and rollback.

## MODEL EXCHANGE INTEGRATION

MILESTONE-03 may consume the Model Exchange decision interface but must not let any provider override YASTROYKA policy.

Initial routing examples may include:

- ordinary implementation -> Codex standard engineering mode;
- complex architecture/security -> stronger reasoning mode;
- security review -> security-specialist capability;
- provider outage -> eligible fallback selected by Model Exchange;
- no eligible candidate -> fail closed / `BLOCKED`.

Actual provider enablement, credentials, or production model calls require separately approved configuration/tasks.

## CONTROL ROOM INTEGRATION

TASK-008 remains the next product task after this milestone.

MILESTONE-03 should expose stable engineering-run state/contracts that TASK-008 can later surface, including where practical:

- current task/run status;
- branch and PR;
- model-routing decision / WHY THIS MODEL;
- CI status;
- approval required;
- security/review findings;
- blocker reason;
- evidence links.

MILESTONE-03 does not implement the full Control Room UI.

## SCOPE

Implement the minimum infrastructure and contracts required for the autonomous engineering loop v0.1, including:

- coordinator/run state contract;
- runner execution boundary;
- isolated branch/worktree lifecycle;
- bounded task execution and retry state machine;
- validation/evidence collection;
- Draft PR publication path;
- GitHub CI observation path;
- owner decision gate;
- provider/model fallback integration boundary;
- tests for prohibited actions and fail-closed behavior;
- runbook and rollback documentation.

## OUT OF SCOPE

- autonomous merge;
- autonomous production deployment;
- unrestricted shell/network access;
- unreviewed secret access;
- arbitrary external MCP enablement;
- broad multi-agent swarm without bounded responsibilities;
- replacing GitHub as repository authority;
- replacing PostgreSQL/AuthZ/Model Exchange/Temporal ownership boundaries;
- full TASK-008 Control Room UI;
- TASK-009 through TASK-012 business functionality.

## ACCEPTANCE

MILESTONE-03 v0.1 is accepted only when a representative engineering task can demonstrate an end-to-end dry-run or safe real loop that:

- starts from an approved task envelope;
- creates an isolated feature branch/worktree from exact `main` SHA;
- performs bounded changes without touching `main`;
- runs required validation automatically;
- handles at least one simulated failed-check correction path;
- performs targeted review/security checks;
- creates or updates a Draft PR;
- observes CI for the exact head SHA;
- returns evidence and a clear owner decision state;
- blocks force push, direct-main push, secret reads, destructive commands, Ready/merge without owner authorization;
- remains usable when the preferred model/provider is unavailable via an allowed fallback or explicit BLOCKED state;
- does not require manual owner VPN toggling or PowerShell as the normal path.

## TESTS

Automated tests first where practical. At minimum validate:

- branch/worktree isolation;
- direct-main push denial;
- force-push denial;
- merge denial without explicit owner gate;
- secret-access denial;
- bounded retry behavior;
- failed validation cannot be reported as PASS;
- exact-head CI evidence binding;
- provider-fallback behavior;
- no-eligible-provider fail-closed behavior;
- Draft PR remains Draft until owner-authorized transition;
- runner/network path does not depend on owner workstation VPN state.

Attach command outputs/evidence.

## RISK

R2 by default because this milestone expands autonomous repository mutation and GitHub workflow capability while preserving human merge/release gates.

Escalate to R3 for any proposed production write, permission expansion, secret-access change, destructive operation, or attempt to automate owner-only gates.

## BRANCH / PR RULES

- Separate task branch/worktree from current protected `main`.
- No direct edits to `main`.
- No force push.
- Draft PR first.
- Independent engineering/security review and CI required.
- Ready transition only after explicit owner approval where required.
- Merge only after an exact separate owner command.

## ROLLBACK

- Revert milestone commits.
- Disable autonomous runner/orchestration feature flags/config where applicable.
- Preserve GitHub history and evidence.
- Do not delete evidence needed for audit.
- Any permission/credential rollback is a separately controlled operation.

## EVIDENCE

Provide at minimum:

- base `main` SHA;
- task/run id;
- runner identity/environment;
- branch/worktree;
- model/provider routing decision and WHY THIS MODEL;
- changed-file scope;
- tests/quality/security results;
- retry/correction evidence;
- commit SHA;
- Draft PR number and exact head SHA;
- GitHub Actions run and conclusion;
- owner decision state;
- open risks/blockers;
- rollback statement.

## SEQUENCE DECISION

Approved project sequence is:

`TASK-007 Model Exchange Core -> MILESTONE-03 Autonomous Engineering Loop v0.1 -> TASK-008 Control Room Shell -> TASK-009 Platform Workspaces -> TASK-010 Publishing -> TASK-011 Analytics Attribution -> TASK-012 Golden Evals Release Gate`.

TASK-012 remains the stage where R1 acceptance criteria become executable/reviewable release gates. After TASK-012, autonomy may be increased further, but human-only gates above remain authoritative.

## CONFLICT RULE

If any requirement conflicts with Constitution, accepted ADRs, executable contracts, AuthZ, security policy, or owner-only gates, return:

`BLOCKED/CONFLICT`

instead of guessing or broadening authority.
