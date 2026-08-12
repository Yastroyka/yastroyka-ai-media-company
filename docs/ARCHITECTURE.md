# ARCHITECTURE — R1

## Planes
1. Human Workspace Plane — Cowork optional, never canonical.
2. Control Plane — YASTROYKA Control Room, approvals, incidents, routing transparency.
3. Orchestration Plane — Orchestrator Port, Claude primary adapter, replaceable provider.
4. Durable Execution Plane — Temporal.
5. Job Plane — Redis + BullMQ.
6. Integration Plane — H3 services, n8n edge integrations, MCP, provider adapters.
7. Data Plane — PostgreSQL canonical + Outbox + Object Storage + Elasticsearch projection.
8. Commerce Plane — CatalogProduct, SellerOffer, OfferSnapshot, ProductContentPack, freshness gate.
9. Model Exchange Plane — Capability Registry, hard gates, Yastroyka Score, benchmarks, canary, WHY THIS MODEL.
10. Platform Plane — VK-OS parent; VK-COMMUNITY-OS; VKVIDEO-OS; MAX-OS.

## Ownership rule
Temporal workflow state is not stored in n8n. Elasticsearch is not canonical. Cowork is not canonical. Provider dashboards are not canonical.
