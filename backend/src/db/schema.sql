-- Applied idempotently on every boot (see db/migrate.ts).
-- Postgres is the source of truth for every email; Redis/BullMQ only holds "when to wake up".

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub  TEXT NOT NULL UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SMTP identities emails are sent from (Ethereal accounts). Stored so credentials survive restarts.
CREATE TABLE IF NOT EXISTS senders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  smtp_host   TEXT NOT NULL,
  smtp_port   INT  NOT NULL,
  smtp_secure BOOLEAN NOT NULL DEFAULT false,
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One "Schedule" click from the compose screen = one campaign.
CREATE TABLE IF NOT EXISTS campaigns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id     UUID NOT NULL REFERENCES senders(id),
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  start_at      TIMESTAMPTZ NOT NULL,
  delay_ms      INT NOT NULL,
  hourly_limit  INT NOT NULL,
  total         INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
  CREATE TYPE email_status AS ENUM ('scheduled', 'rate_limited', 'sending', 'sent', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS emails (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id      UUID NOT NULL REFERENCES senders(id),
  seq            INT  NOT NULL,                 -- position inside the campaign (used to keep order)
  recipient      TEXT NOT NULL,
  subject        TEXT NOT NULL,
  body           TEXT NOT NULL,
  scheduled_at   TIMESTAMPTZ NOT NULL,          -- original requested time
  next_attempt_at TIMESTAMPTZ NOT NULL,         -- moves forward when throttled by rate limits
  status         email_status NOT NULL DEFAULT 'scheduled',
  attempts       INT NOT NULL DEFAULT 0,
  sent_at        TIMESTAMPTZ,
  message_id     TEXT,
  preview_url    TEXT,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient)               -- a lead appears once per campaign
);

-- Which worker instance (host:pid) sent the email: evidence for multi-worker behaviour.
ALTER TABLE emails ADD COLUMN IF NOT EXISTS processed_by TEXT;
-- Personalization variables of the lead (CSV columns), kept for auditing / preview.
ALTER TABLE emails ADD COLUMN IF NOT EXISTS variables JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS emails_user_status_next_idx ON emails (user_id, status, next_attempt_at);
CREATE INDEX IF NOT EXISTS emails_user_sent_idx ON emails (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS emails_pending_idx ON emails (status) WHERE status IN ('scheduled', 'rate_limited', 'sending');
