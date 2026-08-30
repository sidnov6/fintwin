# FinTwin

FinTwin is an independent, synthetic-data interview prototype for holistic household
financial review and adviser preparation. The repository implements the complete P0–P6
interview scope: reconciled ledger, versioned Financial Twin, seven-domain Review,
deterministic scenarios, guarded scripted copilot, printable Adviser Brief, bilingual
responsive flow, and a feature-flagged education-goal calculator.

It is not a DVAG product, is not affiliated with or endorsed by DVAG, and does not use
internal DVAG information. It does not provide financial, investment, insurance,
mortgage, tax, or legal advice.

## What is included

- pnpm workspace with a strict Next.js 15 frontend and shared TypeScript contracts
- FastAPI/Pydantic/SQLAlchemy composition root managed with `uv`
- PostgreSQL 16 local service and Alembic migrations for ledger, Twin, findings, scenarios, and audit records
- seven synthetic accounts and 60 months of coherent Becker household activity
- 7,666 booked transaction records from seed `20260830`
- source IDs, balance snapshots, own-transfer matches, reversals, and planted event labels
- deterministic normalized fixture plus content hash
- household-scoped reference repository and cross-household non-leakage tests
- seven-domain Allfinanz Review with evidence, missing facts, neutral wording, and human-review questions
- provenance-rich Financial Twin correction with proposal, confirmation, optimistic concurrency, audit event, and immutable version increment
- Decimal-only mortgage and retirement engines with traces, warnings, versions, and property tests
- guarded scripted copilot covering all eight golden questions without an external model key
- printable Adviser Brief containing verified facts, selected scenarios, questions, gaps, and disclaimers
- responsive German-first UI, English golden-path toggle, browser tests, and print stylesheet
- feature-flagged child education-goal calculator (`ENABLE_CHILD_GOAL=true`)

## Architecture

```text
apps/web (Next.js 15)
    │ typed JSON envelope
    ▼
services/api (FastAPI)
    ├── household-scoped repository boundary
    ├── deterministic synthetic generator
    ├── reconciliation + versioned Twin services
    ├── Decimal-only finance engine
    ├── needs-review rules + policy gate
    └── scripted copilot + Adviser Brief contract
           │
           ▼
PostgreSQL 16 / NUMERIC money

packages/contracts ─ shared API types + OpenAPI snapshot
packages/ui        ─ shared design tokens
data/generated     ─ reproducible local fixture (ignored; regenerate anytime)
```

## Prerequisites

- Node.js 20 or newer
- pnpm 11
- Python 3.12 or newer and `uv`
- Docker with Compose for the PostgreSQL-backed local runtime

## Setup

```bash
cp .env.example .env
make install
docker compose up -d postgres
uv run --project services/api alembic -c services/api/alembic.ini upgrade head
make seed
```

`make seed` is deterministic and writes `data/generated/becker.json`. Override the seed
with `FINTWIN_SEED=1234 make seed`.

## Run

Start PostgreSQL, migrate, seed, and run both services with one command:

```bash
make demo
```

For separate terminals, use `make api` and `make web` after setup.

Open `http://localhost:3000`. The API health endpoint is
`http://localhost:8000/health` and the scoped overview endpoint is
`http://localhost:8000/v1/demo/households/hh_becker/overview`.

## Reset

```bash
make reset
```

This regenerates the canonical fixture with `FINTWIN_SEED` (default `20260830`). To reset
PostgreSQL as well:

```bash
docker compose down -v
docker compose up -d postgres
uv run --project services/api alembic -c services/api/alembic.ini upgrade head
make seed
```

## Test and validate

```bash
make test
make test-e2e
make build
pnpm lint
```

The test suite proves:

1. all 420 seeded account-months reconcile to €0.01;
2. every matched own transfer sums to €0.00 and is excluded from spend;
3. every planted reversal pair nets to €0.00;
4. promotion, annual bonus, recurring-cost drift, mortgage horizon, and reversal labels exist;
5. the same seed produces byte-equivalent normalized fixtures; and
6. an unknown or mismatched household scope returns no count, identifier, or content.
7. Twin corrections require confirmation, reject stale versions, and create versioned facts;
8. mortgage golden cases and mortgage/retirement monotonicity invariants hold;
9. personalized copilot claims carry source IDs and blocked intents refuse safely;
10. all seven Review domains are represented without a gamified score; and
11. the German golden browser path and English Adviser Brief smoke flow complete.

## Contract refresh

The API is the OpenAPI authority. Refresh the checked snapshot after route or schema work:

```bash
uv run --project services/api python services/api/scripts/export_openapi.py
```

## Seven-minute interview path

1. Open Overview and point out the independent-prototype and synthetic-data boundaries.
2. Open cashflow evidence and show transfer/reversal handling.
3. Open Twin, correct the inferred retirement age, and confirm Twin v18.
4. Compare the 4%, 5%, and 6% mortgage refix results and formula trace.
5. Open the retirement baseline and compare the age sensitivity.
6. Ask a golden question, then request a product recommendation to show the policy refusal.
7. Open the Adviser Brief and print or save it as PDF.

## Boundaries and limitations

- All data is synthetic and the seeded scenario is deliberately deterministic.
- No real account connection, OCR, product catalogue, quote, recommendation, suitability
  decision, tax/legal conclusion, application, trade, underwriting, or execution exists.
- The copilot is a transparent scripted fallback for the golden path; an external LLM is
  optional future enrichment and may never become the ledger or calculator.
- The education-goal calculator is a P6 beta behind a feature flag and does not alter the
  core Review or advice boundary.

The public-category and coaching-journey mapping in the source specification references
[DVAG’s public product overview](https://www.dvag.de/dvag/allfinanzberatung/produkte.html)
and [public financial-coaching page](https://www.dvag.de/dvag/finanzcoaching.html), retrieved
30 August 2026. Those links support high-level alignment only.
