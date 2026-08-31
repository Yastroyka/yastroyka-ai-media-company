# YASTROYKA Control Room

Minimal R1 operational shell for the YASTROYKA AI factory.

## Authority boundary

The browser never becomes a source of canonical operational state. The page reads
`/api/control-room/overview`, and the Nitro server accepts a READY payload only
when it passes the exact `YASTROYKA_OWNED_BACKEND` contract in
`shared/control-room-contract.ts`.

There is no mock-data fallback. When the owned backend is not configured,
unreachable, rejects the request, or returns an invalid payload, the UI renders a
sanitized `UNAVAILABLE` state and no operational count is invented.

## Development

```text
pnpm --filter @yastroyka/control-room dev
```

The approved development origin is:

```text
https://dev.yastroyka.online
```

Runtime configuration:

- `NUXT_CONTROL_ROOM_API_BASE_URL` — server-only base URL for the owned read API;
- `NUXT_PUBLIC_CONTROL_ROOM_ORIGIN` — non-secret public environment label/origin.

Only HTTPS upstream URLs are accepted, except loopback HTTP for local
development. Credentials must never be embedded in the URL.

## Validation

```text
pnpm --filter @yastroyka/control-room typecheck
pnpm --filter @yastroyka/control-room test
pnpm --filter @yastroyka/control-room build
```

## Out of scope for v0.1

- authentication and authorization UI;
- approval/rework/stop mutations;
- direct PostgreSQL access from the UI;
- Socket.IO/SSE realtime;
- DNS, TLS, deployment, or production activation;
- VK credentials or any publishing command.
