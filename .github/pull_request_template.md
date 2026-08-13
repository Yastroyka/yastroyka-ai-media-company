\# YASTROYKA Pull Request

\## Summary

\*\*Task / Issue:\*\*

\*\*What changed:\*\*

\*\*Why this change is needed:\*\*

\## Scope

\- \[ ] Changes are limited to the declared task.

\- \[ ] No unrelated refactoring or generated changes are included.

\- \[ ] Existing architecture and repository contracts were reviewed.

\## Architecture \& Contracts

\- \[ ] No architecture or canonical-contract changes are introduced.

\- \[ ] If architecture or contracts changed, the relevant ADR/specification was updated.

\- \[ ] PostgreSQL remains the canonical source of owned business state where applicable.

\- \[ ] Derived projections and external providers are not treated as canonical authority.

\## Security \& Data

\- \[ ] No secrets, credentials, tokens, private keys, or sensitive data are committed.

\- \[ ] New permissions and external write paths were reviewed.

\- \[ ] Dependency and supply-chain changes were intentionally reviewed.

\- \[ ] High-risk or irreversible actions remain behind explicit policy/human approval where applicable.

\## Validation

\- \[ ] `pnpm run quality:check` passes.

\- \[ ] Relevant tests were added or updated where required.

\- \[ ] Database/schema changes include a safe migration and rollback plan where applicable.

\- \[ ] Documentation/contracts were updated where behavior changed.

\## AI-Assisted Development

\*\*AI/agent used, if any:\*\*

\*\*Human reviewer:\*\*

\- \[ ] AI-generated changes were reviewed by a human before merge.

\- \[ ] The agent did not override the Project Constitution, accepted ADRs, contracts, or security policy.

\- \[ ] Any uncertainty or conflict was surfaced instead of silently guessed.

\## Risk \& Rollback

\*\*Main risks:\*\*

\*\*Rollback / recovery plan:\*\*

\## Reviewer Notes

Anything the reviewer should pay particular attention to:
