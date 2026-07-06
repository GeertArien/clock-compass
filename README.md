# Clock & Compass

[![CI](https://github.com/GeertArien/clock-compass/actions/workflows/ci.yml/badge.svg)](https://github.com/GeertArien/clock-compass/actions/workflows/ci.yml)
[![Release](https://github.com/GeertArien/clock-compass/actions/workflows/release.yml/badge.svg)](https://github.com/GeertArien/clock-compass/actions/workflows/release.yml)

A personal todo and productivity app organized around the principles popularized
in Stephen Covey's *The 7 Habits of Highly Effective People*. Put your big rocks
in first — let the smaller tasks fill in around them.

> Inspired by the prioritization and effectiveness principles popularized by
> Stephen Covey. This project is not affiliated with or endorsed by the
> Covey/FranklinCovey organizations.

## What it does

One data layer seen through three modes — **Compass defines, Clock does,
Almanac remembers**:

- **Compass** — personal mission statement, roles, goals, projects (with an
  Inbox), the importance × urgency quadrant matrix, the people who matter
  (recurring commitments with cadence tracking + an emotional bank account
  ledger), and renewal habits across the four Sharpen-the-Saw dimensions.
- **Clock** — the everyday home: Today (big rocks, agenda, habit check-ins)
  and a Week view for "big rocks first" planning.
- **Almanac** — read-only review: weekly summary, trends, habit streaks, and
  an optional AI-written review.

Extras: AI assistance (classify a captured sentence into a quadrant, tag
influence vs concern, refine the mission, weekly review) via Anthropic, any
OpenAI-compatible endpoint, or your ChatGPT Plus/Pro subscription ("Sign in with
ChatGPT"); Todoist CSV import; an installable PWA with web push notifications;
and an MCP server so agents can work with your data.

## Architecture

A pnpm monorepo. All business logic lives in **`packages/core`** (the single
source of truth); the HTTP layer and the MCP adapter are thin consumers.

```
apps/
  web/      Svelte 5 + Vite + TypeScript + Tailwind + shadcn-svelte (mobile-first PWA)
  server/   Fastify HTTP layer — thin routes that call core; serves the built web app
packages/
  core/     Prisma schema + client, repositories, services, AI provider interface
  mcp/      MCP server (stdio) wrapping the core services as agent tools
```

- **Repositories** are the only code that touches Prisma. Services depend on
  repository interfaces, which keeps the SQLite→Postgres swap and the MCP
  adapter clean.
- The **quadrant** (importance × urgency) is always *derived*, never stored.
- The **REST API is the source of truth**, with an auto-generated OpenAPI spec at
  `/docs` and bearer-token auth: the `API_AUTH_TOKEN` admin token, or named
  **API keys** generated in Settings (hash-only storage, revocable).
- The **MCP server** (`pnpm --filter @clock-compass/mcp start`, with
  `DATABASE_URL` set) exposes the same services as tools for agents — tasks,
  quadrants, big rocks, goals, people, commitments, habits, and renewal.

## Local development

Prerequisites: Node.js ≥ 20 (22 recommended) and pnpm 10 (`corepack enable`).

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then edit values; .env is gitignored

# 3. Set up the database (SQLite)
pnpm db:migrate             # apply migrations + generate the Prisma client
pnpm db:seed                # optional: a little starter data

# 4. Run
pnpm --filter @clock-compass/server dev   # API on http://localhost:3000
pnpm --filter @clock-compass/web dev      # UI on http://localhost:5173 (proxies /api)
```

API docs: <http://localhost:3000/docs>

### Workspace scripts

| Command          | What it does                                  |
| ---------------- | --------------------------------------------- |
| `pnpm typecheck` | Type-check every workspace                    |
| `pnpm lint`      | ESLint across the repo                        |
| `pnpm test`      | Run all test suites (Vitest)                  |
| `pnpm build`     | Build core, server, and web                   |
| `pnpm db:migrate`| Create/apply Prisma migrations (dev)          |
| `pnpm db:seed`   | Seed the database                             |

## Configuration

Everything is configured via environment variables (see `.env.example` for the
full, commented list):

| Variable            | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `DATABASE_URL`      | Prisma connection string (SQLite by default; Postgres-ready) |
| `API_AUTH_TOKEN`    | Bearer token for the REST API (unset = open, the default)|
| `PORT` / `HOST`     | Where the server listens                                 |
| `ANTHROPIC_API_KEY` | AI features via the Anthropic API (optional)             |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` | AI via any OpenAI-compatible endpoint — OpenAI, Ollama, LM Studio, vLLM, OpenRouter… (optional) |
| `AI_PROVIDER`       | Force `anthropic`, `openai-compatible`, or `codex`; otherwise inferred from the keys above (`codex` is never inferred) |
| `CODEX_MODEL`       | Model for the ChatGPT-subscription provider (`AI_PROVIDER=codex`); defaults to `gpt-5` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (optional; generate the pair with `pnpm --filter @clock-compass/server exec web-push generate-vapid-keys`) |

AI and push are both optional — the app works fine with neither configured.

**Using a ChatGPT subscription:** set `AI_PROVIDER=codex` (no API key needed),
then open Settings → AI → **Sign in with ChatGPT**. You'll get a short code to
enter at the linked page; once approved, the app drives your ChatGPT Plus/Pro
plan through the same Codex sign-in the Codex CLI uses. The OAuth tokens are
stored in the database and refreshed automatically; subscription rate limits
apply, and you can disconnect at any time from the same screen.

## Docker

A multi-stage build compiles the frontend and serves it as static files from the
Fastify backend — one container. The SQLite file is persisted on a named volume.

```bash
# Build and run the stack
docker compose up --build

# App + API on http://localhost:3000  (docs at /docs)
```

By default the instance is **open** (no auth) — fine for a single-user box on
your own network. To require a bearer token on the API, set `API_AUTH_TOKEN`
(e.g. `API_AUTH_TOKEN=$(openssl rand -hex 32) docker compose up`) and enter the
same token in the web UI's settings (gear icon).

The database lives on the `clock-compass-data` volume (mounted at `/data`), so
it survives container restarts. Migrations are applied automatically on boot.

Swapping to Postgres later is a provider + `DATABASE_URL` change (an optional
`db` service is stubbed in `docker-compose.yml`) — no application code changes.

### Run the prebuilt image (no local build)

CI publishes a public image to GitHub Container Registry on every push to
`main` and on version tags — no authentication needed to pull:

```bash
docker run -p 3000:3000 -v clock-compass-data:/data ghcr.io/geertarien/clock-compass:latest
# → http://localhost:3000  (open by default; add -e API_AUTH_TOKEN=… to require a token)
```

## PWA & notifications

The app is an installable PWA (add-to-homescreen; the shell and fonts work
offline). With VAPID keys set, enable push per device in Settings →
Notifications — overdue commitments, the morning rock reminder, and the Sunday
review arrive even with the app closed. Push requires HTTPS (or localhost).

## Secrets

Never commit secrets. Only `.env.example` is tracked; the real `.env` is
gitignored. The AI keys and the API auth token must come from the environment.
