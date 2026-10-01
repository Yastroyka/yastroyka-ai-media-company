# TASK-027 Control Room Owned Read API Contract

## Goal

Provide a bounded read-only overview projection over canonical TASK-028 discovery sources.

## Endpoint

`GET /v1/control-room/overview`

## Sources

- latest engineering evidence
- latest Model Exchange decision
- pending approval summary
- workspace/publication metadata

## Constraints

- read-only
- bounded payload
- fail closed
- no secrets
- no publishing actions
- no fabricated incidents
