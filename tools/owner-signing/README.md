# Owner Signing Tool

This package is the owner-side offline signing boundary for the first real VK Community post.

It is intentionally separate from `services/publishing`. The ordinary publishing runtime must never receive the owner Ed25519 private key.

## Command

After generating and manually inspecting a READY approval packet from TASK-017:

```bash
pnpm --filter @yastroyka/owner-signing vk:sign-grant \
  ./approval-packet.json \
  ./vk-production.json \
  /secure/local/path/owner-ed25519-private-key.pem
```

The private key path and private-key contents are local owner-side material. Do not commit them, paste them into chat, store them in issue/PR text, screenshots, CI variables, artifacts, logs, or the publishing runtime.

The tool performs these checks before signing:

1. the non-secret production manifest passes the canonical TASK-014/TASK-015 preflight;
2. the TASK-017 output is exactly `READY`;
3. the approval packet has exact fields and its preview fingerprint recomputes correctly;
4. the approval packet destination equals the deployment-owned VK owner ID;
5. only then is the private key file read;
6. the private key is Ed25519 and its derived public-key fingerprint equals the configured owner public key;
7. the grant is fixed to a two-minute lifetime;
8. the signed grant is immediately self-verified against the configured public key and exact publication/destination/fingerprint binding.

Successful stdout is only the public owner-grant envelope. Private PEM material is never returned.

This tool has no database access, Secret Provider access, VK transport, publishing-identity secret, publication mutation, or `wall.post` path.
