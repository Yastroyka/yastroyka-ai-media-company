# TASK-018 — Offline VK Community Owner Grant Signer

## OBJECTIVE
Add a separate owner-side offline tool that converts one exact READY approval packet into a short-lived Ed25519 owner execution grant without adding private-key handling to the publishing runtime.

## CONTEXT
TASK-014 established the canonical owner-grant assertion/signing/verifying contract. TASK-016 established the exact canonical approval packet. TASK-017 wires the approval packet to read-only PostgreSQL state. The next boundary is owner-side signing after manual inspection of that exact packet.

## SCOPE
- add a separate `tools/owner-signing` workspace package;
- add `vk:sign-grant <approval-packet.json> <non-secret-manifest.json> <private-key.pem>`;
- parse the TASK-017 READY approval-packet output with exact keys and fail closed;
- recompute and verify the canonical preview fingerprint before private-key access;
- require the same non-secret production manifest to be READY;
- verify approval-packet destination equals the deployment preflight owner ID;
- read the owner private key only after all non-secret checks pass;
- accept only an Ed25519 PKCS#8 private key;
- derive its public key and require its fingerprint to match the configured owner public key;
- issue a fixed two-minute grant with a fresh UUID grant ID;
- sign using the canonical TASK-014 helper;
- immediately self-verify the resulting grant using only the configured public key and exact packet binding;
- emit only the public grant envelope;
- add focused typecheck/tests and CI gates.

## OUT OF SCOPE
- no owner private key in repository, fixtures, logs, chat, screenshots, or output;
- no private-key generation command;
- no Secret Provider access;
- no PostgreSQL access;
- no VK access token;
- no publishing-identity HMAC value;
- no publication mutation;
- no VK transport;
- no `wall.post`;
- no runtime owner signing;
- no production activation.

## RISK
R2. Security-sensitive owner-side tooling, but offline and side-effect free outside local file reads.

## ACCEPTANCE
- usage errors read no files;
- blocked production metadata is returned before approval-packet/private-key reads;
- approval packet must be exact, destination-bound, and fingerprint-valid before private-key access;
- wrong owner private key fails closed;
- signed grant is bound to exact publication ID, owner ID, and preview fingerprint;
- grant lifetime is exactly two minutes and remains within the TASK-014 five-minute maximum;
- the produced grant self-verifies against the configured owner public key;
- output never contains PEM/private-key material or rejected input;
- exact-head CI passes.

## EXIT CODES
- `0` — grant signed and self-verified;
- `2` — production metadata is safely BLOCKED;
- `64` — CLI usage error;
- `65` — invalid approval packet, manifest, clock, or private key.

## ROLLBACK
Close the Draft PR or revert its squash commit. No schema or deployment rollback is required.

## CONFLICT RULE
Fail closed. Never guess publication, destination, fingerprint, key identity, or grant timing.
