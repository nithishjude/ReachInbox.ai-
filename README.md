# ReachInbox Email Scheduler

This is my submission for the ReachInbox (Outbox Labs) Software Development Intern assignment: an email scheduler with a dashboard.

You sign in with Google, upload a CSV of leads, write an email, and pick when sending should start. The backend stores every email in PostgreSQL and schedules each one as a BullMQ delayed job in Redis. No cron is used anywhere. When an email is due, a worker sends it through Ethereal (a fake SMTP service), while respecting:
- a minimum gap between sends
- an hourly limit per sender and per campaign

It keeps working if the server restarts, and the same email is never sent twice.

| Login | Scheduled emails | Compose |
|---|---|---|
| ![Login](docs/screenshots/login.png) | ![Scheduled](docs/screenshots/scheduled.png) | ![Compose](docs/screenshots/compose.png) |
| **Campaigns** | **A campaign held back by its hourly limit** | **Send later** |
| ![Campaigns](docs/screenshots/campaigns.png) | ![Campaign detail](docs/screenshots/campaign-detail.png) | ![Send later](docs/screenshots/send-later.png) |

## Live demo & video

- Live link: https://reach-inbox-ai-three.vercel.app (see [Deployment](#deployment) for how sending works there)
- Demo video: _link to be added_

## Deployment

| Part | Where |
|---|---|
| Frontend | Vercel ([`frontend/vercel.json`](frontend/vercel.json)) |
| API | Render web service ([`render.yaml`](render.yaml)) |
| Postgres | Neon |
| Redis | Upstash (TLS, `rediss://`) |

**How the frontend reaches the API.** Vercel forwards `/api/*` and `/admin/*` to the Render API. The browser only ever talks to the Vercel domain, so the login cookie stays first-party.

**Why the worker doesn't run on Render.** Render's free plan blocks outgoing SMTP ports (25, 465 and 587). The worker's connection to Ethereal never gets an answer and ends in "Connection timeout". The emails aren't lost: they stay queued and retry with backoff, as designed. So on Render I run the **API only** (`RUN_WORKER_IN_API=false`). The **worker runs as a separate process on my machine**, connected to the same Neon database and Upstash Redis:

```bash
cd backend
npm run worker      # .env points to Neon + Upstash
```

This is the same API/worker split the app is built for. It also makes the restart test easy to show on the live site:
1. Stop the worker and schedule emails; they wait in the cloud queue.
2. Start the worker again; they're sent, each once.

On a paid Render instance (SMTP allowed) the worker could run there instead, with no code changes.

**Free-tier notes:**
- The free Render service sleeps after 15 minutes without traffic, so the first request can take up to a minute.
- `WORKER_DRAIN_DELAY_SEC=30` keeps an idle worker within Upstash's free command limit.

## Contents

- [Deployment](#deployment)
- [Tech stack](#tech-stack)
- [How to run](#how-to-run)
- [Ethereal email and environment variables](#ethereal-email-and-environment-variables)
- [Architecture](#architecture)
- [API endpoints](#api-endpoints)
- [Feature checklist](#feature-checklist)
- [Edge cases](#edge-cases)
- [Tests](#tests)
- [Project structure](#project-structure)
- [Assumptions, shortcuts and trade-offs](#assumptions-shortcuts-and-trade-offs)
- [What I would add next](#what-i-would-add-next)

## Tech stack

| Part | What I used |
|---|---|
| API | Express 4 + TypeScript, with Zod for validating requests and config |
| Queue | BullMQ 5 on Redis 7 (append-only file persistence turned on) |
| Database | PostgreSQL 16 through `pg` with plain SQL, in a small repository layer |
| Email | Nodemailer sending through Ethereal |
| Login | Google OAuth 2.0 (authorization code flow), session kept in an httpOnly cookie |
| Frontend | React 18, Vite, TypeScript and Tailwind CSS |
| Queue monitoring | Bull Board at `/admin/queues` |
| Tooling | Vitest, Docker Compose, GitHub Actions |

## How to run

You need Node.js 20+ and Docker.

### 1. Start Redis and Postgres

```bash
docker compose up -d
```

### 2. Backend (API)

```bash
cd backend
cp .env.example .env      # fill in JWT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ADMIN_EMAILS
npm install
npm run api               # Express API on http://localhost:4000
```

### 3. Worker

In a second terminal:

```bash
cd backend
npm run worker            # BullMQ worker; start more of these to scale out
```

For quick local work, `npm run dev` runs the API and the worker in one process instead.

### 4. Frontend

```bash
cd frontend
npm install
npm run dev               # http://localhost:5173
```

Open http://localhost:5173 and log in with Google. On first start, the backend:
- creates the database tables
- creates three Ethereal sender accounts

### Everything in Docker

```bash
docker compose --profile app up --build     # http://localhost:8080
```

This starts Postgres, Redis, the API, two worker containers, and nginx serving the built frontend. It reads secrets from `backend/.env`. For this mode, add `http://localhost:8080/api/auth/google/callback` as an extra redirect URI in Google Cloud.

### Other backend scripts

| Command | What it does |
|---|---|
| `npm test` | Integration tests against real Postgres and Redis. They use a separate `reachinbox_test` database and Redis DB 15 |
| `npm run load-test -- <your-login-email> 1000 50` | Schedules 1000 emails at once with a 50/hour limit |
| `npm run proof:workers -- <your-login-email> 60 20 3` | Starts 3 worker processes and checks that the limit holds across all of them |

## Ethereal email and environment variables

**Ethereal.** Nothing to set up. On first start the backend creates 3 Ethereal accounts and saves them in the `senders` table, so they're reused after restarts. Ethereal never delivers to real inboxes. Each sent email stores a preview link, which opens from the email page ("View delivered message").

**Google OAuth.** In Google Cloud Console, create an OAuth client of type *Web application*:
- Redirect URI: `http://localhost:4000/api/auth/google/callback`
- On the consent screen choose *External* and add your account as a test user.
- Put the client ID and secret in `backend/.env`.

**Real delivery (optional).** As an extra, `SMTP_SENDERS` can add a real SMTP sender, such as Gmail with an App Password. It goes through the same queue and limits as the Ethereal senders.

| Variable | Default | What it is for |
|---|---|---|
| `PORT` | `4000` | API port |
| `FRONTEND_URL` | `http://localhost:5173` | CORS origin and where to go after login |
| `JWT_SECRET` | required | Signs the session token |
| `DATABASE_URL` | `postgres://reachinbox:reachinbox@localhost:5432/reachinbox` | Postgres connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | required | Google OAuth client |
| `GOOGLE_REDIRECT_URI` | `http://localhost:4000/api/auth/google/callback` | OAuth callback URL |
| `ADMIN_EMAILS` | empty | Google accounts allowed to open `/admin/queues` |
| `ETHEREAL_SENDER_COUNT` | `3` | How many Ethereal senders to create |
| `ETHEREAL_SENDERS` | empty | Use specific Ethereal accounts instead (JSON) |
| `SMTP_SENDERS` | empty | Optional real SMTP senders (JSON) |
| `WORKER_CONCURRENCY` | `5` | Jobs each worker process handles at the same time |
| `MIN_DELAY_BETWEEN_SENDS_MS` | `2000` | Minimum gap between two emails from the same sender (2 seconds) |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | Hourly limit per sender |
| `SEND_MAX_ATTEMPTS` | `5` | Retries for temporary SMTP errors (backoff from 30 s up to 4 min) |
| `RUN_WORKER_IN_API` | `true` | Whether `npm run dev` also starts the worker |

## Architecture

![System overview](docs/architecture/1-system-overview.png)

There are three main pieces:
- **The API** accepts requests, validates them, writes to Postgres and adds jobs to the queue.
- **The worker** picks up jobs when they're due and sends the emails.
- **Redis** holds the delayed jobs and the rate-limit counters.

The API and the worker can run as separate processes, and you can run as many workers as you like. Every decision they share is made in Redis or Postgres, never in a single process's memory.

The diagram sources are in [`docs/architecture`](docs/architecture) as Mermaid files.

### How scheduling works

![Lifecycle of a scheduled email](docs/architecture/2-email-lifecycle.png)

1. When you click Schedule, the API validates the request, removes duplicate addresses, and fills in the personalization variables for each lead.
2. It saves the campaign and one row per email in a single transaction. Email *i* is planned for `start time + i × delay`.
3. Only after that does it add one BullMQ delayed job per email, with `delay = planned time - now`.
4. The job id is the email's database id (`email-<uuid>`). BullMQ refuses a second job with the same id, so an email can't be queued twice.
5. 1000 emails are saved with one `INSERT ... UNNEST` and queued with `addBulk` in chunks of 500, which takes about 200 ms. The API doesn't wait for any sending.

While a job waits, it sits in Redis's delayed set. BullMQ moves it to the active queue when its time comes, so no cron or polling loop is involved.

### How an email's status changes

<p align="center"><img src="docs/architecture/3-email-states.png" alt="Email status flow" width="760"></p>

- The **Scheduled** tab shows `scheduled`, `rate_limited` and `sending`.
- The **Sent** tab shows `sent` and `failed`.

### Database

<p align="center"><img src="docs/architecture/4-data-model.png" alt="Database tables" width="520"></p>

Four tables: `users`, `senders`, `campaigns` and `emails`.
- Times are stored as `timestamptz` (UTC) and shown in the browser's local time.
- The schema in `backend/src/db/schema.sql` runs on every start. It's written so it can safely run more than once, and it takes a Postgres advisory lock so two processes starting together don't clash.

### How restarts are handled

- **Redis keeps jobs on disk.** It runs with append-only file persistence and `noeviction`, so delayed jobs survive a Redis restart and are never thrown away. After the API or worker restarts, the jobs are still there and fire at their original times. Anything that came due while the system was down goes out as soon as a worker is back.
- **Postgres is the source of truth** for every email's status.
- **Startup check for lost jobs.** On start, the API checks each pending email. If its job is *missing* from Redis (which only happens if Redis lost its data), it re-adds that one job with the same id. Normally it finds nothing missing and logs "nothing to restore". It doesn't re-add jobs that already exist.
- **Graceful shutdown.** On Ctrl+C the worker finishes the emails it's currently sending before it exits.
- **Stalled jobs.** If a worker is killed outright, BullMQ notices the stalled job and gives it to another worker; the checks in the next section stop it being sent twice.

I tested this by scheduling emails, killing the server, and starting it again after the first send time had passed. The overdue email went out right away, the later ones went out on time, and none was sent twice.

### How duplicates are prevented

1. **One job per email:** the job id is the database id, so the same email can't be queued twice.
2. **Status check:** before sending, the worker reloads the email and skips it if it's already `sent` or `failed`.
3. **Atomic claim:** the worker claims the email with `UPDATE emails SET status = 'sending' WHERE id = $1 AND status IN ('scheduled', 'rate_limited')`. If two workers get the same email at the same moment, only one update succeeds. A test runs 20 claims at once and checks that exactly one wins.
4. **Crash in the middle of a send:** a worker could die after claiming an email but before saving the result. Then there's no way to know whether the SMTP server accepted it, so after 2 minutes the email is marked `failed` instead of being resent. The user can retry it from the dashboard. I chose this (at most once) because sending twice is the thing the assignment says must never happen.
5. **Temporary errors are retried:** network problems and 4xx errors happen before the message is accepted, so they're safe to retry, with backoff, up to 5 attempts. 5xx errors fail straight away.

### How rate limiting, delay and concurrency work

| Setting | Value I used | How it is enforced |
|---|---|---|
| Worker concurrency | 5 jobs per worker (`WORKER_CONCURRENCY`) | BullMQ worker option |
| Minimum gap between emails | 2 seconds per sender (`MIN_DELAY_BETWEEN_SENDS_MS`) | Redis key holding each sender's next free time slot |
| Delay inside a campaign | Set in Compose | Emails are planned that many seconds apart |
| Hourly limit per sender | 200 (`MAX_EMAILS_PER_HOUR_PER_SENDER`) | Redis counter per sender per hour |
| Hourly limit per campaign | Set in Compose | Redis counter per campaign per hour |

<p align="center"><img src="docs/architecture/5-rate-limiter.png" alt="Rate limiter decision flow" width="460"></p>

All the checks happen in **one Lua script** in Redis (`backend/src/rateLimiter/hourlyLimiter.ts`). It runs atomically, so two workers can never both take the last slot. The script:
1. takes the current time from Redis, so every worker uses the same clock
2. picks the sender's next free slot, at least 2 seconds after the previous send
3. checks the sender and campaign counters for that hour
4. if both are under their limits, increases both counters and reserves the slot

There are three possible outcomes:
- **The slot is now:** the email is sent.
- **The slot is a few seconds away** (because of the gap): the job goes back to the delayed queue until then. The worker doesn't sit and wait, so it stays free for other jobs.
- **The hour is full:** the email is marked `rate_limited` and moved to the start of the next hour with `job.moveToDelayed(...)` followed by `throw new DelayedError()`. It's never dropped or failed. Each email is offset by its position × 25 ms, so the campaign keeps its order when the next hour opens.

### What happens with 1000+ emails

I measured this with `npm run load-test -- <email> 1000 50`, which schedules 1000 emails for "now" with a limit of 50 per hour:
- All 1000 were saved and queued in about 200 ms.
- The first 50 got send slots 2 seconds apart, and the other 950 were moved to the next hour, in order.
- Each hour after that, another 50 go out. So 1000 emails at 50 per hour take 20 hours, and none are lost. With the default limit of 200 per hour, the same 1000 would take 5 hours.

To check that the limit holds across several workers, `npm run proof:workers -- <email> 60 20 3` starts 3 separate worker processes for 60 emails with a limit of 20. The API's own worker joins in as a 4th. My run:

```
Sent:          20  (limit 20)
  by Jude:27060: 5
  by Jude:29664: 5
  by Jude:31268: 5
  by Jude:8152: 5
Rate limited:  40  (moved to the next hour)
Duplicates:    0
PASS  exactly 20 sent across all workers
PASS  work was shared by more than one worker process
PASS  remaining 40 rescheduled, none dropped or failed
PASS  rescheduled into the next hour window
PASS  no email sent twice
```

Each sent email records which worker sent it (`processed_by`), so this can also be checked in the database.

### Personalization

If the CSV has a header row (for example `name,email,company`), each column becomes a variable you can use in the subject and body:
- `{{name}}`, `{{company}}`, `{{email}}`, plus `{{first_name}}`, which is taken from `name`
- `{{first_name|there}}` uses "there" when the value is missing

The Compose page lists the variables you can insert. It warns about ones that don't match a column, and shows a preview of the email each recipient will get. The text is filled in when the campaign is created and saved on each email row, so the lists, the email page and the worker all show the same final text. Values from the CSV are escaped before going into HTML.

### Campaign progress

Each Schedule click creates a campaign. The Campaigns tab shows each one with:
- a progress bar: sent, failed, sending, rate limited and scheduled
- a status: Scheduled, Sending, Throttled, Completed, or Completed with errors
- a line saying what happens next, e.g. "Hourly limit reached (2/2 this hour). Resumes 8:30 PM".

The detail page lists every recipient in send order.

### Frontend

![Frontend structure](docs/architecture/6-frontend.png)

- **Pages:** login, dashboard (Scheduled / Sent / Campaigns tabs), compose, email view and campaign view.
- **API calls** all go through `lib/api.ts`, and the response types are in `types/email.ts`.
- **Lists** refresh every 5 seconds, so you can watch emails move from Scheduled to Sent. A slower, older response never overwrites a newer one.
- **States:** every list has a loading, an empty and an error state. If the API fails, the UI shows an error message, never placeholder data.
- **Session expiry:** if your session expires, you're sent back to the login page.
- **Validation:** the Compose form checks its inputs before sending, and the Schedule button is disabled while the request is running.

### Security

- **Google login:** the authorization code flow, with a `state` value to block cross-site request forgery. The ID token is checked on the server.
- **Sessions:** a JWT in an httpOnly, SameSite=Lax cookie.
- **Separate data per user:** every query is filtered by the logged-in user.
- **Queue dashboard:** only accounts listed in `ADMIN_EMAILS` can open it.
- **Input limits:** Zod validates all input; there are at most 10,000 recipients and the body is capped at 50 kB.
- **Secrets** live only in `backend/.env`, which is git-ignored.

## API endpoints

All `/api/emails`, `/api/campaigns` and `/api/senders` routes need a session: the cookie from Google login, or `Authorization: Bearer <token>` for tools like Postman. [`requests.http`](requests.http) has an example request for each route.

| Method and path | What it does |
|---|---|
| `GET /api/auth/google` | Starts Google login |
| `GET /api/auth/google/callback` | Google redirects here; sets the session and redirects to the dashboard |
| `GET /api/auth/me` | The logged-in user |
| `POST /api/auth/logout` | Logs out |
| `POST /api/emails/schedule` | Creates a campaign and schedules its emails |
| `GET /api/emails/scheduled` | Emails waiting to be sent (`?search=&status=&page=&pageSize=`) |
| `GET /api/emails/sent` | Sent and failed emails (same query options) |
| `GET /api/emails/stats` | Counts per status |
| `GET /api/emails/:id` | One email |
| `DELETE /api/emails/:id` | Cancels a scheduled email, or deletes one from history |
| `POST /api/emails/retry` | Re-queues failed emails: `{ "ids": [...] }` or `{ "all": true }` |
| `GET /api/campaigns` | Campaigns with their progress |
| `GET /api/campaigns/:id` | One campaign and its emails |
| `GET /api/senders` | Senders, their usage this hour, and the limits |
| `GET /api/health` | Checks Postgres and Redis (no login needed) |
| `GET /admin/queues` | Bull Board (admins only) |

Example request:

```json
POST /api/emails/schedule
{
  "subject": "Quick idea for {{company}}",
  "body": "<p>Hi {{first_name|there}},</p>",
  "recipients": [
    "plain@example.com",
    { "email": "ava@acme.com", "fields": { "name": "Ava Thompson", "company": "Acme" } }
  ],
  "startAt": "2026-10-24T04:30:00.000Z",
  "delayBetweenEmailsSec": 5,
  "hourlyLimit": 3
}
```

Responses:

```
201  { "campaignId": "...", "scheduled": 2, "duplicatesRemoved": 0, "invalid": [], "firstSendAt": "...", "lastSendAt": "..." }
400  { "error": "startAt cannot be in the past" }
401  { "error": "Not authenticated" }
```

Every error uses the same `{ "error": "..." }` shape, with a matching status code.

## Feature checklist

### Backend
- [x] Schedule API that saves to Postgres (`POST /api/emails/schedule`)
- [x] BullMQ delayed jobs; no cron, node-cron, agenda or `setInterval` used for scheduling
- [x] Email saved in the database first, then queued with the database id as the job id
- [x] No duplicate sends (status check + atomic claim)
- [x] Survives restarts (Redis persistence + Postgres)
- [x] Multiple Ethereal senders (3)
- [x] Worker concurrency from env (`WORKER_CONCURRENCY`)
- [x] Delay between emails from env (`MIN_DELAY_BETWEEN_SENDS_MS`, 2 seconds)
- [x] Hourly limit per sender from env (`MAX_EMAILS_PER_HOUR_PER_SENDER`), counted in Redis
- [x] Emails over the limit are moved to the next hour, never dropped
- [x] 1000+ emails case measured and explained
- [x] Request validation with Zod

### Frontend
- [x] Real Google login, with name, email, avatar and logout
- [x] Dashboard with Scheduled and Sent tabs and a Compose button, following the Figma
- [x] Compose: subject, body, CSV upload showing how many addresses were found, start time, delay, hourly limit
- [x] Scheduled list: email, subject, scheduled time, status
- [x] Sent list: email, subject, sent time, sent or failed
- [x] Loading, empty and error states; no fake data
- [x] Typed API client, reusable components, error toasts

### Extras I added
- Personalization with `{{variables}}` from the CSV
- Campaign progress
- Retry for failed emails
- Cancel and delete
- A rich-text editor
- Send Later presets
- Search and a status filter
- Admin-only queue dashboard
- Optional real SMTP sender
- Tests
- CI
- A Docker setup for the whole app
- A multi-worker check script
- A load-test script

## Edge cases

| Case | What happens |
|---|---|
| CSV with bad rows, duplicates, extra spaces or capitals | Addresses are trimmed, lowercased and checked. The UI shows how many were found, how many duplicates were removed, and how many invalid rows were skipped |
| No valid addresses | Scheduling is blocked with a message |
| Start time in the past | The API returns 400, and the date picker doesn't allow it |
| Hourly limit reached | The email is moved to the next hour |
| SMTP error | Retried with backoff; after that it's marked failed with the reason, and can be retried from the UI |
| Worker killed mid-send | Not sent twice (see [How duplicates are prevented](#how-duplicates-are-prevented)) |
| Double click on Schedule | The button is disabled while the request is running |
| Redis or Postgres not running at startup | The server stops with a clear message instead of hanging |
| Session expired | You're redirected to the login page |

`setInterval` appears only in the frontend, to refresh the lists every 5 seconds. Emails are scheduled only with BullMQ.

## Tests

```bash
cd backend && npm test      # needs `docker compose up -d`; uses its own test database
cd frontend && npm test
```

**Backend (14 tests, against real Postgres and Redis):**
- the rate limiter with 50 callers at once
- the per-sender limit across campaigns
- the 2-second gap
- 20 workers claiming the same email (exactly one wins)
- the worker end to end: sending, re-delivered jobs, moving to the next hour in order, cancelled emails
- personalization and HTML escaping
- campaign progress counts

**Frontend (10 tests):**
- CSV parsing: quotes, semicolons, duplicates, invalid rows, header columns
- the template helpers

GitHub Actions (`.github/workflows/ci.yml`) runs on every push: typechecks, both test suites, the builds, and the Docker image builds.

## Project structure

```
.
├── backend/
│   ├── src/
│   │   ├── api/              routes: auth, emails, campaigns
│   │   ├── auth/             session cookie and route guards
│   │   ├── config/           environment config (validated with Zod)
│   │   ├── db/               schema.sql, migration, SQL for emails and campaigns
│   │   ├── lib/              Redis connection, {{variable}} templates
│   │   ├── mail/             senders and sending
│   │   ├── queue/            BullMQ queue, worker, startup check
│   │   ├── rateLimiter/      Redis Lua rate limiter
│   │   ├── app.ts            Express app
│   │   ├── bootstrap.ts      startup checks and graceful shutdown
│   │   ├── server.ts         API only     (npm run api)
│   │   ├── workerMain.ts     worker only  (npm run worker)
│   │   └── index.ts          both together (npm run dev)
│   ├── tests/                integration tests
│   ├── scripts/              load test and multi-worker check
│   └── .env.example
├── frontend/
│   └── src/
│       ├── pages/            login, dashboard, compose, email, campaign
│       ├── components/       lists, menus, compose parts, campaign parts, small UI pieces
│       ├── hooks/            auth, data loading and polling, toasts
│       ├── lib/              API client, CSV parsing, templates, formatting
│       └── types/            API types
├── docs/                     architecture diagrams and screenshots
├── docker-compose.yml        Postgres and Redis (and the full app with --profile app)
├── requests.http             example API requests
└── sample-leads.csv          sample leads for trying it out
```

## Assumptions, shortcuts and trade-offs

- **At most once when a worker crashes mid-send.** A crash while sending marks the email failed rather than risking a second send. That window is a single SMTP call, and a normal shutdown waits for sends to finish.
- **Hourly limits use clock hours** (for example 2:00 to 3:00), not a rolling 60 minutes. That's simpler and exact, but up to twice the limit can go out around the turn of the hour.
- **A rate-limit slot is used when it's reserved.** If that send then fails, the slot isn't given back, so the system can send slightly fewer emails than the limit, never more.
- **Personalized text is filled in when you schedule**, so editing a template later doesn't change emails that are already queued.
- **Single Redis instance.** The Lua script would need changes for Redis Cluster.
- **Sessions are JWTs that last 7 days.** Logout clears the cookie, but a token can't be revoked on the server.
- **The dashboard polls every 5 seconds** rather than using WebSockets. At this scale that's simpler and good enough.
- **Differences from the Figma:**
  - The logo says ReachInbox instead of the placeholder "ONB".
  - Login is Google only (no email/password form), as the assignment asks.
  - There's no archive button.
  - Rows show the recipient's address, because the CSV may not have names.
  - Stars are saved in the browser only.
- **The rich-text editor** uses the browser's built-in `contentEditable` and `execCommand`. They're old APIs, but they work everywhere and avoid a large dependency.

## What I would add next

- Encrypt the SMTP passwords stored in the database
- Alerts when emails fail or the failure rate goes up
- Structured logs and metrics (queue size, send time)
- Sending windows per timezone, and pausing or resuming a campaign
- Live updates with Server-Sent Events instead of polling
