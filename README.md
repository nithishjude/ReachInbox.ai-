# ReachInbox: Full-Stack Email Job Scheduler

A production-style **email scheduling engine and dashboard**, built as the ReachInbox.ai (Outbox Labs) Software Development Intern assignment.

Users sign in with Google, upload a CSV of leads, write one personalized email, and choose when sending starts. The backend stores every email in **PostgreSQL** and schedules each one as a **BullMQ delayed job on Redis**; there is **no cron anywhere**. It then sends the emails through **Ethereal SMTP** at a controlled pace:
- a minimum gap between sends
- per-sender and per-campaign **hourly limits**, enforced in Redis
- correct behaviour across **restarts** and **multiple workers**
- **no email is ever sent twice**

| Login | Scheduled | Compose (with personalization) |
|---|---|---|
| ![Login](docs/screenshots/login.png) | ![Scheduled](docs/screenshots/scheduled.png) | ![Compose](docs/screenshots/compose.png) |
| **Campaign progress** | **Campaign detail (throttled by the hourly limit)** | **Send Later** |
| ![Campaigns](docs/screenshots/campaigns.png) | ![Campaign detail](docs/screenshots/campaign-detail.png) | ![Send later](docs/screenshots/send-later.png) |

---

## Table of contents

1. [Highlights](#1-highlights)
2. [Tech stack](#2-tech-stack)
3. [Architecture](#3-architecture)
   - [System overview](#31-system-overview)
   - [Lifecycle of a scheduled email](#32-lifecycle-of-a-scheduled-email)
   - [Email state machine](#33-email-state-machine)
   - [Data model](#34-data-model)
   - [Scheduling without cron](#35-scheduling-without-cron)
   - [Persistence across restarts](#36-persistence-across-restarts)
   - [Idempotency (never send twice)](#37-idempotency-never-send-twice)
   - [Rate limiting, delay and concurrency](#38-rate-limiting-delay-and-concurrency)
   - [Behaviour under load](#39-behaviour-under-load-1000-emails-at-once)
   - [Personalization](#310-personalization)
   - [Campaign progress](#311-campaign-progress)
   - [Frontend architecture](#312-frontend-architecture)
   - [Security](#313-security)
4. [Project structure](#4-project-structure)
5. [Getting started](#5-getting-started)
6. [Configuration](#6-configuration)
7. [API reference](#7-api-reference)
8. [Testing, proofs and CI](#8-testing-proofs-and-ci)
9. [Requirements checklist](#9-requirements-checklist)
10. [Assumptions and trade-offs](#10-assumptions-and-trade-offs)
11. [What I'd do next in production](#11-what-id-do-next-in-production)
12. [Demo script](#12-demo-script)

---

## 1. Highlights

- **Durable scheduling with BullMQ delayed jobs.** One job per email, keyed by the email's database id, so the same email can't be queued twice.
- **Survives restarts.** Redis persists jobs to disk (AOF) and Postgres is the source of truth. A safety-net reconcile rebuilds the queue if Redis data is lost, without ever creating duplicates.
- **Never sends twice.** There are three layers of protection: deterministic job ids, a status check, and an atomic `UPDATE … WHERE status IN (…)` claim. A crash mid-send is handled at-most-once.
- **Rate limiting that's correct across many workers.** One atomic **Redis Lua script** reserves send slots, enforcing a minimum gap per sender, a per-sender hourly cap and a per-campaign hourly cap. Over-limit emails are **rescheduled into the next hour, in order, never dropped**.
- **Proven, not just claimed:**
  - **24 automated tests** against real Postgres and Redis
  - a **multi-worker proof script** (4 processes, exactly the limit sent, 0 duplicates)
  - a **1000-email load test**: persisted and queued in about 200 ms
- **Personalization:** `{{first_name}}`, `{{company}}` and any other CSV column, with fallbacks (`{{first_name|there}}`) and a live per-recipient preview.
- **Campaign progress:** live progress bars, throttle status and "resumes at…" information.
- **A UI built to the provided Figma:** Google login, inbox-style Scheduled/Sent lists, a full-page compose with a rich-text editor, and a Send Later popover.
- **Production-minded tooling:**
  - a Docker setup that runs everything with one command (API + 2 worker replicas + nginx)
  - GitHub Actions CI
  - an admin-only BullMQ dashboard
  - graceful shutdown

---

## 2. Tech stack

| Layer | Technology | Why |
|---|---|---|
| API | **Express 4 + TypeScript**, zod validation | Required stack; zod gives runtime-validated, typed inputs and config |
| Queue | **BullMQ 5** on **Redis 7** (AOF persistence) | Durable delayed jobs, retries with backoff, stalled-job recovery, no cron |
| Database | **PostgreSQL 16** via `pg` (plain SQL) | Source of truth; SQL kept in a small repository layer, no ORM magic |
| Rate limiting | **Redis Lua script** | Atomic check-and-reserve shared by every worker |
| Email | **Nodemailer** → **Ethereal** (fake SMTP) | Real SMTP flow without emailing real people; optional real SMTP senders |
| Auth | **Google OAuth 2.0** (code flow) + JWT in an httpOnly cookie | Real login, as required |
| Frontend | **React 18 + Vite + TypeScript + Tailwind CSS** | Fast dev loop, typed props and API, utility CSS to match the Figma |
| UI libs | lucide-react (icons), DOMPurify (HTML sanitising) | Small, focused dependencies |
| Monitoring | **Bull Board** at `/admin/queues` | Live view of delayed, waiting, active, completed and failed jobs |
| Tooling | Vitest, Docker, nginx, GitHub Actions | Tests, one-command deployment, CI |

---

## 3. Architecture

### 3.1 System overview

<p align="center"><img src="docs/architecture/1-system-overview.png" alt="System overview" width="100%"></p>

<sub>Diagram source: [`docs/architecture/1-system-overview.mmd`](docs/architecture/1-system-overview.mmd) (Mermaid)</sub>

The **API** and the **worker** are separate entry points that share code (`server.ts`, `workerMain.ts`, or both together in `index.ts` for local runs). Any number of workers can run on any number of machines: every shared decision is made atomically in Redis or Postgres, never in process memory.

### 3.2 Lifecycle of a scheduled email

<p align="center"><img src="docs/architecture/2-email-lifecycle.png" alt="Lifecycle of a scheduled email" width="100%"></p>

<sub>Diagram source: [`docs/architecture/2-email-lifecycle.mmd`](docs/architecture/2-email-lifecycle.mmd) (Mermaid)</sub>

### 3.3 Email state machine

<p align="center"><img src="docs/architecture/3-email-states.png" alt="Email state machine" width="760"></p>

<sub>Diagram source: [`docs/architecture/3-email-states.mmd`](docs/architecture/3-email-states.mmd) (Mermaid)</sub>

`scheduled`, `rate_limited` and `sending` appear on the **Scheduled** tab; `sent` and `failed` appear on the **Sent** tab.

### 3.4 Data model

<p align="center"><img src="docs/architecture/4-data-model.png" alt="Data model" width="520"></p>

<sub>Diagram source: [`docs/architecture/4-data-model.mmd`](docs/architecture/4-data-model.mmd) (Mermaid)</sub>

The schema lives in `backend/src/db/schema.sql`. It's applied **idempotently on every boot** under a Postgres advisory lock, so the API and workers can start together safely, and nobody has to run migrations by hand.

**Redis keys:**

| Key | Purpose | TTL |
|---|---|---|
| `bull:email-send:*` | BullMQ queue (delayed set, job hashes, …) | Kept; completed jobs trimmed after 24 h, failed after 7 d |
| `rl:sender:<senderId>:<hourWindow>` | Emails sent by a sender in a clock hour | 3 h |
| `rl:campaign:<campaignId>:<hourWindow>` | Emails sent by a campaign in a clock hour | 3 h |
| `gap:sender:<senderId>` | Next free send slot for a sender (minimum gap) | gap + 60 s |
| `lock:reconcile` | Only one instance reconciles at boot | 60 s |

### 3.5 Scheduling without cron

1. Each recipient becomes **one row** in `emails`, planned at `startAt + i × delayBetweenEmails`.
2. Each row gets **one BullMQ delayed job** with `delay = plannedTime − now`. BullMQ keeps it in a Redis sorted set and promotes it when it's due. There's no `node-cron`, no `agenda`, no OS crontab and no polling loop.
3. The **job id is the row id** (`email-<uuid>`). BullMQ ignores an `add` whose id already exists, so the same email can't be queued twice.
4. Rows are inserted with a single multi-row `INSERT … SELECT FROM UNNEST(...)`, and jobs are added with `addBulk` in chunks of 500. **1000 emails are persisted and queued in about 200 ms**, so the API never blocks on sending; the worker does the pacing.

### 3.6 Persistence across restarts

| Mechanism | What it guarantees |
|---|---|
| **Redis AOF** (`appendonly yes`, fsync every second) and `maxmemory-policy noeviction` | Delayed jobs survive a Redis restart and are never evicted |
| **Postgres is the source of truth** | Every email's status, planned time and result is durable; the queue only knows *when to wake up* |
| **BullMQ resumes on boot** | After an API or worker restart, the delayed jobs already in Redis keep firing at their **original times**. Nothing restarts from scratch, and emails that came due during downtime go out as soon as a worker is back |
| **Boot reconcile** (`queue/reconcile.ts`) | Re-adds every `scheduled`/`rate_limited` row with its deterministic job id. Normally a no-op (the jobs exist, so `add` is ignored), but if Redis lost data it rebuilds the queue from Postgres. It can't duplicate jobs and is guarded by a Redis lock |
| **Graceful shutdown** (SIGINT/SIGTERM) | The HTTP server stops accepting requests and `worker.close()` waits for in-flight SMTP sends to finish, so a normal restart never interrupts a send |
| **Stalled-job recovery** | If a worker is killed hard, its job lock expires and BullMQ hands the job to another worker; the idempotency guard makes that safe |

This was tested manually: emails were scheduled, the server was **hard-killed**, and it was restarted after the first send time had passed. The overdue email went out immediately, the future ones went out at their scheduled times, and each was sent exactly once.

### 3.7 Idempotency (never send twice)

| # | Layer | How |
|---|---|---|
| 1 | Enqueue | Deterministic `jobId = email-<uuid>`: one job per email, ever |
| 2 | Status check | The worker loads the row first and skips `sent`/`failed` (a re-delivered job does nothing) |
| 3 | Atomic claim | `UPDATE emails SET status='sending' WHERE id=$1 AND status IN ('scheduled','rate_limited') RETURNING *`. If two workers race, exactly one gets the row (tested with 20 concurrent claims) |
| 4 | Crash mid-send | A row stuck in `sending` for more than 2 minutes belongs to a dead worker. Nobody can know whether SMTP accepted it, so it's marked **failed** rather than resent (*at-most-once*, because "never send twice" is a hard requirement). The user can retry it manually |
| 5 | Retry safety | Transient errors (network, 4xx) happen *before* SMTP accepts the message, so the row goes back to `scheduled` and BullMQ retries with exponential backoff (5 attempts, 30 s → 4 min). 5xx errors fail permanently |
| 6 | Traceability | Every message carries a deterministic `Message-ID: <email-uuid@…>`, and every sent row records `processed_by = host:pid` |

### 3.8 Rate limiting, delay and concurrency

| Control | Configured by | Default | Enforced by |
|---|---|---|---|
| Worker concurrency | `WORKER_CONCURRENCY` | **5** per process | BullMQ `Worker({ concurrency })` |
| Minimum gap between sends | `MIN_DELAY_BETWEEN_SENDS_MS` | **2 s per sender** | Redis `gap:sender:<id>` (slot reservation) |
| Delay between emails of a campaign | Compose → *Delay between 2 emails* | 0 s | Rows planned `i × delay` apart |
| Hourly cap per sender | `MAX_EMAILS_PER_HOUR_PER_SENDER` | **200** | Redis counter per sender per clock hour |
| Hourly cap per campaign | Compose → *Hourly Limit* | sender cap | Redis counter per campaign per clock hour |

Every decision comes from **one atomic Lua script** (`rateLimiter/hourlyLimiter.ts`), so it is correct with any number of worker processes:

<p align="center"><img src="docs/architecture/5-rate-limiter.png" alt="Rate limiter decision flow" width="460"></p>

<sub>Diagram source: [`docs/architecture/5-rate-limiter.mmd`](docs/architecture/5-rate-limiter.mmd) (Mermaid)</sub>

Key properties:
- **Redis `TIME`** gives every worker the same clock, so there are no clock-skew disagreements about which hour it is.
- **Future slots are reserved, not polled.** Jobs competing for the same sender get spaced out deterministically in arrival order. There's no retry storm, and worker concurrency slots stay free while jobs wait.
- **Over-limit jobs are moved, not failed.** BullMQ's `DelayedError` makes this a reschedule rather than a failed attempt, and the `seq × 25 ms` offset keeps the campaign's original order when the next window opens.

### 3.9 Behaviour under load (1000+ emails at once)

Measured with `npm run load-test -- <email> 1000 50`, which schedules 1000 emails for "now" with a limit of 50 per hour:

- **1000 emails persisted and queued in about 200 ms.**
- The worker immediately reserved **50 slots, 2 s apart**. The other **950 moved to the next hour window, in recipient order**.
- At the next hour, the next 50 get slots and the rest move again, and so on.
- Throughput is bounded by `min(sender cap, campaign cap)` per hour and by `3600 s / gap` (1800/h at 2 s). Adding workers adds parallelism but can never exceed the limits, as the next section proves.
- A throttled job costs one cheap Lua call per window hop. Nothing busy-waits.

**Multi-worker proof:** `npm run proof:workers -- <email> 60 20 3` starts **3 separate worker processes** against a burst of 60 emails with a 20/hour limit. The API's own worker joins as a 4th instance:

```
Sent:          20  (limit 20)
  by Jude:27060: 5
  by Jude:29664: 5
  by Jude:31268: 5
  by Jude:8152: 5
Rate limited:  40  (rescheduled to the next hour window)
Duplicates:    0
PASS  exactly 20 sent across all workers
PASS  work was shared by more than one worker process
PASS  remaining 40 rescheduled, none dropped or failed
PASS  rescheduled into the next hour window
PASS  no email sent twice
```

### 3.10 Personalization

- **Columns become variables.** Upload a CSV with a header row, e.g. `name,email,company`, and every column becomes a variable: `{{name}}`, `{{company}}`, `{{email}}`, plus `{{first_name}}` derived from `name`. Headers are normalised (`First Name` → `first_name`).
- **Fallbacks:** `{{first_name|there}}` uses the fallback when the value is empty or missing.
- **Rendered once, at schedule time.** `createCampaign` renders the subject and body **per recipient** and stores them on each email row. The campaign keeps the original template, and each row keeps its `variables` (JSONB). Lists, search, the email view and the worker therefore all see the exact final text.
- **Safe.** Values inserted into HTML bodies are escaped, so lead data can't inject markup, and HTML shown in the dashboard is sanitised with DOMPurify.
- **Compose helpers.** Variable chips insert at the caret, a warning flags variables that aren't columns, and a **live preview** shows the exact subject and body for any recipient.
- **Robust CSV parsing:** quoted cells, `""` escapes, comma/semicolon/tab delimiters, duplicate and invalid rows reported, and files without a header row fall back to scanning for addresses.

### 3.11 Campaign progress

Every **Schedule** click creates a campaign. `GET /api/campaigns` computes its progress in one aggregate query:
- counts per status
- emails sent in the current clock hour
- the first and last send
- the next pending send
- when throttled emails resume

The **Campaigns** tab shows each campaign with:
- a stacked progress bar (sent · failed · sending · rate-limited · scheduled)
- a state: *Scheduled, Sending, Throttled, Completed, Completed with errors*
- a plain-English next step, e.g. *"Hourly limit reached (2/2 this hour). Resumes Fri 8:30 PM (in 55m)"*

The detail page adds sender, limit usage, delay and timing stats, plus every recipient in send order.

### 3.12 Frontend architecture

<p align="center"><img src="docs/architecture/6-frontend.png" alt="Frontend architecture" width="100%"></p>

<sub>Diagram source: [`docs/architecture/6-frontend.mmd`](docs/architecture/6-frontend.mmd) (Mermaid)</sub>

- **Typed end to end.** `types/email.ts` mirrors the API responses, and `lib/api.ts` is the only place that calls `fetch`.
- **Data freshness.** Lists poll every 5 s, so emails visibly move from Scheduled to Sent. Out-of-order responses are discarded, and background refreshes keep rows visible (no flicker).
- **UX states.** There are loading skeletons, empty states, error states with retry, toasts, debounced search, a status filter, pagination, and keyboard support (Enter opens rows, Esc closes menus).
- **Reusable components.**
  - `components/ui`: Button, Avatar, StatusBadge, EmptyState, Spinner
  - `components/compose`: RecipientInput, RichTextEditor, PersonalizePanel, SendLaterPopover
  - `components/campaigns`: CampaignList, CampaignProgressBar
  - plus EmailList, FilterMenu, PageHeader, Sidebar, UserMenu
- **Design tokens.** Colours are CSS variables (`index.css` + `tailwind.config.js`) set to the Figma palette, with an optional dark mode in the user menu.

### 3.13 Security

- **Google sign-in:** OAuth 2.0 authorization-code flow with a CSRF `state` cookie, and the ID token is verified server-side.
- **Sessions:** a JWT in an **httpOnly, SameSite=Lax** cookie, or `Authorization: Bearer` for Postman.
- **Data isolation:** every query is scoped to the logged-in user (`WHERE user_id = $1`).
- **Admin-only queue dashboard:** Bull Board is limited to `ADMIN_EMAILS`; everyone else gets 403.
- **Input validation:** zod validates all input. Recipient lists are capped at 10k and bodies at 50 kB, and lead data is HTML-escaped in emails.
- **Secrets** live only in `backend/.env` (git-ignored). `.env.example` documents every variable.

---

## 4. Project structure

```
.
├── backend/                         Express API + BullMQ worker (TypeScript)
│   ├── src/
│   │   ├── api/                     HTTP layer only
│   │   │   ├── auth.routes.ts         Google OAuth, /me, logout
│   │   │   ├── schedule.routes.ts     schedule, list, stats, retry, delete, senders
│   │   │   ├── campaigns.routes.ts    campaign progress
│   │   │   └── asyncHandler.ts
│   │   ├── auth/session.ts          JWT cookie/Bearer auth, requireAuth, requireAdmin
│   │   ├── config/env.ts            zod-validated configuration (all limits from env)
│   │   ├── db/
│   │   │   ├── schema.sql             tables, enum, indexes (applied on boot)
│   │   │   ├── migrate.ts             advisory-locked, idempotent migration
│   │   │   ├── client.ts              pg pool + transaction helper
│   │   │   ├── emails.repo.ts         all email SQL (create, claim, mark, list, retry, delete)
│   │   │   └── campaigns.repo.ts      campaign progress aggregates
│   │   ├── lib/
│   │   │   ├── redis.ts               ioredis connections
│   │   │   └── template.ts            {{variable}} rendering
│   │   ├── mail/
│   │   │   ├── senders.ts             Ethereal accounts, optional real SMTP, pooled transports
│   │   │   └── sendEmail.ts           HTML + text, deterministic Message-ID
│   │   ├── queue/
│   │   │   ├── queue.ts               BullMQ producer (deterministic job ids)
│   │   │   ├── worker.ts              consumer: idempotency, rate limit, send, retries
│   │   │   └── reconcile.ts           boot-time safety net
│   │   ├── rateLimiter/hourlyLimiter.ts   atomic Redis Lua slot reservation
│   │   ├── app.ts                   Express app, Bull Board, error handling
│   │   ├── bootstrap.ts             migrate, senders, reconcile, graceful shutdown
│   │   ├── index.ts                 API + worker (local dev)
│   │   ├── server.ts                API only
│   │   └── workerMain.ts            worker only (scale horizontally)
│   ├── tests/                       Vitest integration tests (real Postgres + Redis)
│   ├── scripts/
│   │   ├── loadTest.ts              1000+ emails at once
│   │   └── multiWorkerProof.ts      N worker processes, limit + no-duplicates checks
│   ├── Dockerfile
│   └── .env.example
├── frontend/                        React 18 + Vite + TypeScript + Tailwind
│   ├── src/
│   │   ├── pages/                   Login, Dashboard, Compose, Email, Campaign
│   │   ├── components/              Sidebar, UserMenu, EmailList, FilterMenu, PageHeader, Logo
│   │   │   ├── compose/             RecipientInput, RichTextEditor, PersonalizePanel, SendLaterPopover
│   │   │   ├── campaigns/           CampaignList, CampaignProgressBar, campaignState
│   │   │   └── ui/                  Button, Avatar, StatusBadge, EmptyState, Spinner
│   │   ├── hooks/                   useAuth, useEmails, usePolling, useToast, useTheme, useStarred, useDebounced
│   │   ├── lib/                     api.ts (typed client), parseLeads.ts, template.ts, html.ts, format.ts
│   │   └── types/email.ts           API types
│   ├── Dockerfile + nginx.conf      static build served by nginx, /api proxied
│   └── vite.config.ts               dev proxy for /api and /admin
├── docs/
│   ├── architecture/                architecture diagrams (PNG + Mermaid source)
│   └── screenshots/                 app screenshots
├── .github/workflows/ci.yml         typecheck, tests, builds, Docker images
├── docker-compose.yml               Postgres + Redis (+ full app with --profile app)
└── sample-leads.csv                 demo leads (name, email, company)
```

---

## 5. Getting started

### Prerequisites
- **Node.js 20+** and **Docker** (for Postgres and Redis; a local install works too, just set `DATABASE_URL` and `REDIS_URL`)
- A **Google OAuth client** (see [Configuration](#6-configuration))

### Option A: local development (recommended)

```bash
# 1. Infrastructure
docker compose up -d                       # Postgres :5432, Redis :6379 (AOF on)

# 2. Backend
cd backend
cp .env.example .env                       # set JWT_SECRET, GOOGLE_CLIENT_ID/SECRET, ADMIN_EMAILS
npm install
npm run dev                                # API on :4000 + worker in the same process

# 3. Frontend (second terminal)
cd frontend
npm install
npm run dev                                # http://localhost:5173
```

Open **http://localhost:5173**, choose **Login with Google**, and you're on the dashboard. The database schema and the Ethereal sender accounts are created automatically on first boot.

### Option B: everything in Docker (one command)

```bash
docker compose --profile app up --build    # http://localhost:8080
```

This starts Postgres, Redis, the **API**, **2 worker replicas** and **nginx** serving the built frontend, with `/api` and `/admin` proxied to the API. Secrets are read from `backend/.env`. Add `http://localhost:8080/api/auth/google/callback` as an additional authorized redirect URI in Google Cloud.

### Run modes and scripts (backend)

| Command | What it does |
|---|---|
| `npm run dev` / `npm start` | API **and** worker in one process |
| `npm run dev:api` / `npm run start:api` | API only |
| `npm run dev:worker` / `npm run start:worker` | Worker only; start several to scale out (limits stay global) |
| `npm run build` | Compile to `dist/` |
| `npm test` | Integration tests (uses the `reachinbox_test` DB and Redis DB 15, never your data) |
| `npm run load-test -- <login-email> 1000 50` | Schedule 1000 emails now with a 50/hour limit |
| `npm run proof:workers -- <login-email> 60 20 3` | Multi-worker proof (see §3.9) |

---

## 6. Configuration

### Google OAuth
1. Google Cloud Console → **APIs & Services → Credentials → Create OAuth client ID** → *Web application*.
2. **Authorized redirect URI:** `http://localhost:4000/api/auth/google/callback` (it must match `GOOGLE_REDIRECT_URI`).
3. On the OAuth consent screen choose **External** and add your Google account under **Test users**.
4. Put the Client ID and Secret into `backend/.env`.

### Ethereal Email (fake SMTP)
Nothing to do. On first boot the backend creates `ETHEREAL_SENDER_COUNT` (default 3) Ethereal accounts and **stores them in the `senders` table**, so restarts reuse them. Every sent email stores its Ethereal **preview URL**; open it from the email page (*View delivered message*). To pin your own accounts, create them at https://ethereal.email/create and set `ETHEREAL_SENDERS`.

### Optional: real delivery (e.g. Gmail)
Ethereal never delivers to real inboxes, by design. As an extra, `SMTP_SENDERS` adds senders that do, using the same engine (only the SMTP endpoint changes):
1. Enable 2-Step Verification on the Google account and create an **App Password** at https://myaccount.google.com/apppasswords.
2. In `backend/.env`: `SMTP_SENDERS='[{"name":"Your Name","user":"you@gmail.com","pass":"abcd efgh ijkl mnop"}]'`
3. Restart the backend. The sender appears in **From** as *(real delivery)*, and Compose shows a warning when it's selected.

### Environment variables (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | API port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin and post-login redirect |
| `JWT_SECRET` | required | Signs session tokens (16+ chars) |
| `DATABASE_URL` | `postgres://reachinbox:reachinbox@localhost:5432/reachinbox` | Postgres |
| `REDIS_URL` | `redis://localhost:6379` | Redis (queue and rate limiter) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | required | Google OAuth client |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` | OAuth callback |
| `ADMIN_EMAILS` | none | Comma-separated accounts allowed into `/admin/queues` |
| `ETHEREAL_SENDER_COUNT` | `3` | Ethereal accounts to auto-create |
| `ETHEREAL_SENDERS` | none | Pin specific Ethereal accounts (JSON) |
| `SMTP_SENDERS` | none | Optional real-delivery senders (JSON) |
| `WORKER_CONCURRENCY` | `5` | Parallel jobs per worker process |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | **Minimum gap between two sends from the same sender (2 s)** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | **Hourly cap per sender** |
| `SEND_MAX_ATTEMPTS` | `5` | Attempts for transient SMTP errors (exponential backoff 30 s → 4 min) |
| `RUN_WORKER_IN_API` | `true` | Run the worker inside `npm run dev` / `npm start` |

The frontend needs no configuration. Vite proxies `/api` and `/admin` to `http://localhost:4000` (override with `VITE_API_PROXY`).

---

## 7. API reference

All `/api/emails`, `/api/campaigns` and `/api/senders` routes require a session: the `ri_session` cookie from Google login, or `Authorization: Bearer <JWT>` for Postman.

| Method & path | Description |
|---|---|
| `GET /api/auth/google` | Start Google OAuth (redirect) |
| `GET /api/auth/google/callback` | OAuth callback: verify the ID token, upsert the user, set the cookie, redirect to the dashboard |
| `GET /api/auth/me` | Current user `{ id, name, email, avatarUrl, isAdmin }` |
| `POST /api/auth/logout` | Clear the session |
| `POST /api/emails/schedule` | Create a campaign and enqueue one delayed job per recipient |
| `GET /api/emails/scheduled?search=&status=&page=&pageSize=` | `scheduled` / `rate_limited` / `sending`, soonest first |
| `GET /api/emails/sent?search=&status=&page=&pageSize=` | `sent` / `failed`, newest first |
| `GET /api/emails/stats` | Counts per status, sent in the last hour, number of campaigns |
| `GET /api/emails/:id` | One email (status, error, Ethereal preview URL) |
| `DELETE /api/emails/:id` | Cancel a scheduled email or delete one from history (refused while mid-send) |
| `POST /api/emails/retry` | Re-queue failed emails: `{ "ids": [...] }` or `{ "all": true }` (only `failed` rows match) |
| `GET /api/campaigns?search=&page=` | Campaigns with live progress |
| `GET /api/campaigns/:id` | One campaign's progress + recipients in send order |
| `GET /api/senders` | Senders, current hourly usage, server limits |
| `GET /admin/queues` | Bull Board (admins only) |
| `GET /health` | Postgres + Redis health |

**Schedule request:**

```jsonc
POST /api/emails/schedule
{
  "senderId": "uuid",                               // optional, defaults to the first sender
  "subject": "Quick idea for {{company}}",          // {{variables}}, fallback: {{first_name|there}}
  "body": "<p>Hi {{first_name|there}},</p>",        // HTML from the editor, or plain text
  "recipients": [                                   // validated and de-duplicated server-side (max 10,000)
    "plain@example.com",
    { "email": "ava@acme.com", "fields": { "Name": "Ava Thompson", "Company": "Acme" } }
  ],
  "startAt": "2026-10-24T04:30:00.000Z",            // optional; missing or past = now
  "delayBetweenEmailsSec": 5,                       // spacing inside this campaign
  "hourlyLimit": 3                                  // this campaign's hourly cap
}

→ 201 { "campaignId", "scheduled": 2, "duplicatesRemoved": 0, "invalid": [], "sender": {...},
        "firstSendAt", "lastSendAt" }
```

---

## 8. Testing, proofs and CI

| Suite | Count | What it covers |
|---|---|---|
| `backend/tests/rateLimiter.test.ts` | 3 | Exactly N reserved out of **50 concurrent** callers; over-limit goes to the next window; per-sender cap across campaigns; minimum gap spacing in order |
| `backend/tests/idempotency.test.ts` | 2 | **20 concurrent claims → exactly one wins**; a sent email is never re-claimed |
| `backend/tests/worker.test.ts` | 4 | End-to-end send and `processed_by`; re-delivered job doesn't resend; over-limit emails rescheduled to the next hour **in order** (not failed); cancelled emails skipped |
| `backend/tests/personalization.test.ts` | 5 | Header normalisation, variables + fallbacks, HTML escaping, per-recipient rendering in the DB, campaign progress counts |
| `frontend/src/lib/*.test.ts` | 10 | CSV parsing (quotes, semicolons, duplicates, invalid rows, header columns), template helpers |

```bash
cd backend && npm test        # needs docker compose up -d (uses its own test DB)
cd frontend && npm test
```

**Other proofs:**
- the restart scenario (manual, see §3.6)
- `npm run load-test`: 1000 emails
- `npm run proof:workers`: multiple worker processes

**CI** (`.github/workflows/ci.yml`) runs on every push:
- **backend:** typecheck, tests against Postgres and Redis service containers, then build
- **frontend:** tests, then build
- **Docker:** both images are built

---

## 9. Requirements checklist

### Backend
| Requirement | Where |
|---|---|
| TypeScript, Express, BullMQ + Redis, PostgreSQL, Ethereal | §2 |
| Accept scheduling requests via API and store them in the DB | `POST /api/emails/schedule`, `emails.repo.ts` |
| BullMQ delayed jobs, **no cron** | §3.5, `queue/queue.ts` |
| Multiple senders via Ethereal | `mail/senders.ts` (3 auto-created, pooled transports) |
| Restart persistence: on time, no duplicates, nothing restarts from scratch | §3.6, tested by hard-killing the server |
| Configurable worker concurrency, safe in parallel | `WORKER_CONCURRENCY`, atomic claim + Lua, §3.8 |
| Minimum delay between sends (documented: **2 s per sender**) | §3.8 |
| Hourly limit from env, Redis-backed, safe across workers | `MAX_EMAILS_PER_HOUR_PER_SENDER`, §3.8, multi-worker proof |
| On limit hit: reschedule into the next hour, never drop | §3.8, worker tests |
| 1000+ emails behaviour defined | §3.9, load test |
| Idempotency (never twice) | §3.7, idempotency tests |

### Frontend
| Requirement | Where |
|---|---|
| Real Google OAuth, redirect to the dashboard | `LoginPage`, `auth.routes.ts` |
| Name, email, avatar and logout | `UserMenu` (sidebar user card) |
| Dashboard with Scheduled/Sent tabs and Compose button, following the Figma | `DashboardPage`, `Sidebar` |
| Compose: subject, body, CSV upload with detected count, start time, delay, hourly limit, schedule | `ComposePage`, `RecipientInput`, `SendLaterPopover` |
| Scheduled list: email, subject, scheduled time, status, loading and empty states | `EmailList` (Scheduled tab) |
| Sent list: email, subject, sent time, sent/failed, loading and empty states | `EmailList` (Sent tab) |
| Clean structure, reusable components, typed API and props, error toasts | §3.12 |

### Beyond the brief
Personalization · campaign progress · retry failed · cancel/delete · rich-text editor · Send Later presets · status filter and search · admin-only Bull Board · optional real SMTP · dark mode · 24 tests · CI · full Docker setup · multi-worker proof · load test.

---

## 10. Assumptions and trade-offs

**At-most-once on a crash mid-send.** If a worker dies between claiming an email and recording the result, the email is marked failed rather than resent, because "never send twice" outranks "always send". The window is a single SMTP call, graceful shutdowns never hit it, and the user can retry.

**Fixed clock-hour windows instead of a sliding 60-minute window.** They're exact, cheap and easy to reason about. The trade-off is that up to 2× the limit can go out across an hour boundary (the end of one hour plus the start of the next).

**A rate-limit slot is consumed when it's reserved.** If that send then fails, the slot isn't refunded, so the limiter errs on the side of sending fewer.

**Personalization is rendered at schedule time.** Each email row stores its final text, so later edits to the template don't affect queued emails. That's a deliberate, predictable choice.

**Single-node Redis.** The Lua script builds keys from arguments. Redis Cluster would need hash-tagged keys passed through `KEYS`.

**Stateless JWT sessions (7 days).** Logout clears the cookie, but tokens aren't revocable server-side.

**Polling every 5 s.** Simple and robust at this scale; Server-Sent Events or WebSockets would be the next step.

**Differences from the Figma:**
- The pixel logo reads *ReachInbox* instead of the placeholder *ONB*.
- The email/password form is shown but disabled, since the brief requires Google login only.
- There's no archive icon.
- Rows show addresses, because CSV leads may not have names.
- These were added because the brief or features require them: the sent time, the detected-count line, the retry banner, the Personalize panel and the Campaigns tab.

**Small UI details:**
- Stars are a per-browser preference (localStorage).
- The rich-text editor uses `contentEditable` + `execCommand`. That API is deprecated but universally supported, and it avoids a heavy editor dependency.

---

## 11. What I'd do next in production

- **Encrypt SMTP credentials at rest** (AES with a key from a secret manager).
- **Alerting:** notify operators when emails fail mid-send or the failure rate spikes.
- **Observability:** structured JSON logs, queue-depth and send-latency metrics, and tracing.
- **Sending windows and per-lead timezones**, plus pause/resume per campaign.
- **Per-tenant quotas**, revocable sessions, and a sliding-window limiter.
- **Server-Sent Events** for live dashboard updates.

---

## 12. Demo script

1. `docker compose up -d`, then `npm run dev` in `backend/` and `frontend/`. **Log in with Google**: your name, email and avatar appear in the sidebar card.
2. **Compose:**
   - Click **Upload List** and pick `sample-leads.csv` (5 detected, 1 duplicate removed, 1 invalid skipped).
   - Subject: `Quick idea for {{company}}`. Body: `Hi {{first_name}}, …`. Show the **live preview**.
   - Delay `5`, Hourly Limit `3`.
   - 🕐 → pick a time about 2 minutes ahead → **Done** → **Send Later**.
3. Show the **Scheduled** tab, the **Campaigns** tab (progress) and **Queue monitor** (Bull Board → *Delayed*).
4. **Restart:**
   - Press **Ctrl+C** on the backend before the send time.
   - Wait past it, then run `npm run dev` again.
   - The emails still go out, each **once**. In **Sent**, open one → *View delivered message (Ethereal)* and show the personalized text.
5. **Rate limit:** 3 emails are sent and 2 show **Rate limited**. The campaign reads *"Hourly limit reached (3/3 this hour). Resumes …"*.
6. **Bonus:** `npm run proof:workers -- <email> 60 20 3` shows 4 workers, exactly 20 sent and 0 duplicates.
