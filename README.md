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
  web/        React + Vite + TypeScript + Tailwind + shadcn/ui (mobile-first, installable PWA)
  server/     Fastify HTTP layer — thin routes that call core; serves the built web app
packages/
  web-client/ Framework-neutral browser client for the web app (REST client, helpers)
  core/       Prisma schema + client, repositories, services, AI provider interface
  mcp/        MCP server (stdio) wrapping the core services as agent tools
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

### MCP tools

The write tools are the app's **operations**: one list, shared with the in-app
assistant and `POST /api/operations/{name}`, with the same checks and refusals
everywhere. Each tool's name comes from its operation's by rule (`setTaskDone`
→ `set_task_done`).

| Tool | What it does |
|---|---|
| `create_task`, `update_task` | Create a task; set the given fields of one (`null` clears a field). `repeat` makes it a repeating task (`{ unit, every?, from?, leadDays? }`, or `null` to stop) |
| `set_task_done` | Mark a task done (`done: true`) or open |
| `schedule_task` | Put a task on a day in the Clock, at a time or none, or take it off (`day: null`) |
| `set_big_rock` | Pin a Quadrant II task as a big rock, or unpin it |
| `accept_week_plan` | Make exactly these Quadrant II tasks the week's big rocks |
| `delete_task` | Delete a task |
| `set_habit_done` | Check a habit off for a day (default today), or undo it |
| `set_intention` | Set this week's intention for a renewal dimension, or clear it (`text: null`) |
| `set_mission` | Make this the mission statement (earlier versions are kept) |
| `create_goal`, `create_project` | Create a goal (optionally under a role) or a project (optionally for a goal) |
| `log_commitment_occurrence` | Log that a relationship commitment happened |
| `add_eba_entry` | Log an emotional-bank-account deposit or withdrawal |
| `log_renewal_activity` | Log a one-off renewal activity |

- **Target states, safe to repeat:** every tool but the creates states the
  result it wants (`done: true`, not a toggle), so sending it twice changes
  nothing the second time. Results say how many items changed (`changed`).
- **Creating once:** the creates take an optional `idempotencyKey`. The same key
  makes the item once and then answers with it (`changed: 0`), as the
  endpoint's `Idempotency-Key` header does.
- **Days** are plain dates, `YYYY-MM-DD`, read in the server's time zone (MCP
  has no browser).

The read tools are `list_tasks`, `quadrant_matrix`, `big_rocks_this_week`,
`get_mission`, `list_roles`, `list_goals`, `list_projects`, `people_overview`,
`overdue_commitments`, `list_habits`, `renewal_summary`, `renewal_trends` and
`weekly_intentions`, each marked read-only.

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
| `pnpm build`     | Build core, server, and both web apps         |
| `pnpm size`      | Build both web apps and compare bundle sizes  |
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
| `WEB_DIST_PATH`     | Frontend build to serve (default: `apps/web/dist`)       |
| `ANTHROPIC_API_KEY` | AI features via the Anthropic API (optional)             |
| `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_KEY` | AI via any OpenAI-compatible endpoint — OpenAI, Ollama, LM Studio, vLLM, OpenRouter… (optional) |
| `AI_PROVIDER`       | Force `anthropic`, `openai-compatible`, or `codex`; otherwise inferred from the keys above (`codex` is never inferred) |
| `CODEX_MODEL`       | Model for the ChatGPT-subscription provider (`AI_PROVIDER=codex`); defaults to `gpt-5` |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (optional; generate the pair with `pnpm --filter @clock-compass/server exec web-push generate-vapid-keys`) |

AI and push are both optional — the app works fine with neither configured.

> **Upgrading from the React preview:** if your deployment still sets
> `WEB_DIST_PATH=/app/apps/web-react/dist` (the old way to try the React port),
> remove it, or point it at `/app/apps/web/dist`, before deploying this version.
> That folder no longer exists in the image, so the stale setting serves a 404 at
> `/` while `/api/health` stays green.

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
offline). A new deploy is picked up the next time the app is opened or
reloaded: the page reloads itself once into the new version. With VAPID keys
set, enable push per device in Settings → Notifications — overdue commitments,
the morning rock reminder, and the Sunday review arrive even with the app
closed. Push requires HTTPS (or localhost).

## Secrets

Never commit secrets. Only `.env.example` is tracked; the real `.env` is
gitignored. The AI keys and the API auth token must come from the environment.
