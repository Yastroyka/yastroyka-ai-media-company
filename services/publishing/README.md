# Publishing Service

This directory owns the promotion boundary from an approved canonical publication to an external platform write.

## VK Community promotion sequence

The first real VK Community post must not be enabled until all of the following are wired and independently verified:

1. PostgreSQL publication state is loaded by `publicationId` and is exactly `VK_COMMUNITY` + `AUTO`.
2. A short-lived owner execution grant is verified for the exact publication and deployment-owned VK Community destination.
3. Only after that owner grant is verified may the runtime issue the narrow short-lived `publishing_service` identity for the `vk-community-publish` audience.
4. The VK credential is referenced only through the Secret Provider boundary under `publishing/vk-community/*`.
5. Owner-approval and publishing-identity verification material is also referenced only through the Secret Provider boundary.
6. Secret material is transient: it is never persisted, logged, returned, copied into evidence, or attached to an error.
7. The concrete VK HTTP transport is pinned to the reviewed VK API contract and maps the internal deterministic idempotency key to VK `guid`.
8. The destination community is deployment-owned configuration, not a per-request caller-selected destination.
9. The transport result is validated before it can be recorded as canonical publication evidence.
10. Successful external publication is followed by canonical result persistence; retry uses the same deterministic idempotency key so an ambiguous network/result-persistence failure does not intentionally create a second post.
11. Production credential activation and the first real external write require an explicit owner gate.

## Current implementation

The repository now contains:

- `VkCommunityPublishingAdapter` for canonical `AUTO` state validation, read-only preview, transient Secret Provider access, and guarded external execution;
- `HmacPublishingIdentityBinding` for short-lived `publishing_service` identity verification bound to exact publication and destination;
- `VkCommunityHttpTransport` pinned to `https://api.vk.com/method/wall.post` and VK API `5.199`;
- `VkCommunityLivePublisher` for external execution followed by exact canonical result persistence;
- `PostgresVkCommunityResultStore` for idempotent `AUTO -> PUBLISHED` result persistence;
- `VkCommunityRuntimeController` for read-only preview plus verification of a separate short-lived owner execution grant before service identity issuance.

The runtime controller intentionally does not contain an owner-grant signing secret and cannot self-approve. An owner grant must come from a trusted owner-side signing operation outside the ordinary publishing runtime.

## Still owner-gated

The repository does not contain production VK token values, production HMAC key values, or an activated production deployment configuration. Tests use only fake/in-memory secrets and fake transports.

Before the first real post, the operator must still:

1. provision the production owner-approval HMAC secret outside the repository and AI-visible channels;
2. provision the publishing-identity HMAC secret outside the repository and AI-visible channels;
3. provision the VK access token through the Secret Provider boundary;
4. bind the deployment to the exact VK Community ID;
5. generate and inspect the exact read-only preview;
6. create a short-lived owner execution grant for that exact publication + destination;
7. execute the real publish only after the owner's explicit command.

## Evidence rules

Canonical evidence may contain publication ID, platform, destination owner ID, external post ID, deterministic idempotency key, safe result code, and timestamp. It must not contain access tokens, HMAC key material, raw VK responses, raw provider errors, cookies, session material, authorization headers, or inline secret values.
