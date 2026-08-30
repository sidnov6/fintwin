# ADR 0001: Fixture-first deterministic ledger

- Status: Accepted
- Date: 2026-08-30
- Scope: P0/P1 only

## Context

The interview build must prove reconciliation, transfer conservation, reversal handling,
reproducibility, and tenant isolation before later product surfaces are implemented. A
database-first generator would make those invariants harder to inspect and would couple
the canonical demo story to local PostgreSQL availability.

## Decision

Generate one byte-stable, normalized JSON fixture from an explicit integer seed. Treat
that fixture as the deterministic import boundary, then project it into PostgreSQL through
the P0/P1 schema. Keep all money as two-decimal strings at the JSON boundary and as
`Decimal`/`NUMERIC(18,2)` internally. Repository reads always require `household_id`.

The checked fixture contains source IDs, canonical transactions, balance snapshots,
transfer matches, reversal links, planted-event ground truth, and a SHA-256 content hash.

## Consequences

- P1 invariants can be tested without a database process and reproduced in CI.
- The database schema remains the target source of truth for the running service.
- The database projection/import command is intentionally the next P1 hardening step;
  no P2 work depends on bypassing this boundary.
