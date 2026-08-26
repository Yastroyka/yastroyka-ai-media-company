# TASK-013 — FIRST REAL VK POST Runtime Gate

## OBJECTIVE
Add the owner-gated runtime boundary that can promote an exact approved VK Community publication into the already-implemented live publisher, without activating real credentials or performing a real external write.

## CONTEXT
Follow PROJECT_CONSTITUTION, ADR-0005, AGENT_EXECUTION_CONTRACT, TASK-010, and the merged FIRST REAL VK POST transport/result-persistence foundation.

## SCOPE
- verify a short-lived HMAC owner execution grant for the exact publication and deployment-owned VK Community destination;
- issue the narrow short-lived `publishing_service` identity only after the owner grant is verified;
- expose read-only preview without secret access or external write;
- validate live result evidence against the exact preview before returning success;
- keep all secret material transient behind the Secret Provider boundary;
- document the operational promotion sequence.

## OUT OF SCOPE
- no production VK token or HMAC key activation;
- no owner-grant signing secret in repository, CI, prompts, logs, screenshots, fixtures, or docs;
- no production runtime deployment;
- no real VK network request;
- no first external VK post;
- no bypass of publication approval/freshness/AUTO/AuthZ gates.

## RISK
R3. Publishing/credential-adjacent runtime boundary.

## ACCEPTANCE
- preview performs no secret access and no external write;
- invalid, expired, wrong-publication, or wrong-destination owner grant fails closed before live publish;
- a valid owner grant produces a compatible short-lived `publishing_service` identity bound to the exact publication and VK destination;
- raw secret/provider errors are sanitized;
- live result evidence must match exact publication, destination, platform, and idempotency key;
- no production secret or real network call is used in tests.

## TESTS
Automated tests first. Exact-head CI is required before owner decision.

## ROLLBACK
Close the Draft PR before merge or revert the squash commit after merge. No schema rollback is expected.

## EVIDENCE
Exact diff, exact-head CI, security review, test counts, open operational gates.

## CONFLICT RULE
Return BLOCKED/CONFLICT instead of guessing.
