# ReachInbox — Full-stack Email Job Scheduler

A production-style email scheduler: an **Express + TypeScript** API that persists email jobs in **PostgreSQL**, schedules them with **BullMQ delayed jobs on Redis** (no cron anywhere), and sends them through **Ethereal SMTP** from multiple senders — plus a **React + Tailwind** dashboard with real **Google OAuth** login.

```
reachinbox-scheduler/
├── backend/                     Express API + BullMQ worker (TypeScript)
│   ├── src/
│   │   ├── api/                 auth.routes.ts, schedule.routes.ts (HTTP layer only)
│   │   ├── auth/session.ts      JWT session cookie / Bearer token middleware
│   │   ├── config/env.ts        zod-validated configuration (all limits come from env)
│   │   ├── db/                  schema.sql, migrate.ts, client.ts, emails.repo.ts (all SQL lives here)
│   │   ├── mail/                senders.ts (Ethereal accounts + pooled transports), sendEmail.ts
│   │   ├── queue/               queue.ts (producer), worker.ts (consumer), reconcile.ts
│   │   ├── rateLimiter/         hourlyLimiter.ts (atomic Redis Lua slot reservation)
│   │   ├── app.ts               Express app (routes, Bull Board, error handling)
│   │   ├── bootstrap.ts         boot + graceful shutdown shared by all run modes
│   │   ├── index.ts             API + worker in one process
│   │   ├── server.ts            API only
│   │   └── workerMain.ts        worker only (run N of these)
│   └── scripts/loadTest.ts      schedules 1000+ emails at once
├── frontend/                    Vite + React 18 + TypeScript + Tailwind
│   └── src/
│       ├── components/ui/       Button, Avatar, StatusBadge, EmptyState, Spinner
│       ├── components/          Sidebar, UserMenu, FilterMenu, EmailList, PageHeader, Logo, compose/ (RecipientInput, RichTextEditor, SendLaterPopover)
│       ├── hooks/               useAuth, useToast, useTheme, useEmails (polling), useStarred, useDebounced
│       ├── lib/                 api.ts (typed client), parseLeads.ts, html.ts (sanitise/plain text), format.ts
│       ├── pages/               LoginPage, DashboardPage, ComposePage, EmailPage
│       └── types/email.ts       API response / request types
└── docker-compose.yml           Postgres 16 + Redis 7 (AOF persistence)
```

---

## 1. Quick start

**Prerequisites:** Node 20+ and Docker. (You can use a local Postgres/Redis instead; just set `DATABASE_URL` and `REDIS_URL`.)

```bash
# 1. Infra
docker compose up -d                 # Postgres :5432, Redis :6379

# 2. Backend
cd backend
cp .env.example .env                 # then fill GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / JWT_SECRET
npm install
npm run dev                          # API on :4000 + worker in the same process

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev                          # http://localhost:5173
```

Open http://localhost:5173 → **Login with Google** → dashboard.

The schema is applied automatically on boot (`src/db/schema.sql`, idempotent, guarded by a Postgres advisory lock). You don't need to run migrations by hand.

### Run modes

| Command (backend) | What runs |
|---|---|
| `npm run dev` / `npm start` | API **and** worker in one process (`RUN_WORKER_IN_API=true`) |
| `npm run dev:api` / `npm run start:api` | API only |
| `npm run dev:worker` / `npm run start:worker` | Worker only. Start several to scale out; the limits stay global because they live in Redis |
| `npm run build` | Compile to `dist/` |
| `npm run load-test -- <your-login-email> 1000 50` | Schedule 1000 emails "now" with a 50/hour campaign limit |
| `npm run proof:workers -- <your-login-email> 60 20 3` | **Multi-worker proof**: starts 3 worker processes and checks the limit holds across them (see §4) |
| `npm test` | Backend tests against real Postgres + Redis (uses the `reachinbox_test` DB and Redis DB 15) |

### Everything in Docker (one command)

```bash
docker compose --profile app up --build     # http://localhost:8080
```

This runs Postgres, Redis, the API, **2 worker replicas** and nginx serving the frontend (`/api` and `/admin` are proxied to the API). It reads secrets from `backend/.env`. Add `http://localhost:8080/api/auth/google/callback` as an extra authorized redirect URI in Google Cloud.

### Tests & CI

* `cd backend && npm test`: **14 integration tests** run against real Redis and Postgres:
  * the rate limiter under 50 concurrent callers
  * the per-sender limit across campaigns
  * min-gap spacing
  * 20 workers racing for one email, with exactly one claim winning
  * the worker end to end: idempotent re-delivery, next-hour rescheduling in order, and cancelled emails
  * personalization: variables, fallbacks and HTML escaping
  * campaign progress counts
* `cd frontend && npm test`: **10 tests** for lead/CSV parsing (quoted cells, semicolons, header columns) and the template helpers.
* `.github/workflows/ci.yml` runs typecheck, tests (with Postgres and Redis service containers), the builds and the Docker image builds on every push.

### Live queue dashboard

**Bull Board** is mounted at **http://localhost:5173/admin/queues** (proxied) or http://localhost:4000/admin/queues. It shows delayed, waiting, active, completed and failed jobs in real time. It's **restricted to operators**: only Google accounts listed in `ADMIN_EMAILS` can open it (others get 403), and only they see the *Queue monitor* link in the user menu.

---

## 2. Configuration

### Ethereal Email

There's nothing to set up by default. On first boot the backend calls Ethereal's API to create `ETHEREAL_SENDER_COUNT` (default 3) test accounts and **stores them in the `senders` table**. Restarts reuse the same accounts, so earlier messages stay viewable. The credentials are printed in the log the first time. To read the mail, log in at https://ethereal.email with one of them, or click **"Open message preview"** on any sent email in the dashboard. Each sent row stores its Ethereal preview URL.

To pin your own accounts, create them at https://ethereal.email/create and set:

```env
ETHEREAL_SENDERS=[{"name":"Alice","user":"alice@ethereal.email","pass":"..."},{"name":"Bob","user":"bob@ethereal.email","pass":"..."}]
```

### Optional: real delivery (Gmail or any SMTP provider)

Ethereal is the default and is all the project needs. As an extra, you can add senders that deliver to **real inboxes**. They show up in the compose **From** dropdown labelled *real delivery*, with a warning. Sending goes through the same queue, rate limiter and idempotency guards; only the SMTP endpoint changes, which is how this engine would run in production.

1. Turn on 2-Step Verification for your Google account, then create an **App Password** at https://myaccount.google.com/apppasswords.
2. Add it to `backend/.env`. Use single quotes around the JSON. `host`/`port`/`secure` default to Gmail (`smtp.gmail.com:465`, SSL); set them for other providers:
   ```env
   SMTP_SENDERS='[{"name":"Your Name","user":"you@gmail.com","pass":"abcd efgh ijkl mnop"}]'
   ```
3. Restart the backend.

Gmail allows about 500 emails per day. Use real senders only with addresses that expect your mail.

### Google OAuth

1. Google Cloud Console → *APIs & Services* → *Credentials* → **Create OAuth client ID** → type **Web application**.
2. **Authorized redirect URI:** `http://localhost:4000/api/auth/google/callback`. It must match `GOOGLE_REDIRECT_URI`.
3. If the consent screen is in *Testing* mode, add your Google account as a test user.
4. Put the client ID and secret into `backend/.env`.

### All environment variables (`backend/.env.example`)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 4000 | API port |
| `FRONTEND_URL` | http://localhost:5173 | CORS origin + post-login redirect |
| `JWT_SECRET` | – | Signs the session cookie (≥16 chars) |
| `DATABASE_URL` | postgres://reachinbox:reachinbox@localhost:5432/reachinbox | Postgres |
| `REDIS_URL` | redis://localhost:6379 | Redis (BullMQ + rate limiter) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | – | OAuth |
| `ETHEREAL_SENDER_COUNT` / `ETHEREAL_SENDERS` | 3 / – | Senders (see above) |
| `SMTP_SENDERS` | – | Optional real-delivery senders, e.g. Gmail with an App Password (see above) |
| `ADMIN_EMAILS` | – | Comma-separated accounts allowed to open the BullMQ dashboard |
| `WORKER_CONCURRENCY` | 5 | Jobs processed in parallel per worker process |
| `MIN_DELAY_BETWEEN_SENDS_MS` | **2000** | Minimum gap between two sends **from the same sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | **200** | Hard per-sender cap per clock hour |
| `SEND_MAX_ATTEMPTS` | 5 | Attempts for transient SMTP/network errors (exponential backoff 30 s → 4 min, ~7.5 min total) |
| `RUN_WORKER_IN_API` | true | Start the worker inside `npm run dev` / `npm start` |

The frontend needs no env. Vite proxies `/api` and `/admin` to `http://localhost:4000`; override that with `VITE_API_PROXY`.

---

## 3. API

All `/api/emails/*` and `/api/senders` routes require a session: the `ri_session` httpOnly cookie set by Google login, **or** `Authorization: Bearer <same JWT>` for Postman.

| Method & path | Description |
|---|---|
| `GET /api/auth/google` | Starts the OAuth flow (redirects to Google) |
| `GET /api/auth/google/callback` | OAuth callback: verifies the ID token, upserts the user, sets the cookie, redirects to the dashboard |
| `GET /api/auth/me` | Current user `{ id, name, email, avatarUrl }` |
| `POST /api/auth/logout` | Clears the session |
| `POST /api/emails/schedule` | Creates a campaign and enqueues one delayed job per recipient (body below) |
| `GET /api/emails/scheduled?search=&status=&page=&pageSize=` | Emails with status `scheduled` / `rate_limited` / `sending`, soonest first |
| `GET /api/emails/sent?search=&status=&page=&pageSize=` | Emails with status `sent` / `failed`, newest first |
| `GET /api/emails/stats` | Counts per status + sent in the last hour (dashboard cards) |
| `POST /api/emails/retry` | Re-queue failed emails: `{ "ids": [...] }` or `{ "all": true }`. Only `failed` rows match, so a sent email can never be resent |
| `GET /api/emails/:id` | One email (incl. error and Ethereal preview URL) |
| `DELETE /api/emails/:id` | Cancel a scheduled email or delete one from history (refused while it is mid-send) |
| `GET /api/senders` | Senders + current hourly usage + server limits |
| `GET /api/campaigns?search=&page=` | Every scheduled batch with live progress: counts per status, sent this hour, next send, resume time |
| `GET /api/campaigns/:id` | One campaign's progress + its recipients in send order |
| `GET /admin/queues` | BullMQ dashboard (`ADMIN_EMAILS` only) |
| `GET /health` | DB + Redis health |

```jsonc
// POST /api/emails/schedule
{
  "senderId": "uuid (optional, defaults to the first sender)",
  "subject": "Quick idea for {{company}}",   // {{variables}} with optional fallback: {{first_name|there}}
  "body": "<p>Hi {{first_name|there}},</p>",
  "recipients": [                            // validated + de-duplicated server-side
    "a@x.com",                                //   plain address, or a lead with CSV columns:
    { "email": "ava@acme.com", "fields": { "Name": "Ava Thompson", "Company": "Acme" } }
  ],
  "startAt": "2026-10-23T10:00:00.000Z",      // optional; past/missing = now
  "delayBetweenEmailsSec": 2,                 // spacing inside this campaign
  "hourlyLimit": 50                           // this campaign's own per-hour cap
}
// 201 → { campaignId, scheduled, duplicatesRemoved, invalid[], sender, firstSendAt, lastSendAt }
```

---

## 4. Architecture

```
 Compose (React) ──POST /schedule──▶ Express ──1 tx──▶ Postgres (campaign + N email rows)   ◀── source of truth
                                         │
                                         └─ addBulk (chunks of 500) ──▶ Redis / BullMQ "email-send"
                                                 jobId = email-<row uuid>, delay = sendAt - now
                                                                │  (delayed set, persisted with AOF)
                                                                ▼
                                       Worker(s), concurrency = WORKER_CONCURRENCY
                                         1. load row → skip if sent/failed           (idempotency)
                                         2. Lua: reserve send slot in Redis          (min-gap + hourly limits)
                                              • slot in the future → moveToDelayed(slot)
                                              • hour full          → moveToDelayed(next window), status rate_limited
                                         3. UPDATE … SET status='sending' WHERE status IN (scheduled, rate_limited)
                                         4. SMTP send via the sender's pooled Ethereal transport
                                         5. UPDATE status='sent', sent_at, message_id, preview_url
```

### How scheduling works (no cron)

* Each recipient becomes one row in `emails`, planned at `startAt + i × delayBetweenEmails`.
* Each row gets **one BullMQ delayed job** with `delay = plannedTime − now`. BullMQ keeps delayed jobs in a Redis sorted set and promotes them when they're due. There are no cron libraries, no OS cron, and no polling loops.
* The **job id is derived from the row id** (`email-<uuid>`). BullMQ ignores an `add` whose id already exists, so enqueueing the same email twice is impossible.
* The API writes rows and enqueues in the same request: one multi-row `INSERT … UNNEST` plus chunked `addBulk`. 1000 emails take about 200 ms end-to-end locally, so the response doesn't block on sending. The worker does the spreading-out.

### How persistence on restart is handled

* **Redis** runs with `appendonly yes` and `maxmemory-policy noeviction`, so delayed jobs survive a Redis restart and are never evicted. After an API or worker restart, BullMQ simply keeps promoting the delayed jobs that are already in Redis. Nothing is re-created from scratch, and future emails fire at their original time. Emails whose time passed while everything was down are sent as soon as the worker comes back.
* **Postgres** is the source of truth for every email's state. The queue only knows *when to wake up*.
* **Safety net (`queue/reconcile.ts`):** on API boot, every DB row still `scheduled`/`rate_limited` is re-`addBulk`-ed with its deterministic job id. In a normal restart all those jobs already exist, so this is a no-op and can't duplicate anything. If Redis data was lost, it rebuilds the queue from Postgres. It's protected by a Redis lock so that only one instance runs it.
* **Graceful shutdown** (SIGINT/SIGTERM): the HTTP server stops accepting requests and `worker.close()` waits for in-flight SMTP sends to finish. A normal stop/restart therefore never interrupts a send. If a worker is hard-killed, its active job's lock expires and BullMQ's stalled-job checker hands the job to another worker.

### Idempotency: an email is never sent twice

1. **Enqueue level:** deterministic `jobId` → one job per email.
2. **Worker level:** the row is loaded first. Rows that are already `sent` or `failed` are skipped.
3. **Claim level:** `UPDATE emails SET status='sending' WHERE id=$1 AND status IN ('scheduled','rate_limited') RETURNING *` is an atomic compare-and-set. If two workers ever pick up the same email (e.g. a stalled-job re-run), exactly one wins and the other skips.
4. **Crash mid-send:** if a worker dies after claiming but before recording the result, nobody can know whether SMTP accepted the message. That row ends up stuck in `sending`. After 2 minutes, the re-run marks it **failed** ("Worker stopped mid-send") instead of resending. This is a deliberate *at-most-once* choice, because the requirement is "never send twice". SMTP errors that happen *before* acceptance (network, 4xx) are safe to retry: the row is released back to `scheduled` and BullMQ retries with exponential backoff. 5xx errors fail permanently.
5. Each message carries a deterministic `Message-ID: <email-uuid@…>`, so duplicates would be detectable downstream.

### Rate limiting & concurrency

Everything is enforced in **Redis** by one atomic Lua script (`rateLimiter/hourlyLimiter.ts`). Any number of worker processes on any number of machines share the same counters. No counts are kept in memory.

| Control | Where it's configured | How it's enforced |
|---|---|---|
| **Worker concurrency** | `WORKER_CONCURRENCY` (default 5) | BullMQ `Worker({ concurrency })`. Parallel jobs are safe because every shared decision (slot reservation, row claim) is atomic in Redis/Postgres |
| **Min delay between sends** | `MIN_DELAY_BETWEEN_SENDS_MS` = **2 s per sender** | Redis key `gap:sender:<id>` holds the sender's next free timestamp. Each job *reserves* `slot = max(now, nextFree)` and pushes `nextFree` forward by 2 s |
| **Per-campaign delay** | Compose → "Delay between emails" | Rows are planned `i × delay` apart |
| **Hourly limit per sender** | `MAX_EMAILS_PER_HOUR_PER_SENDER` = **200** | Counter `rl:sender:<id>:<hourWindow>` |
| **Hourly limit per campaign** | Compose → "Hourly limit" | Counter `rl:campaign:<id>:<hourWindow>` |

How the slot reservation works:

```
now     = Redis TIME            (one clock for all workers, so no clock-skew disagreements)
slot    = max(now, gap[sender])
window  = floor(slot / 1h)      (fixed clock-hour windows)
if senderCount[window]   >= senderLimit   → LIMITED → retry at start of window+1
if campaignCount[window] >= campaignLimit → LIMITED → retry at start of window+1
else senderCount++, campaignCount++, gap[sender] = slot + minGap → RESERVED(slot)
```

* **Reserved, slot = now:** send immediately.
* **Reserved, slot in the future:** the job is `moveToDelayed(slot)` with the reservation stored in job data. It waits in Redis, not in a sleeping worker, so concurrency slots stay free. When it wakes it sends without re-checking. Jobs that contend for the same sender get spaced out in order, with no retry storm.
* **Limited:** the job is **never dropped or failed**. It's moved to the start of the next hour window plus `seq × 25 ms`, so that the campaign's original order is preserved when the window opens. The row becomes `rate_limited` with its new `next_attempt_at`, and the dashboard shows it. `DelayedError` makes BullMQ treat this as a reschedule, not a failed attempt.

### Personalization

* **Columns become variables:** upload a CSV with a header row, e.g. `name,email,company`. Every column becomes a variable: `{{name}}`, `{{company}}`, `{{email}}`, plus `{{first_name}}` derived from `name`.
* **Fallbacks:** `{{first_name|there}}` uses the fallback when the value is missing.
* **Compose helpers:** the Personalize panel inserts variables at the caret, warns about variables that aren't columns, and shows a live preview of the exact subject and body for any recipient.
* **Rendering:** templates are rendered **per recipient when the campaign is created** (`createCampaign`), so lists, search, the email view and the worker all use the final text. The campaign keeps the original template, and each email stores its `variables` (JSONB).
* **Safety:** values inserted into HTML bodies are escaped, so lead data can't inject markup.

### Campaign progress

* **Campaigns tab:** every Schedule click is a campaign. The tab lists them with a stacked progress bar (sent / failed / sending / rate-limited / scheduled), a state (*Scheduled, Sending, Throttled, Completed, Completed with errors*) and a "what happens next" line, e.g. *"Hourly limit reached (3/3 this hour). Resumes Tue 1:00 PM"*.
* **Detail page:** shows the sender, hourly limit usage this hour, delay, first and last send, and every recipient in send order.
* **Data:** everything is computed in one aggregate query per campaign, and the page polls every 5 s.

### Proven across multiple workers

`npm run proof:workers -- <email> 60 20 3` starts 3 separate worker processes (plus the API's in-process worker, if running) against one burst of 60 emails with a 20/hour limit:

```
Sent:          20  (limit 20)
  by Jude:27060: 5
  by Jude:29664: 5
  by Jude:31268: 5
  by Jude:8152: 5
Rate limited:  40  (rescheduled to 2026-10-23T14:00:00.225Z)
Duplicates:    0
PASS  exactly 20 sent across all workers
PASS  work was shared by more than one worker process
PASS  remaining 40 rescheduled, none dropped or failed
PASS  rescheduled into the next hour window
PASS  no email sent twice
```

Each sent row records `processed_by = host:pid`, so the distribution can be checked in the database.

### Behavior under load (1000+ emails at the same time)

Verified with `npm run load-test -- <email> 1000 50`:

* The API persisted and enqueued **1000 emails in ~200 ms**.
* The worker immediately reserved **50 slots 2 s apart** (05:50:01 → 05:51:39). The remaining **950 moved to 06:00:00–06:00:25**, in recipient order. At 06:00 the next 50 get slots and the rest move to 07:00, and so on.
* Throughput is bounded by `min(senderLimit, campaignLimit)` per hour per sender and by `3600 s / minGap` (1800/h at 2 s). Adding workers increases parallelism, but never past those limits.
* Limited jobs cost one cheap Lua call per window hop. Nothing busy-waits.

---

## 5. Features implemented

### Backend
- [x] Express + TypeScript API with zod validation, typed repo layer, central error handling
- [x] PostgreSQL schema (`users`, `senders`, `campaigns`, `emails`), auto-applied on boot
- [x] BullMQ delayed jobs, **no cron** of any kind
- [x] Multiple Ethereal senders (auto-provisioned and persisted, or pinned via env), pooled SMTP transports
- [x] Persistence across restarts (Redis AOF + DB source of truth + idempotent reconciliation)
- [x] Idempotency: deterministic job ids, DB compare-and-set claim, at-most-once on crash
- [x] Configurable worker concurrency; API and worker can run as separate processes and scale horizontally
- [x] Min delay between sends (2 s/sender) via Redis slot reservation
- [x] Hourly limits per sender (env) **and** per campaign (UI), Redis counters, rescheduling into the next window in order
- [x] Retries with exponential backoff for transient SMTP errors; permanent failures marked `failed` with the error
- [x] Live BullMQ dashboard (Bull Board) at `/admin/queues`
- [x] Optional real-delivery senders (Gmail/any SMTP via `SMTP_SENDERS`) alongside Ethereal, through the same engine
- [x] Manual retry of failed emails (single or all), safe by construction: only `failed` rows are re-queued
- [x] **Personalization**: `{{column}}` variables from CSV headers with fallbacks, rendered per recipient and HTML-escaped
- [x] **Campaign progress** API: per-status counts, sent this hour, next send, resume time
- [x] Admin-only BullMQ dashboard (`ADMIN_EMAILS`)
- [x] 24 tests (14 backend integration, 10 frontend), CI pipeline, full Docker setup with 2 worker replicas, and a multi-worker proof script
- [x] Graceful shutdown that drains in-flight sends
- [x] Load-test script

### Frontend (built to the provided Figma)
- [x] **Login page** as in the Figma: card, "Login with Google" (real OAuth 2.0 code flow with CSRF `state` and ID-token verification), "or sign up through email" form. Only Google sign-in is enabled; the email form explains that
- [x] **Dashboard**: ReachInbox pixel wordmark; user card with **avatar, name, email** and a menu (logout, dark mode, queue monitor); outlined **Compose** button; CORE → **Scheduled / Sent** with live counts
- [x] Search bar (debounced), **status filter** (all / waiting / rate limited, or sent / failed) and refresh
- [x] Email rows as in the Figma: `To:` recipient · orange 🕐 **send-time badge** (scheduled), amber *rate limited*, grey **Sent** or red **Failed** · subject - preview · ☆ star · sent time on the Sent tab
- [x] **Email view page**: subject header, star, delete/cancel, sender avatar and address, recipient, date, rendered body, delivery status, error details, Ethereal preview link, **Retry** for failed emails
- [x] **Compose page** as in the Figma: From (sender picker, incl. optional real-delivery senders), **To with email chips and "+N"**, typing/pasting addresses, **Upload List** (CSV/TXT, any column layout) with the **detected count** plus duplicate/invalid report, Subject, **Delay between 2 emails**, **Hourly Limit**, **rich-text editor** (undo/redo, size, bold/italic/underline, align, spacing, lists, indent, quote, strikethrough), 📎 upload shortcut
- [x] **Send Later** popover: "Pick date & time" plus the Figma presets (Tomorrow; Tomorrow 10:00 AM, 11:00 AM, 3:00 PM); the button switches between **Send** and **Send Later**
- [x] "N failed · Retry all failed" banner on the Sent tab
- [x] **Personalize panel** in Compose: variable chips from CSV columns, unknown-variable warning, live per-recipient preview
- [x] **Campaigns** tab with progress bars and states, plus a campaign detail page with stats and recipients in send order
- [x] Loading skeletons, empty states, error states with retry, toasts, pagination, 5 s auto-refresh
- [x] Reusable components (`components/ui`: Button, Avatar, StatusBadge, EmptyState, Spinner; `components/compose`: RecipientInput, RichTextEditor, SendLaterPopover; PageHeader, Sidebar, UserMenu, FilterMenu, EmailList), typed API client and types, HTML bodies sanitised with DOMPurify before rendering, keyboard accessible

---

## 6. Assumptions, shortcuts & trade-offs

* **Figma:** the UI follows the provided Figma screens (login, Scheduled/Sent lists, email view, compose, Send Later). Deliberate differences:
  * The logo reads *ReachInbox* (same pixel style) instead of the placeholder *ONB*.
  * The email/password form is shown but disabled, because the assignment requires Google login only.
  * There's no archive icon, since archiving isn't a feature here.
  * Rows show the recipient's address, since leads come from CSVs without names.
  * Requirement-driven additions: the sent time, a detected-count line, the retry banner and status details.
* **Stars** are a per-browser preference (localStorage), not stored in the database.
* **Rich text:** the editor uses `contentEditable` + `execCommand`. That API is deprecated but universally supported, and it keeps the bundle small compared with a full editor framework.
* **At-most-once on a hard crash mid-send** (see Idempotency). The alternative, at-least-once, would violate "never send twice". The window is a single SMTP call, and graceful shutdowns never hit it.
* **Fixed clock-hour windows** instead of a sliding 60-minute window. They are simpler, exact, and cheap to reason about. The trade-off is that up to 2× the limit can go out across a window boundary (end of one hour + start of the next).
* **A rate-limit slot is consumed at reservation.** If that send then fails, the slot isn't refunded, so the limiter errs on the side of sending fewer.
* **The Lua script builds its keys from arguments**, which is fine for single-node Redis (and Sentinel). Redis Cluster would need hash-tagged keys passed via `KEYS`.
* **Sessions are stateless JWTs** in an httpOnly cookie (7 days). Logout clears the cookie; tokens aren't server-side revocable.
* **The worker runs in the API process by default** for easy local runs. Use `start:api` + `start:worker` in production.
* Email bodies are sent as plain text, plus a minimal escaped HTML version. There are no templates or personalization variables.
* Dashboard freshness uses 5 s polling instead of WebSockets.

---

## 7. Demo script (for the video)

1. `docker compose up -d`, `npm run dev` in backend and frontend. Log in with Google.
2. **Compose** → **Upload List** → `sample-leads.csv` (5 detected, 1 duplicate, 1 invalid) → subject `Quick idea for {{company}}`, body `Hi {{first_name}},…` (show the live preview) → delay `5`, hourly limit `3` → 🕐 **Pick date & time** about 2 minutes ahead → **Done** → **Send Later**.
3. Show the **Scheduled** tab, the **Campaigns** tab (progress bar) and Bull Board (`/admin/queues` → *Delayed*).
4. **Restart:** stop the backend (Ctrl+C) before the start time, wait, start it again. The emails still send at their times and appear once in **Sent** (open the Ethereal preview).
5. **Rate limit:** with a limit of 3, emails 4+ show **Rate limited** with a next-hour time. For load, run `npm run load-test -- you@gmail.com 1000 50` and show 50 slots 2 s apart while the rest wait for the next window.
