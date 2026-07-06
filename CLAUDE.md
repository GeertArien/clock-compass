# Clock & Compass

A personal todo and productivity app organized around the principles popularized in
Stephen Covey's *The 7 Habits of Highly Effective People*. Mainly for personal use,
but published publicly on GitHub.

> Inspired by the prioritization and effectiveness principles popularized by Stephen Covey.
> This project is not affiliated with or endorsed by the Covey/FranklinCovey organizations.

---

## Concept

The app is built around two pillars from the book, plus a renewal layer that ties them together:

- **Private Victory (Habits 1–3):** your solo, independent work — proactivity, goals, prioritization.
- **Public Victory (Habits 4–6):** interdependence — kept through recurring investment in the
  relationships that matter.
- **Sharpen the Saw (Habit 7):** self-renewal across four dimensions, stitching the two pillars together.

The "big rocks" metaphor (Quadrant II — important but not urgent) is the heart of the app:
put the big rocks in first, let the smaller tasks fill in around them.

**UI organization (approved design, see `docs/design/ui-ux.md`):** three modes as tenses over one data
layer — **Compass defines** (mission, roles, goals, projects, matrix, people, renewal habits),
**Clock does** (Today + Week; the everyday home is Clock · Today), **Almanac remembers** (read-only:
streaks, trends, the season). The same item appears through each lens; completing it anywhere
completes it everywhere.

---

## Habit → Feature map

- **Habit 1 — Be Proactive:** tasks/worries can be tagged *influence* (actionable) vs *concern*
  (not in your control), nudging focus toward what you can move. AI can help classify.
- **Habit 2 — Begin with the End in Mind:** a personal mission statement plus **Goals as first-class
  entities**. A Goal is a durable outcome (not a kind of task) with its own title, description, and
  optional target date. Tasks **belong to** a Goal via an optional one-to-many link (a task has at most
  one goal; the link is nullable, since not every task serves a goal). The full hierarchy is
  mission statement → roles → goals → projects → tasks (every link optional). Goals can show their own
  progress (e.g. share of their tasks done). AI can flag tasks that connect to no goal.
- **Habit 3 — Put First Things First:** the quadrant matrix (importance × urgency) and a weekly
  "big rocks first" planning view. This is the core mechanic.
- **Habits 4/5/6 — Public Victory (recurring relationship commitments):** a list of the people who
  matter, each with recurring commitments on a cadence (e.g. monthly activity with each kid, regular
  date night with spouse, weekly call to parents). The app tracks cadence adherence and surfaces
  what's overdue.
- **Habit 7 — Sharpen the Saw:** renewal across four dimensions (physical, mental, social/emotional,
  spiritual), each a RenewalDimension entity. Recurring renewal is modeled as **Habits** (defined in
  Compass, checked off in Clock · Today, trended in the Almanac); one-off renewal is logged as
  RenewalActivity — both count toward a dimension. The social/emotional dimension relates to the
  relationship commitments; the spiritual dimension relates to the mission statement; mental relates
  to learning goals.

---

## Recurring relationship commitments (detail)

This is the concrete shape of the Public Victory side. Each commitment:

- links to one or more **people** (e.g. a specific kid, spouse, parents)
- has a **target cadence** (e.g. weekly, every 2 weeks, monthly)
- keeps a **log of occurrences** (when you actually did it)
- shows a **status**: on track / due soon / overdue
- nudges when overdue ("no date night logged in 3 weeks")

OPEN DECISIONS to confirm with the owner before finalizing the model:
1. Per-person vs per-commitment tracking (e.g. each kid has their own monthly-activity streak,
   vs one shared "kids activity" that rotates).
2. Pass/fail per period vs a streak/history view showing patterns over time.

Default assumption if unspecified: per-person tracking with a streak/history view.

---

## Data model (core entities)

Keep all DB access behind a repository/service layer (see conventions). Core entities:

- **MissionStatement** — a single personal mission document (the top of the hierarchy).
- **Role** — a role the user plays in life (Parent, Professional, Self…), with a name and an optional
  per-role mission line. Goals carry an **optional `roleId`** so they group under roles.
- **Goal** — a first-class, durable outcome. Fields: title, description, optional target date, status,
  optional `roleId`. No nesting/sub-goals.
- **Project** — a multi-step outcome between Goal and Task ("Launch the newsletter"). Optional `goalId`,
  status (active/someday/done), flat (no sub-projects). Deleting a project returns its tasks to the
  Inbox (tasks with no project) — never deletes them.
- **Task** — a discrete action. Has importance + urgency (quadrant is DERIVED from these, not stored —
  see guideline), optional due date, completion, and **optional `scheduledDay` + `scheduledTime`**
  (the Clock lens; independent of quadrant — urgency is a human judgment, not derived from dates).
  Holds an **optional `goalId`** and an **optional `projectId`** (both nullable). Links to **Tags**
  many-to-many.
- **Tag** — a first-class entity (not a loose string). Has identity so it can be renamed in one place and
  queried ("show everything tagged X"). Many-to-many with Task. This is the one intentional
  many-to-many relationship — a task genuinely has several tags.
- **Person** — someone who matters. Relationship type (kid, spouse, parent, etc.) is a simple FIELD on
  Person, NOT its own entity (see guideline — deliberate non-case).
- **RecurringCommitment** — links to a Person (or people), with a target cadence and a log of
  occurrences; derives an on-track/due-soon/overdue status.
- **EBA entry** — an emotional-bank-account ledger line per Person: deposit or withdrawal with a note;
  the balance is derived. Coexists with the commitment occurrence log (different things: occurrences
  track cadence, EBA entries track relationship quality).
- **RenewalDimension** — the four fixed Sharpen-the-Saw dimensions (physical, mental, social/emotional,
  spiritual) as a small reference entity, each able to carry its own target/description/balance for the
  dashboard.
- **Habit** — a recurring renewal practice: name, target cadence (daily or N×/week), optional
  RenewalDimension link, optional Goal link. **HabitMark** records one check-off per habit per day.
  Streaks count consecutive WEEKS the target was met; an unfinished current week never breaks a streak.
- **RenewalActivity** — a ONE-OFF Sharpen-the-Saw entry (a retreat, a long hike) pointing to a
  RenewalDimension, with date + note. Habits do NOT absorb these (owner decision): habits cover
  recurring renewal, RenewalActivity covers one-offs, and dimension aggregates count BOTH. Streaks
  remain habit-only (a one-off has no target to streak against).

Hierarchy: **MissionStatement → Role → Goal → Project → Task** (every link downward optional — loose
tasks live in the Inbox). Decisions locked in: one goal per task/project (optional), flat goals and
flat projects. Leave room to add many-to-many or sub-projects later, but do NOT build those now.

### Modeling guideline (entity vs attribute)

Promote something to its own entity when it has **identity** (you'd want to rename it in one place),
**its own attributes** (it carries data beyond a name), or **its own relationships** (other things
attach to it). Keep it as a plain attribute when it's just a value or a derived computation.

- Applied: Role, Goal, Project, Tag, Habit, and RenewalDimension are entities by this test.
- Deliberate non-cases (do NOT over-model these): a task's **quadrant** stays a derived value computed
  from importance × urgency (never stored, so it can't drift); a person's **relationship type** stays a
  field on Person.
- Cadence/recurrence logic is shared by RecurringCommitment, Habit, and any recurring tasks — model it
  once and reuse it rather than duplicating the schedule logic in multiple places.

## Tech stack

- **Frontend:** Svelte 5 + Vite + TypeScript, Tailwind CSS, and **shadcn-svelte** for components.
  Built as a static SPA (no SvelteKit server — the Fastify backend serves the built files). Mobile-first,
  responsive, installable as a PWA (add-to-homescreen, works offline). Mobile-friendliness is a hard
  requirement; Svelte's compiled, runtime-light output keeps bundles small on phones. shadcn-svelte
  components are copied into the repo (owned in-source), giving a consistent, accessible, polished
  component set to build the quadrant matrix, planning views, dashboards, and forms.
- **Backend:** Node + Fastify (TypeScript). Chosen for schema-based validation and auto-generated
  OpenAPI docs, which serve the agent-facing API directly.
- **Database:** SQLite to start, accessed via Prisma. MUST stay modular so Postgres can be swapped in
  later by changing the provider + DATABASE_URL. All DB access goes through a repository/service layer —
  never call the ORM directly from route handlers.
- **AI:** server-side calls behind a swappable `AiProvider` interface (deliberately no LLM
  framework). Three implementations: the Anthropic API (default); an OpenAI-compatible
  provider covering ChatGPT, local models (Ollama/LM Studio/vLLM), and gateways
  (OpenRouter/LiteLLM) via `AI_PROVIDER` + `OPENAI_BASE_URL`/`OPENAI_MODEL`; and a Codex
  provider that uses a ChatGPT Plus/Pro subscription via "Sign in with ChatGPT"
  (`AI_PROVIDER=codex`, hand-rolled device-code OAuth + the Codex `/responses` dialect, no
  SDK). Prompts are shared across providers. API keys come from env vars, never committed;
  Codex OAuth tokens are stored in the DB (`ProviderCredential`) and refreshed automatically.

---

## API (for other agents/services)

- The **REST API is the single source of truth** — all logic, validation, and data access live there.
- Auto-generate an **OpenAPI/Swagger** spec so agents can discover endpoints.
- **Token-based auth:** generate API keys, passed as a bearer header. Single-user model is fine.
- An **MCP server** is a THIN adapter that wraps the shared service layer as MCP tools. It must NOT
  duplicate business logic. Structure it as a **clearly separable in-repo module** — its own
  folder/package with its own optional entry point, importing the shared service layer rather than
  reaching into route handlers. It stays in this repo for now (do not split into a separate repo).
  This preserves a trivial extraction path later: if it ever needs to run independently, lift the module
  out and point it at the REST API over HTTP instead of importing the service layer — no logic rewrite.
- Endpoints should cover: task CRUD, quadrant queries ("what are my big rocks this week?"),
  goals, people + recurring commitments (and overdue queries), and a natural-language intake
  endpoint (POST a sentence → AI classifies into a quadrant → creates the task).

---

## AI integration jobs

- Classify a task into a quadrant from free text.
- Tag tasks as influence vs concern (Habit 1).
- Draft/refine the mission statement; flag tasks that connect to no goal (Habit 2).
- Weekly review summary ("3 of your 5 big rocks slipped; 2 relationship commitments are overdue").
- Natural-language task intake.

---

## Todoist import

- **Primary path: CSV import.** The user exports their tasks from Todoist (per-project CSV export, or a
  full-account backup export) and uploads the file in the frontend. No Todoist token, no OAuth, no rate
  limits, and nothing Todoist-related in the server env.
- Parse the export and map its fields (content, priority, due date, project) → Clock & Compass tasks/quadrants.
  Todoist p1–p4 priorities give a starting importance/urgency guess that the AI can refine.
- This is a frontend-initiated flow: the user picks a file; parsing can happen client-side or via a
  dedicated import endpoint that accepts the uploaded file. Either way, no Todoist credentials are stored.
- **Optional later enhancement:** a live Todoist API sync for repeatable re-imports. If added, the user
  supplies their own token at runtime through the UI — it is NOT a server-side env secret.

---

## Deployment (Docker)

- Multi-stage Dockerfile: build the frontend, then serve it as static files from the Fastify backend
  (single container).
- `docker-compose.yml` for the app (plus an optional Postgres service for later). Use named volumes for
  persistence — for SQLite, persist the DB file on a mapped volume so it survives container restarts.
- All config via env vars: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `API_AUTH_TOKEN`.
- Document the standard Docker setup in the README: building the image, the compose stack, exposed port,
  and volume mapping for DB persistence. Keep it host-agnostic — standard Docker / docker-compose only.

---

## Repo hygiene & conventions (public repo)

- `.env.example` documenting all env vars; the real `.env` is gitignored.
- **Never commit secrets** — the Anthropic API key and the API auth token. Todoist data comes from a
  user-uploaded export, so there are no Todoist credentials on the server.
- README with the Covey-inspired disclaimer (above), setup instructions, and a link to the API docs.
- All DB access goes through the repository/service layer — never call the ORM directly from route
  handlers (this is what keeps SQLite→Postgres and the MCP adapter clean).
- Include tests for the service layer and API; changes should not merge with failing tests.

---

## Build order (COMPLETE)

The original scaffold steps and the full design rollout (`docs/design/ui-ux.md`) are done — every
step shipped as its own PR with its issue closed:

1. ✅ Field Notes theme + three-mode shell (Compass / Clock / Almanac), Clock · Today landing.
2. ✅ Compass: Role + Project entities, Projects view with Inbox (issue #25).
3. ✅ Clock: task scheduling fields (`scheduledDay`/`scheduledTime`), Week agenda + rocks tray (issue #26).
4. ✅ People: recurring commitments with cadence tracking + EBA ledger (Habits 4–6, issue #5).
5. ✅ Habits + renewal across the three modes (Habit 7, issue #6) — Habit/HabitMark coexist with
   one-off RenewalActivity; weekly intentions kept per ISO week.
6. ✅ REST API hardening + OpenAPI + token auth (ApiKey, hash only); the MCP adapter
   (`packages/mcp`); Settings → agent access UI (issue #7).
7. ✅ AI integration jobs (issue #8) — Anthropic + OpenAI-compatible providers behind `AiProvider`.
8. ✅ Todoist CSV import (upload export → map → tasks/projects) (issue #9).
9. ✅ PWA + web push notifications (issue #10) — real-device QA happens on the owner's deployment.

New work starts from a fresh proposal against this file's principles (schema changes still need
owner approval first).

---

## Working agreement (how to collaborate on this repo)

- Tackle one build-order step at a time. Work each step on its own branch and open a PR; don't bundle
  unrelated steps into one change.
- After pushing a branch, open a pull request automatically — no need to ask first.
- After opening a PR, automatically watch it (subscribe to its CI/review activity) and
  address failures/comments — no need to ask each time.
- For any change that touches the database schema or a core data model, propose it and wait for approval
  before writing code.
- Don't merge with failing tests or a broken build.
- Never commit secrets; confirm `.env` is gitignored and only `.env.example` is tracked.
- When starting fresh work, re-read this file first and propose a plan before coding.

(These are defaults. To override for a specific task — e.g. a tiny fix committed directly — say so in
that prompt.)
