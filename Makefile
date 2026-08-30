.PHONY: install seed reset test test-e2e demo run api web build

install:
	pnpm install
	uv sync --project services/api

seed:
	uv run --project services/api python -m fintwin.seed --seed $${FINTWIN_SEED:-20260830} --output data/generated/becker.json --database-url "$${DATABASE_URL:-postgresql+psycopg://fintwin:fintwin@localhost:5432/fintwin}"

reset: seed

test:
	uv run --project services/api pytest -q
	pnpm test:web

test-e2e:
	pnpm --filter @fintwin/web test:e2e

api:
	uv run --project services/api uvicorn fintwin.main:app --reload --port 8000

web:
	pnpm dev

demo:
	docker compose up -d postgres
	uv run --project services/api alembic -c services/api/alembic.ini upgrade head
	$(MAKE) seed
	$(MAKE) -j2 api web

run: demo

build:
	pnpm build
	pnpm typecheck
