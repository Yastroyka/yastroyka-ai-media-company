# TASK-015 — VK Community Operator Preflight CLI

## OBJECTIVE
Add a minimal operator-facing Node.js entrypoint for production metadata preflight before any VK Community credential activation or external write.

## CONTEXT
Build on TASK-014 production preflight and owner-grant contracts. The operator needs a safe executable contour that can validate non-secret deployment metadata without exposing or reading VK access tokens, publishing-identity HMAC values, or the owner private signing key.

## SCOPE
- add a Node 24 CLI command for VK Community production preflight;
- accept one JSON manifest containing only non-secret metadata;
- reject unknown top-level manifest fields instead of silently accepting accidental inline secrets;
- call the canonical TASK-014 preflight implementation;
- emit only sanitized READY/BLOCKED JSON;
- use deterministic exit codes for READY, BLOCKED, usage error, and invalid manifest;
- add an orchestrator package script and operator documentation;
- keep the owner-side Ed25519 signing helper separate from the ordinary publishing runtime and from this preflight command.

## OUT OF SCOPE
- no production VK Community ID;
- no VK access token;
- no publishing-identity HMAC value;
- no owner Ed25519 private key;
- no Secret Provider reads;
- no database reads;
- no approval-packet generation from canonical publication state;
- no grant signing command;
- no VK network request;
- no publish command;
- no production activation.

## RISK
R2. Operator tooling adjacent to production metadata, but intentionally side-effect free.

## ACCEPTANCE
- valid metadata returns READY JSON with sanitized metadata only;
- incomplete metadata returns BLOCKED JSON and exit code 2;
- malformed JSON, oversized input, NUL data, or unknown top-level fields fail with one generic error and no reflected input;
- usage errors do not read a file;
- command cannot access Secret Provider or perform network I/O;
- exact-head CI passes.

## TESTS
Automated tests for READY, BLOCKED, unknown-field rejection, inline secret-reference rejection, and usage behavior.

## ROLLBACK
Close the stacked Draft PR before merge or revert its squash commit after merge. No schema rollback expected.

## CONFLICT RULE
Fail closed. Never guess destination metadata and never echo rejected input.
