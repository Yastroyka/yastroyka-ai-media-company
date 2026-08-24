# Commerce Content Bridge R1

The bridge builds a `ProductContentPack` from an explicit product and seller-offer pair.

Its source port is intentionally read-only. It exposes only `read*` methods, and the R1 service
contains no catalog, price, stock, product-master or seller-offer mutation operation.

Freshness is fail-closed:

- `FRESH`: price and stock are inside `ttl_seconds`; the pack may be built.
- `REFRESH`: the snapshot is outside its TTL but inside the configured refresh grace period; no
  pack is returned.
- `BLOCK`: the snapshot is older than TTL plus the grace period, has no verifiable TTL, is dated
  in the future, or another commerce contract/identity invariant fails.

The bridge validates untrusted source values at the adapter boundary and retains rights, claim and
source-mode provenance in the assembled pack.
