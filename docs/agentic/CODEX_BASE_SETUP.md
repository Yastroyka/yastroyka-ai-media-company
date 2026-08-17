# Codex Base Setup

Baseline: `main@571d58642a10f4d8d7ce97882a615b6feeba7887`

Milestone: `MILESTONE-02 — Codex Base Setup + Smoke Test`

## Installed repository controls

- `.codex/config.toml` defines an on-request approval policy and a workspace-scoped permission profile with network disabled.
- `.codex/hooks.json` registers a reviewed `PreToolUse` guard.
- `.codex/hooks/pre-tool-use.mjs` denies access to secret-bearing files and blocks destructive Git/shell/database/infrastructure commands, direct protected-branch pushes, and merge commands.
- `.agents/skills/` contains the first YASTROYKA repository skills.
- `docs/agentic/AGENT_EXECUTION_CONTRACT.md` defines the shared provider-neutral execution protocol.
- The YASTROYKA-owned MCP placeholder is present but disabled and cannot block startup.

Project-scoped Codex configuration and hooks load only after the repository is trusted. Non-managed hooks require review of their exact definition before Codex runs them.

## Activation

1. Open the real Git repository on an isolated branch such as `chore/codex-base-setup`.
2. Review `.codex/config.toml`, `.codex/hooks.json`, and the hook source.
3. Trust the project configuration only after that review.
4. Open `/hooks`, inspect the project hook, and explicitly trust its current definition.
5. Run `pnpm install --frozen-lockfile`.
6. Run `pnpm run codex:smoke`.
7. Run `pnpm run quality:check`.
8. Keep the MCP placeholder disabled until a separate approved implementation and security review exist.

## Smoke-test evidence

The smoke test verifies the authority chain, least-privilege configuration, disabled MCP placeholder, hook registration, Agent Execution Contract, repository skills, and source baseline marker. Hook-policy tests verify both allowed and denied examples.

## Security boundary

This setup grants no production access, provider credentials, external OAuth, protected-branch merge, release authority, or permission expansion. It does not replace AuthZ, GitHub branch protection, CI, human approval, or provider eligibility gates.

## Rollback

Revert the milestone commit. No database migration, external registration, credential, or production state is created.

## Official Codex references

- [Project configuration](https://developers.openai.com/codex/config-basic)
- [Skills](https://developers.openai.com/codex/build-skills)
- [Hooks](https://developers.openai.com/codex/hooks)
- [MCP](https://developers.openai.com/codex/mcp)
- [Permissions](https://developers.openai.com/codex/permissions)
