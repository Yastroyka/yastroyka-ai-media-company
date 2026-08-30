# VK Community live execution boundary

TASK-021 adds the final operator bootstrap for the accepted guarded VK Community runtime. The command is intentionally live-capable, but repository code, CI, and ordinary development workflows do not invoke the real VK transport.

## Read-only release rehearsal

Before owner signing or any secret-bearing execution path, run:

```text
pnpm --filter @yastroyka/publishing vk:release-rehearsal <publication-id> <non-secret-manifest.json>
```

The rehearsal runs production preflight and reads the exact canonical `VK_COMMUNITY + AUTO` publication through the read-only PostgreSQL lease. READY output contains the exact approval packet, exact community/owner destination, the exact `--confirm-live-wall-post=<owner-id>` string required by the live operator, and only the names of the two environment variables expected by TASK-021.

The rehearsal does **not** read either environment secret value, read an owner grant, construct the VK transport, make a network request, mutate publication state, or call `wall.post`.

## Live command

```text
pnpm --filter @yastroyka/publishing vk:execute-live <publication-id> <owner-grant.json> <non-secret-manifest.json> --confirm-live-wall-post=<owner-id>
```

`owner-id` is the negative VK Community owner ID returned by production preflight. The confirmation must equal the preflight destination exactly. A mismatch stops before the owner-grant file is read and before PostgreSQL is opened.

## Required operator sequence

1. Independently confirm the exact production VK Community ID and build the non-secret manifest.
2. Run `vk:release-rehearsal` and review the exact preview, fingerprint, destination, and live-confirmation string.
3. Produce the canonical approval packet from the exact `VK_COMMUNITY + AUTO` publication if a separately stored packet is needed.
4. Sign the READY packet with the owner-side offline signer. The owner private key never enters the runtime.
5. Optionally run `vk:verify-execution` to inspect the fresh public execution binding.
6. Only after a separate explicit owner decision, run `vk:execute-live` with the exact destination confirmation shown by the rehearsal.

## Secret boundary

The non-secret manifest contains references only. The live operator uses the existing environment-backed Secret Provider with fixed bindings:

- `YASTROYKA_VK_COMMUNITY_ACCESS_TOKEN` for the manifest's `publishing/vk-community/...` reference;
- `YASTROYKA_VK_COMMUNITY_PUBLISHING_IDENTITY_SECRET` for the manifest's `publishing/identity/vk-community/...` reference.

Never put either secret value in the manifest, owner-grant file, command line, repository, logs, screenshots, issue/PR text, or chat.

## Result semantics

`PUBLISHED` means the external VK evidence passed validation and the exact result was persisted canonically.

`BLOCKED` is used only for conditions known to occur before an ambiguous external write, including production preflight, destination confirmation, owner-grant verification, canonical publication validation, identity validation, and secret access.

`UNKNOWN` means the external outcome may already exist. Transport failure, transport-evidence failure, result-persistence failure, result-evidence failure, or another post-execution ambiguity must never be treated as a retry-safe failure. Inspect canonical evidence and VK state by idempotency/guid before any manual retry.

## Production activation

The existence of these commands is not production authorization. `vk:execute-live` must not be invoked against real VK until the exact production community ID has been independently confirmed, the non-secret manifest is correct, secrets are provisioned outside the repository, and the owner has reviewed the exact rehearsal/preview and destination and issued a separate explicit real-publish command.
