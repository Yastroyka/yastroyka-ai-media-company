# Engineering Runner Runbook — MILESTONE-03 v0.1

## Purpose

This runbook defines the safe execution path for the YASTROYKA Engineering Runner introduced by MILESTONE-03. The runner automates reversible repository work while preserving GitHub, AuthZ, Model Exchange, PostgreSQL, and owner-only governance boundaries.

## Runtime baseline

The live runner path targets:

- Linux;
- Node.js 24.x;
- pnpm 11.20.0;
- Git;
- an isolated feature branch and worktree created from an exact approved `main` SHA;
- no dependency on the owner's Windows workstation, PowerShell session, or VPN state.

`LiveRunnerEnvironmentAdapter` must attest the runtime before the dry-run harness starts repository mutation. Environment attestation is fail-closed.

## Validation boundary

`RestrictedValidationAdapter` executes only configured validation checks with `shell: false`.

Allowed Git command forms are intentionally exact and read-only:

- `git diff --check {baseSha}..HEAD`;
- `git rev-parse HEAD`;
- `git status --porcelain=v1 --untracked-files=all`.

A pnpm validation is permitted only as `pnpm run <script>` and only when that script is separately present in the adapter's explicit `allowedPnpmScripts` list.

Missing required checks return `not_run`; they are never reported as PASS. Mutation-capable Git operations, output-writing Git options, arbitrary pnpm commands, and shell execution are rejected by the validation adapter.

## Independent review boundary

`ScopedGitReviewAdapter` verifies:

- the reviewed worktree still points to the exact reviewed head SHA;
- the reviewed head is descended from the exact approved base SHA;
- rename detection is disabled for scope accounting so both sides of a move remain visible to policy;
- changed files are inside approved path prefixes;
- built-in governance blocks are non-bypassable and always include `.env*`, `.git/`, `.github/`, `.codex/`, `.ai/`, `AGENTS.md`, `SECURITY.md`, the Project Constitution, Engineering Rules, and the Agent Execution Contract;
- caller-supplied forbidden prefixes may only add restrictions, never replace the built-in governance blocks;
- an empty or unreadable diff fails closed.

This adapter is deterministic scope/security review for the v0.1 dry-run. It does not replace later model-assisted security review where separately approved.

## GitHub dry-run boundary

The representative acceptance test uses a **test-only** in-memory implementation of `GitHubEngineeringTransport` to exercise the existing `GitHubEngineeringAdapter` Draft-PR and exact-head CI contracts without network mutation or credentials.

There is deliberately no reusable production-exported dry-run GitHub transport. This prevents a simulated CI result from being accidentally wired into a production decision path.

Test-only Draft/CI evidence MUST NOT be represented as a real GitHub PR or real GitHub Actions result. Canonical repository CI for implementation PRs remains GitHub Actions itself.

## Representative end-to-end dry-run

The automated acceptance test `services/orchestrator/tests/live-runner-dry-run.test.ts` performs the following on Linux:

1. creates a temporary local bare Git `origin`;
2. creates an exact `main` base commit;
3. creates an isolated feature worktree through `GitWorktreeAdapter`;
4. runs a deterministic credential-free worker;
5. intentionally creates trailing whitespace on attempt 1;
6. detects the failure through real `git diff --check`;
7. performs bounded correction attempt 2;
8. runs scope review against the final exact head;
9. pushes only the feature branch to the local bare origin;
10. exercises Draft PR and exact-head CI contracts through the test-only GitHub transport;
11. reaches `READY_FOR_OWNER_DECISION` inside the simulated run only after the corrected head passes;
12. keeps the harness report explicitly marked `dryRun: true`;
13. disposes the worktree;
14. verifies local `main` is unchanged.

This test demonstrates the execution loop without external provider credentials, GitHub write credentials, owner VPN toggling, or PowerShell.

## Human gates

The dry-run harness and live runner components do not authorize:

- Ready-for-review transition;
- merge into `main`;
- force push;
- direct protected-branch push;
- secret reads;
- production writes;
- permission expansion;
- destructive commands.

Those remain governed by the existing engineering policy and explicit owner commands.

## Evidence

For a decision-ready run, preserve at minimum:

- exact base SHA;
- feature branch;
- runner environment attestation;
- selected model/provider decision or approved dry-run worker identity;
- bounded validation/correction evidence;
- reviewed exact head SHA;
- feature-branch push evidence;
- Draft PR/CI exact-head evidence (real or explicitly labelled test-only dry-run);
- final owner decision state;
- worktree cleanup result;
- rollback statement.

Raw provider errors, raw CI output, tokens, credentials, or secrets must not be copied into canonical evidence.

## Rollback

For this slice:

1. close the implementation PR before merge, or revert its squash commit after merge;
2. remove/disable the live dry-run harness invocation if operationally necessary;
3. preserve GitHub history and durable evidence required for audit;
4. do not weaken branch protection, AuthZ, security policy, or required checks as a rollback shortcut.

The test-only GitHub transport has no external GitHub side effects to undo. Temporary local repositories/worktrees are deleted by the test harness.

## Promotion beyond dry-run

Real Codex/DeepSeek worker transport, real GitHub write transport, credentials, or additional network permissions are not enabled by this runbook. They require separately approved configuration/task scope and must retain the same exact-head, least-privilege, Draft-first, and owner-merge gates.
