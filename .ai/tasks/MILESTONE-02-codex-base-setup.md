# MILESTONE-02 — Codex Base Setup + Smoke Test

## OBJECTIVE

Create the minimum safe, repository-native Codex development environment after TASK-003 without replacing or renumbering TASK-004 Orchestrator Port.

## CONTEXT

- Source baseline: protected `main` at `571d58642a10f4d8d7ce97882a615b6feeba7887`.
- Governing amendment: Master Plan v4.0, section 45.
- This milestone precedes the existing `.ai/tasks/TASK-004-orchestrator-port.md`.

## AUTHORITY REFERENCES

- `docs/PROJECT_CONSTITUTION.md`
- `AGENTS.md`
- `ENGINEERING_RULES.md`
- `docs/adr/ADR-0005-authz-audit-secret-provider-boundary.md`
- `docs/agentic/AGENT_EXECUTION_CONTRACT.md`

## SCOPE

- Add a project-scoped, least-privilege Codex configuration.
- Add a reviewed project hook that denies secret access, destructive commands, protected-branch pushes, and direct merge commands.
- Add the repository-native Agent Execution Contract.
- Add the first YASTROYKA task-bootstrap, security-review, and evidence-package skills.
- Add a disabled YASTROYKA-owned MCP placeholder.
- Add deterministic smoke and hook-policy tests to the repository quality gate.
- Document activation, evidence, and rollback.

## OUT OF SCOPE

- No provider credentials or production secrets.
- No external MCP connection or OAuth flow.
- No Claude enablement.
- No production, deployment, publishing, financial, database, permission, or protected-branch write.
- No change to TASK-004 Orchestrator Port or business application behavior.

## RISK

R1 — reversible repository configuration and documentation. Any request to enable an external provider, expand permissions, access secrets, or write to production escalates to R2/R3 and requires a separate approved task.

## ALLOWED BRANCH / WORKTREE

`chore/codex-base-setup` or an equivalent isolated worktree created from the declared source baseline. Protected `main` is read-only.

## ACCEPTANCE

- Project config defaults to a workspace-scoped permission profile with network disabled.
- Approval policy is not `never`; dangerous full access is absent.
- The MCP placeholder is disabled and not required.
- Hook-policy tests prove safe commands continue and forbidden commands are denied.
- Three repository skills validate with unique names and bounded instructions.
- `pnpm run codex:smoke` passes.
- `pnpm run quality:check` passes.
- No secret, credential, token, or private key is committed.

## TESTS

```text
pnpm run codex:smoke
pnpm run test:codex-hooks
pnpm run quality:check
```

## SECURITY

- Default deny and least privilege remain authoritative.
- Codex cannot expand its own scopes.
- Project hooks are reviewed by a human before trust is granted.
- External tools and provider output remain untrusted input.
- Merge and release remain human-gated.

## ROLLBACK

Revert the milestone commit. The MCP placeholder is disabled, and no migration or external state change is created.

## EVIDENCE

Provide the changed-file list, command results, hook-policy test count, smoke-test result, quality result, security review, open risks, and rollback statement.

## REVIEWER / HUMAN GATE

Independent review and GitHub CI are required. Only the human owner may approve and merge the Pull Request into protected `main`.

## CONFLICT RULE

If requirements conflict, return `BLOCKED/CONFLICT` instead of guessing.
