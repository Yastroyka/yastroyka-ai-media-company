# TASK-011 — Analytics Attribution

## OBJECTIVE

Connect the canonical tracked path from product / offer / master content / campaign / publication to click / session / order line / GMV without claiming that the tracked publication caused the order.

## CONTEXT

Follow the Project Constitution and accepted ADRs. PostgreSQL remains the canonical R1 System of Record. TASK-009/TASK-010 already provide canonical publication state and product/offer attribution metadata used by publishing.

## SCOPE

- add canonical PostgreSQL state for analytics sessions, tracked clicks, order lines, and order-line attribution;
- record a tracked click only for an existing canonical `PUBLISHED` publication and existing campaign;
- derive `master_content_id` from the canonical publication instead of accepting it from the analytics caller;
- retain exact product and offer identifiers on the tracked click and order line;
- record GMV in integer minor currency units to avoid floating-point money arithmetic;
- assign each order line at most once using deterministic `LAST_TRACKED_CLICK` within the same session and exact product/offer pair, where the click happened no later than the order line;
- make attribution assignment immutable/idempotent once persisted;
- expose a query from one publication to the full tracked product/offer/content/campaign/publication → click/session/order_line path and GMV grouped by currency;
- label every returned path as `NON_CAUSAL_OBSERVED_ATTRIBUTION`;
- add reversible migration `0005-analytics-attribution` and PostgreSQL integration coverage.

## OUT OF SCOPE

- causal-inference claims, incrementality, lift, MMM, experiments, or statements that a publication caused an order;
- cross-device identity resolution;
- user-profile, email, phone, IP, cookie, fingerprint, or other personal-data collection;
- third-party analytics SDKs or external network calls;
- production event ingestion endpoints;
- probabilistic attribution;
- currency conversion or combining GMV across currencies;
- Control Room analytics UI;
- Elasticsearch analytics projections;
- TASK-012 Golden Evals Release Gate.

## DATA / SECURITY

- PostgreSQL is canonical.
- No secrets or credentials are accepted by the analytics store.
- Tracking identifiers are bounded non-secret identifiers only.
- No personal-data field is introduced.
- Order-line GMV is non-negative integer minor units and aggregated only within its original currency.
- Each order line has at most one canonical attribution row, preventing double counting across publication reports.
- Attribution rows must persist `causality_claim = false` and `attribution_model = LAST_TRACKED_CLICK`.

## RISK

R2 for implementation because TASK-011 adds a reversible canonical PostgreSQL schema migration. It performs no production write, external analytics call, credential change, permission expansion, or irreversible migration.

## ACCEPTANCE

- tracked path is queryable end-to-end from publication through click/session/order line to GMV;
- the query retains product, offer, master content, campaign, publication, click, session, and order-line identities;
- two attributed order lines aggregate GMV exactly once per original currency;
- a draft/non-published publication cannot create a tracked click;
- an order line with no prior exact product/offer click in its session cannot be attributed;
- repeated attribution of the same order line is idempotent and does not create duplicate GMV;
- the deterministic latest eligible tracked click wins;
- every output explicitly states non-causal observed attribution;
- migration down/up is reversible in canonical PostgreSQL integration testing.

## TESTS

- repository `quality:check`;
- `@yastroyka/db` typecheck;
- canonical PostgreSQL integration suite including `task-011.integration.test.ts`;
- `git diff --check`;
- exact-head GitHub Actions CI.

## ROLLBACK

Revert the TASK-011 squash commit and run migration `0005-analytics-attribution` down through a separately controlled database rollback procedure when required. The migration owns only TASK-011 analytics tables/indexes.

## EVIDENCE

Provide base/head SHA, changed-file scope, migration evidence, PostgreSQL integration results, exact-head CI, open risks, and rollback statement.

## OWNER GATES

Draft PR may be created autonomously. Ready transition and merge remain separate explicit owner actions. TASK-011 does not authorize production analytics ingestion or deployment.

## CONFLICT RULE

Return `BLOCKED/CONFLICT` instead of guessing or broadening authority.
