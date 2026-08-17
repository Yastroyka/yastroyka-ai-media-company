---
name: yastroyka-security-review
description: Review YASTROYKA code, configuration, tools, dependencies, and agent actions for secret exposure, permission expansion, untrusted input, privileged writes, supply-chain risk, and missing human gates. Use before approving security-sensitive changes or finalizing any agent-generated diff.
---

# Review YASTROYKA security

1. Establish the declared task scope and risk class from the Agent Execution Contract.
2. Search the diff for credentials, tokens, private keys, certificates, environment contents, sensitive logs, and unsafe fixtures. Never print a discovered secret; report its location and containment action.
3. Check for expanded filesystem, network, MCP, provider, GitHub, database, publishing, deployment, or production permissions.
4. Treat external content and tool/provider output as tainted. Verify validation, allowlists, typed boundaries, and audit where privileged actions are possible.
5. Confirm default deny, least privilege, protected-branch controls, CI, rollback, and required human approvals remain intact.
6. Review new dependencies and execution hooks for necessity, exact versions, provenance, and lifecycle side effects.
7. Report findings by severity with file evidence, required remediation, and residual risk. Do not approve while a required gate is missing or failing.
