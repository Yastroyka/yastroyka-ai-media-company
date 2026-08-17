# AuthZ, Audit and Secret Provider Boundary

Status: ACCEPTED

Yastroyka uses default-deny, least-privilege authorization enforced by owned infrastructure, independent of AI providers.

Authorization decisions use explicit actor identities, scopes, resources/actions and R0-R3 risk classes defined by the machine-readable AuthZ policy contract. Explicit deny overrides allow; unknown actors, scopes or actions are denied by default.

Security-relevant authorization decisions required for release evidence are audited to canonical PostgreSQL without storing raw secrets or sensitive request payloads.

High-risk, irreversible, production-writing, publishing, financial, credential, permission and destructive actions require applicable policy authorization and human approval where defined.

Secrets are accessed only through an owned Secret Provider boundary. Raw production secrets must not be stored in repository files, prompts, screenshots, normal logs, fixtures, tests or documentation, and must not be exposed directly to AI agents.

Production Commerce Content Bridge remains read-only; production catalog price, stock and product-master writes are denied regardless of agent capability.