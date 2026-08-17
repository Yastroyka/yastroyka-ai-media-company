---
name: yastroyka-evidence-package
description: Build the required YASTROYKA evidence package after implementation or review. Use when reporting task completion, preparing a pull request, or deciding PASS/FAIL from tests, diff scope, security review, rollback, assumptions, blockers, and remaining human actions.
---

# Build YASTROYKA evidence

1. Identify the task/milestone, source baseline, allowed branch, and accepted scope.
2. List changed files and summarize behavior or contract impact without hiding generated or unrelated changes.
3. Run every required command, including `pnpm run quality:check` for repository-level changes.
4. Record each command, exit status, and concise result. Mark unavailable checks `NOT RUN`; never infer a pass.
5. Review the final diff for secrets, permission changes, untrusted input, dependency changes, migrations, and protected or production actions.
6. State rollback, assumptions, blockers, residual risks, and required human review/merge action.
7. Return `PASS` only when all mandatory acceptance criteria and checks passed. Otherwise return `FAIL` or `BLOCKED` with exact evidence.
