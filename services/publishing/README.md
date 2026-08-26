# Publishing Service

This directory owns the promotion boundary from an approved canonical publication to an external platform write.

## VK Community promotion sequence

The first real VK Community post must not be enabled until all of the following are wired and independently verified:

1. PostgreSQL publication state is loaded by `publicationId` and is exactly `VK_COMMUNITY` + `AUTO`.
2. The execution caller is bound by a trusted identity provider to the narrow `publishing_service` actor for the `vk-community-publish` audience.
3. The binding is short-lived and cannot be supplied as a plain caller-controlled actor string.
4. The VK credential is referenced only through the Secret Provider boundary under `publishing/vk-community/*`.
5. Secret material is transient: it is never persisted, logged, returned, copied into evidence, or attached to an error.
6. The concrete VK HTTP transport is pinned to the reviewed VK API contract and maps the internal deterministic idempotency key to the platform's current supported idempotency mechanism.
7. The destination community is deployment-owned configuration, not a per-request caller-selected destination.
8. The transport result is validated before it can be recorded as canonical publication evidence.
9. Successful external publication is followed by `recordAutoResult(...)`; a failed canonical result write must remain safely retryable without creating a duplicate external post.
10. Production credential activation and the first real external write require an explicit owner gate.

## Current foundation

`VkCommunityPublishingAdapter` lives in the orchestrator adapter boundary. It provides a read-only preview plus a guarded execution contract over injected publication-state, identity-binding, Secret Provider, and platform transport ports.

The repository intentionally does **not** yet contain a concrete VK HTTP transport or production VK access token. Therefore this foundation cannot perform a real external post by itself.

## Evidence rules

Canonical evidence may contain publication ID, platform, destination owner ID, external post ID, deterministic idempotency key, safe result code, and timestamp. It must not contain access tokens, secret references with inline material, raw VK responses, raw provider errors, cookies, session material, or authorization headers.
