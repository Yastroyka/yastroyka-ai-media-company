# TASK-023 — VK Community Destination Resolver

## OBJECTIVE
Resolve an owner-confirmed public VK Community URL to the exact numeric community/owner IDs through the official VK API without any publication, database access, or owner-grant flow.

## CONTEXT
TASK-021 provides controlled live execution and TASK-022 provides the read-only release rehearsal, but both require an exact numeric `communityId`. The owner-confirmed public destination is `https://vk.ru/yastroykaru`; the numeric ID must not be guessed from the screen name.

## SCOPE
- add a dedicated read-only `VkCommunityScreenNameResolver` beside the existing VK HTTP transport;
- call official `utils.resolveScreenName` using VK API version `5.199`;
- send the VK access token only in the POST body, never in the URL;
- accept only `group` or `page` VK object types as communities;
- return exact `screenName`, `communityId`, negative `ownerId`, and object type;
- add `vk:resolve-community <https://vk.ru/screen-name>` under `@yastroyka/publishing`;
- accept only HTTPS `vk.ru` / `vk.com` URLs with one validated screen-name segment;
- access `YASTROYKA_VK_COMMUNITY_ACCESS_TOKEN` only through the existing environment Secret Provider;
- emit only public destination binding data and sanitized failure states;
- add unit tests for URL validation, secret boundary, API request construction, community type validation, and sanitized failures.

## OUT OF SCOPE
- no PostgreSQL access;
- no publication state read or mutation;
- no owner approval key or owner grant;
- no publishing-identity secret;
- no `wall.post`;
- no real VK call in CI;
- no token value in repository, logs, output, screenshots, issue/PR text, or chat;
- no production manifest mutation in this task.

## RISK
R2. Read-only external lookup using an existing VK credential boundary; no publishing capability is invoked.

## ACCEPTANCE
- invalid/non-VK URL stops before secret access and network access;
- missing VK access token produces a sanitized BLOCKED result with only the required environment-variable name;
- the resolver POSTs `screen_name`, `access_token`, and `v=5.199` to the official endpoint;
- successful `group`/`page` responses produce exact positive `communityId` and negative `ownerId`;
- user/application/invalid responses fail closed;
- token material is absent from errors/stdout/stderr;
- exact-head CI passes.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema or deployment rollback is required.

## OWNER GATE
This resolver does not authorize publication. Any real `wall.post` still requires the existing exact preview/destination review and a separate explicit owner publish command.
