---
title: FinTwin
emoji: 💬
colorFrom: green
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
---

# FinTwin

FinTwin is a financial companion you talk to. It remembers what you tell it, works out
what follows (net worth, cashflow, reserve, mortgage and retirement scenarios), tells you
plainly what stands out and what it does not know, and lets you correct any fact in place.

It is an independent prototype with no bank, broker or insurer connections. It does not
provide financial, investment, insurance, tax or legal advice, and it never recommends
products or executes anything.

## How it works for the person using it

1. **The conversation is the product.** A new person is onboarded in the chat, one short
   question at a time (goal, age, income, spending, cash, investments, property, debt,
   retirement age). Every answer becomes a fact and appears immediately in the picture
   rail. Anything can be skipped, and "load sample data" fills a clearly labelled
   synthetic household so the whole app can be explored in one tap.
2. **Every number is derived, never invented.** Facts live in a typed registry
   (`packages/engine`). The engine derives the picture, runs deterministic mortgage,
   retirement and goal calculations, produces neutral insights and ranks the open
   questions by how much they would change the picture.
3. **The assistant acts through tools.** Whether the live model or the offline companion
   is answering, it stores facts, runs scenarios, saves memories and next steps through
   the same tool layer. Results appear as cards inside the thread and the picture updates
   live over the same stream.
4. **The picture is editable.** Any fact can be edited or removed on the Picture screen;
   the edit shows up in the thread so the conversation and the data never diverge.
5. **What-if planning is instant.** The Plan screen runs the same engine client-side with
   sliders, and any scenario can be handed to the conversation in one click.
6. **Voice.** Speech input uses the browser's recogniser (live interim text) with a
   server transcription fallback; replies are spoken sentence by sentence as they stream
   and stop when you start talking. Hands-free mode keeps listening after each answer.
7. **German and English** are both first-class in the UI, the engine and the companion.

## Architecture

```text
apps/web (Next.js 15, static export)
  ├── Chat            streaming thread, cards, composer, voice
  ├── Picture         rail + full editable fact view, sample portfolio
  └── Plan            client-side what-if with the shared engine
        │  JSON + server-sent events
        ▼
sites-worker/src (TypeScript, bundled with esbuild)
  ├── index.ts        routes, viewer identity, CORS for local dev
  ├── chat.ts         POST /v1/chat: live model loop (Groq, tools, streaming) or companion
  ├── companion.ts    deterministic conversation engine (onboarding, intents, answers)
  ├── tools.ts        set_facts, run_mortgage, run_retirement, run_goal, get_portfolio, ...
  ├── state.ts        assembles profile + facts + picture + sample portfolio quotes
  └── db.ts           per-user tables on the D1-style SQLite binding
packages/engine       facts registry, picture derivation, calculators, parsing (pure)
packages/contracts    API and event types shared by worker and web
services/api          earlier FastAPI reference implementation of the spec (unchanged)
```

Without a model key the offline companion answers everything; with `GROQ_API_KEY` set the
live model (`openai/gpt-oss-120b` by default) answers with the same tools and falls back to
the companion if it fails.

## Run locally

```bash
pnpm install
pnpm dev:all        # API on :8787 (SQLite in ./data/local.sqlite) + web on :3000
```

Or in two terminals: `pnpm dev:api` and `pnpm dev`. The local API injects a signed-in
viewer (`FINTWIN_VIEWER`, default `local-dev-user`); in production the hosting platform
sets the `oai-authenticated-*` headers. Set `GROQ_API_KEY` in the environment to use the
live model and server voice.

## Host it

The `Dockerfile` runs the same Node server that serves the static app and the API on one
origin (port 7860), with a per-browser cookie as identity and SQLite under `/data`. It is
what the Hugging Face Space uses; set `GROQ_API_KEY` as a secret there for the live model.
Storage on a free Space is ephemeral, so conversations reset when the Space restarts.

## Check

```bash
pnpm typecheck        # web + worker
pnpm lint
pnpm test:worker      # engine goldens and full offline conversations against SQLite
pnpm test:e2e         # Playwright: onboarding, editing, scenarios, German, boundaries
pnpm build:web        # static web export only
pnpm build            # deployable dist/ with client assets + bundled worker
pnpm build:site       # alias for the deployable build
```

## API

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/v1/state` | profile, facts, derived picture, sample portfolio, next steps, memories |
| GET | `/v1/messages` | conversation history (adds a greeting when the thread is stale) |
| POST | `/v1/chat` | one turn, streamed as `start`, `delta`, `card`, `state`, `done` events |
| PATCH / DELETE | `/v1/facts` | edit or remove facts directly |
| PATCH | `/v1/profile` | name, language, voice autoplay |
| POST | `/v1/sample` | load the synthetic sample household |
| POST/PATCH/DELETE | `/v1/next-steps` | agreed actions |
| POST | `/v1/reset` | delete everything for the signed-in person |
| POST | `/v1/voice/transcribe`, `/v1/voice/synthesize` | speech in / out |

## Boundaries

The companion explains criteria and prepares questions; it does not pick products, rank
providers, execute trades, promise returns or give binding tax, legal or credit
conclusions. Sample data is synthetic and always labelled. Model results are labelled as
model calculations, not forecasts.
