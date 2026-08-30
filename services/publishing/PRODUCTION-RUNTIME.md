# VK Community production runtime composition

TASK-020 adds the production composition root without adding a live operator command.

`createVkCommunityProductionRuntime(...)` accepts only explicit dependencies:

- canonical production manifest metadata;
- a PostgreSQL database connection;
- the accepted authorization policy and authorization audit sink;
- a Secret Provider implementation;
- a VK transport implementation;
- an optional clock.

The composition order is fixed:

1. canonical production preflight must be `READY`;
2. `PostgresPlatformWorkspaceStore` provides canonical publication reads;
3. `VkCommunityRuntimeController` re-reads the exact preview and verifies the Ed25519 owner grant;
4. only then may the publishing-identity HMAC secret be consumed to issue the short-lived runtime identity;
5. `HmacPublishingIdentityBinding` verifies that identity with the same secret boundary;
6. `VkCommunityPublishingAdapter` re-reads the canonical preview again and requires the exact preview fingerprint before VK credential access;
7. only then is the VK credential consumed and the caller-supplied transport invoked;
8. `VkCommunityLivePublisher` validates external evidence;
9. `PostgresVkCommunityResultStore` authorizes and persists the exact `PUBLISHED` result.

The production runtime does **not** construct a Secret Provider implicitly and does **not** construct the VK HTTP transport implicitly. This prevents ordinary module construction from creating an external-write path.

TASK-020 CI uses real PostgreSQL and the full runtime composition, but injects a fake VK transport and fake in-memory secret values. No network request is made. The integration gate proves that a valid signed grant reaches the fake transport and exact canonical result persistence, while a tampered grant reaches neither secret access nor transport.

There is intentionally no `vk:execute` package command in TASK-020. A later operator slice may expose the live runtime only behind the existing exact owner gate. The first real VK post must still show the exact canonical preview and destination before the owner explicitly authorizes the external write.
