# TASK-008 — Control Room Shell v0.1

## OBJECTIVE
Build the first real Nuxt/Vue operational shell for YASTROYKA Control Room over an explicit owned-backend read contract, without fake authoritative data, production mutations, deployment, or secret access.

## BASELINE
- exact base `main`: `cb0bf1040457b82918352012c5a63868ce355527`;
- task branch: `feat/task-008-control-room-shell`;
- approved development origin: `https://dev.yastroyka.online`;
- `apps/control-room` currently contains only a placeholder.

## AUTHORITY
- `docs/PROJECT_CONSTITUTION.md` — OWN-01, DATA-01, UI-01, BACKEND-01, CONTROL-01, SECURITY-01;
- `docs/adr/ADR-0002-h3-nuxt-vue-stack.md`;
- `docs/ARCHITECTURE.md` — Control Plane;
- `docs/agentic/AGENT_EXECUTION_CONTRACT.md`;
- YASTROYKA Master Plan v3.9 sections 19 and 29.

## SCOPE
- add `@yastroyka/control-room` under `apps/control-room` using Nuxt 4, Vue 3, TypeScript, Tailwind CSS 4, and Nuxt UI;
- create a responsive Command Center shell for approvals, incidents, platform workspaces, and the latest Model Exchange decision;
- add a strict shared `ControlRoomOverview` read contract with exact-key validation;
- require READY data to identify `YASTROYKA_OWNED_BACKEND` as its source;
- add a same-origin Nitro read endpoint that fetches one fixed upstream path from a server-only configured base URL;
- allow only HTTPS upstream URLs, except loopback HTTP for local development;
- reject embedded credentials, query strings, fragments, redirects, non-success responses, and malformed payloads;
- return only sanitized `UNAVAILABLE` reason codes when the backend is absent or invalid;
- show dashes and explicit unavailable messages instead of fabricated counts or statuses;
- add noindex/nofollow and baseline defensive response headers;
- document the development origin and non-secret runtime configuration;
- add contract tests and CI typecheck/test/build gates.

## OUT OF SCOPE
- no authentication/session implementation;
- no approval, reject, rework, stop, deploy, or publish mutation;
- no direct PostgreSQL access from the UI;
- no Socket.IO/SSE realtime;
- no local demo or mock operational data;
- no DNS, TLS, VPS, Docker, or deployment change;
- no repository visibility change;
- no VK token, publishing identity, owner private key, or `wall.post`;
- no production write of any kind;
- no AI Office/Game Mode in this slice.

## RISK
R2. The change is reversible and non-production, but introduces a new web dependency graph and an external read boundary. It requires exact-head CI and human review. Ready transition and merge remain separate owner actions.

## ACCEPTANCE
- the Control Room package installs through the frozen workspace lockfile;
- typecheck, contract tests, production build, repository quality checks, and existing regression suites pass;
- a valid exact owned-backend READY envelope is accepted;
- unknown fields, fake source authority, malformed counts/timestamps, duplicate workspaces, and malformed model decisions fail closed;
- an absent/misconfigured/unreachable/rejecting/invalid backend produces a sanitized UNAVAILABLE state;
- the page never shows invented operational numbers;
- approvals, incidents, VK Community, VK Video, MAX, and Model Exchange are visibly represented;
- `https://dev.yastroyka.online` is recorded only as non-secret development-origin configuration;
- final diff contains no temporary diagnostic workflow.

## REQUIRED TESTS
```text
pnpm install --frozen-lockfile
pnpm run quality:check
pnpm --filter @yastroyka/control-room typecheck
pnpm --filter @yastroyka/control-room test
pnpm --filter @yastroyka/control-room build
```

Canonical GitHub CI must also run all existing repository gates on the exact PR head.

## SECURITY
- no secret values in source, config, fixtures, output, screenshots, PR text, or logs;
- browser input cannot choose the upstream host or path;
- upstream errors are not reflected to the browser;
- redirects are rejected;
- no backend response is authoritative until exact runtime validation passes;
- no deployment is permitted before authentication and environment gates are separately implemented and reviewed.

## ROLLBACK
Close the Draft PR before merge, or revert the eventual squash commit. No migration, production state, DNS, credential, or external-system rollback is required.

## EVIDENCE
Return exact base/head, changed files, dependency/lockfile review, contract-test output, typecheck/build/quality results, exact-head CI status, security review, temporary-probe removal, and residual risks.

## OWNER GATE
The agent may create an isolated branch and Draft PR. It must not mark the PR Ready, merge, deploy, change repository visibility, provision secrets, or perform production publishing without separate exact owner commands.
