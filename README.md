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
| `accept_week_plan` | Make exactly these Quadrant II tasks the week's open big rocks (rocks already done stay pinned) |
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
- **Days** are plain dates, `YYYY-MM-DD`, read in the server's time zone, `TZ`
  (MCP has no browser).

The read tools are one set with the in-app assistant (#117): `list_tasks`
(filters, `counts` per quadrant, paging with `offset` and `nextOffset`),
`big_rocks_this_week`, `get_compass` (mission, roles, goals and projects),
`list_people` (`status: "OVERDUE"` for what is behind), `list_habits` and
`renewal_overview` (`includeTrends` for the last 12 weeks), each marked
read-only. They follow the same **data policy** as the assistant: a category
switched off removes its reads and fields, and its writes are refused. The
notes on a person and on bank-account entries are off unless switched on. The
REST API with an API key stays the way to read everything.

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

### MCP App: the screens inside Claude Desktop (step 1)

With `--app`, the MCP program also serves an **MCP App**: Claude Desktop can
draw Clock & Compass screens inside the chat. Step 1 has one screen,
`show_week` (this week's big rocks and the tasks scheduled on each day), and
is **read-only**: with `--app` no write tool is offered at all.

**First, set `TZ` to your zone** (for example `TZ=Europe/Brussels` in `.env`)
and restart the container. MCP has no device to ask, so the screen reads days
in the server's zone: without `TZ` (UTC), a task scheduled for Thursday 09:30
in Brussels is drawn under Wednesday. The summary Claude receives names the
zone ("days in Europe/Brussels"), so a wrong one is visible in the chat.

The program must run where the database is, so in the Docker setup it runs
inside the container. In Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "clock-compass": {
      "command": "docker",
      "args": ["exec", "-i", "clock-compass", "node", "packages/mcp/dist/index.js", "--app"]
    }
  }
}
```

(`clock-compass` is the container's name: `docker ps` shows it.) From another
computer, run the same over SSH: `"command": "ssh"`, `"args": ["home-server",
"docker", "exec", "-i", "clock-compass", "node", "packages/mcp/dist/index.js",
"--app"]`, with an SSH key. Then ask Claude "how does my week look?".

- It follows the data switches of Settings → AI: with tasks not shared, the
  week is not shown.
- The page loads nothing from the network but the app's fonts.
- **Tried so far:** the SDK's own `AppBridge` as a stand-in host (in the tests)
  and the built image (in CI). Whether
  Claude Desktop draws the page is for the owner to try; steps 2 and 3 (more
  screens, and proposals confirmed with a press in the page) wait for that.

## Configuration

Everything is configured via environment variables (see `.env.example` for the
full, commented list):

| Variable            | Purpose                                                  |
| ------------------- | -------------------------------------------------------- |
| `DATABASE_URL`      | Prisma connection string (SQLite by default; Postgres-ready) |
| `API_AUTH_TOKEN`    | Bearer token for the REST API (unset = open, the default)|
| `PORT` / `HOST`     | Where the server listens                                 |
| `TZ`                | The server's time zone (IANA name, default UTC): "today" for MCP, API calls without `X-Time-Zone`, and push notification hours. The app follows the device's zone. |
| `WEB_DIST_PATH`     | Frontend build to serve (default: `apps/web/dist`)       |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web push (optional; generate the pair with `pnpm --filter @clock-compass/server exec web-push generate-vapid-keys`) |

AI and push are both optional — the app works fine with neither configured.
AI is not configured here: see **AI settings** below.

> **Upgrading from the React preview:** if your deployment still sets
> `WEB_DIST_PATH=/app/apps/web-react/dist` (the old way to try the React port),
> remove it, or point it at `/app/apps/web/dist`, before deploying this version.
> That folder no longer exists in the image, so the stale setting serves a 404 at
> `/` while `/api/health` stays green.

### Time zone: whose "today"

"Today" and "this week" (habit check-offs, this week's intention, the weekly
review, which occurrences of a repeating task show yet) are the **device's**:
the app sends its zone on every request (`X-Time-Zone`). Where no device asks
(MCP, an API script without that header, push notifications) the server's
zone is used: set `TZ` to yours, e.g. `TZ=Europe/Brussels`. Node has the zone
data built in, so the image needs nothing else. The server refuses to start
with a zone it does not know, and logs the zone it runs in.

Habit marks and weekly intentions are stored as **plain dates** (the calendar
date at UTC midnight), so changing `TZ` later never moves them.

**Upgrading from a version before this (#112):**

- **Docker as documented (no `TZ` set before):** nothing to move. Set `TZ` and
  restart.
- **A server that ran in another zone** (outside Docker, or with `TZ` set by
  hand): its stored days are that zone's midnights. The server says so at start
  with a count. Move them once, naming the zone it ran in; first a dry run that
  prints the counts and three examples:

  ```bash
  # in the container
  docker compose exec app node apps/server/dist/days-migrate.js --from Europe/Brussels --dry-run
  docker compose exec app node apps/server/dist/days-migrate.js --from Europe/Brussels
  # or from a checkout
  pnpm --filter @clock-compass/server days:migrate --from Europe/Brussels --dry-run
  ```

  It runs in one transaction and changes nothing if any value is not a midnight
  in the zone you name. Running it again changes nothing. Days already stored as
  plain dates (a server that ran in UTC first) are left alone.

### AI settings

AI is configured in the app, in **Settings → AI**, not in the environment:

- **Providers:** Anthropic (an API key), any OpenAI-compatible endpoint (OpenAI,
  Ollama, LM Studio, vLLM, OpenRouter, LiteLLM: its address, and a key if it
  needs one), or your ChatGPT Plus/Pro subscription (**Sign in with ChatGPT**,
  no key). Several at once. **Test** makes one small call and shows the
  provider's own error. **Load models** asks the provider for its list; you
  keep the ones you want and can type names it does not list.
- **A provider and model per AI job:** the assistant, task classification,
  influence or concern, mission refinement and the weekly review, with one
  default for the rest. The ChatGPT subscription is not available for the
  assistant yet.
- **What data AI may use:** one switch per kind of data. They apply to every
  AI feature and to MCP. The notes on people and on bank-account entries are
  off unless you switch them on.

Keys are **write-only**: no response shows them (only that a key is set and,
for a long key, its last four characters), and they are never in the data
export or a log. Only the server's own `API_AUTH_TOKEN` may change AI
settings; a generated API key cannot. Local and home-network addresses and
plain `http` are allowed; the screen warns when a key would go over plain
`http` to a public address. Calls to a provider never follow a redirect.

**Upgrading from a version before #94:** the AI environment variables
(`AI_PROVIDER`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `OPENAI_BASE_URL`,
`OPENAI_API_KEY`, `OPENAI_MODEL`, `CODEX_MODEL`) are no longer read. Nothing is
copied from them: **AI is off until you add a provider in Settings → AI.** The
server names any of them that is still set, once, at start. A ChatGPT sign-in
already made stays: add a "ChatGPT subscription" provider and it is connected.

**Restoring from an export:** the export leaves out the AI settings (keys must
never be in it), so a server rebuilt from an export has none: add the
providers again in Settings → AI.

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
gitignored. The API auth token comes from the environment; AI provider keys
are entered in Settings → AI and stored in the database, never returned.
