import { leadVars, renderTemplate } from "../lib/template";
import { isHtml } from "../mail/sendEmail";
import { pool, withTransaction } from "./client";

export type EmailStatus = "scheduled" | "rate_limited" | "sending" | "sent" | "failed";

export interface EmailRow {
  id: string;
  campaign_id: string;
  user_id: string;
  sender_id: string;
  seq: number;
  recipient: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  next_attempt_at: Date;
  status: EmailStatus;
  attempts: number;
  sent_at: Date | null;
  message_id: string | null;
  preview_url: string | null;
  error: string | null;
  updated_at: Date;
}

export interface EmailWithLimits extends EmailRow {
  hourly_limit: number;
}

export interface Lead {
  email: string;
  /** CSV columns for this lead, used for {{variables}}. */
  fields?: Record<string, string>;
}

export interface CreateCampaignInput {
  userId: string;
  senderId: string;
  /** Templates; may contain {{variables}}. Each email stores its own rendered copy. */
  subject: string;
  body: string;
  startAt: Date;
  delayMs: number;
  hourlyLimit: number;
  recipients: Lead[];
}

export interface CreatedEmail {
  id: string;
  next_attempt_at: Date;
}

/**
 * Creates the campaign and all its email rows in a single transaction.
 * Recipient i is planned at startAt + i * delayMs, and gets the subject/body rendered with its own
 * variables at creation time, so lists, previews and the worker all see the final personalised text.
 * Rows are inserted with one UNNEST-based statement, so 1000+ leads cost a single round trip.
 */
export async function createCampaign(input: CreateCampaignInput): Promise<{ campaignId: string; emails: CreatedEmail[] }> {
  const bodyIsHtml = isHtml(input.body);
  const leads = input.recipients.map((r) => ({ email: r.email, vars: leadVars(r.email, r.fields) }));

  return withTransaction(async (client) => {
    const { rows: [campaign] } = await client.query<{ id: string }>(
      `INSERT INTO campaigns (user_id, sender_id, subject, body, start_at, delay_ms, hourly_limit, total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.userId, input.senderId, input.subject, input.body, input.startAt, input.delayMs, input.hourlyLimit, leads.length],
    );

    const seqs = leads.map((_, i) => i);
    const times = seqs.map((i) => new Date(input.startAt.getTime() + i * input.delayMs).toISOString());
    const subjects = leads.map((l) => renderTemplate(input.subject, l.vars).replace(/\s+/g, " ").trim() || "(no subject)");
    const bodies = leads.map((l) => renderTemplate(input.body, l.vars, { html: bodyIsHtml }));
    const variables = leads.map((l) => JSON.stringify(l.vars));

    const { rows } = await client.query<CreatedEmail>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, seq, recipient, subject, body, variables, scheduled_at, next_attempt_at)
       SELECT $1, $2, $3, r.seq, r.recipient, r.subject, r.body, r.vars::jsonb, r.at, r.at
       FROM UNNEST($4::int[], $5::text[], $6::text[], $7::text[], $8::text[], $9::timestamptz[])
            AS r(seq, recipient, subject, body, vars, at)
       RETURNING id, next_attempt_at`,
      [campaign.id, input.userId, input.senderId, seqs, leads.map((l) => l.email), subjects, bodies, variables, times],
    );
    return { campaignId: campaign.id, emails: rows };
  });
}

export async function getEmailForSend(id: string): Promise<EmailWithLimits | undefined> {
  const { rows } = await pool.query<EmailWithLimits>(
    `SELECT e.*, c.hourly_limit FROM emails e JOIN campaigns c ON c.id = e.campaign_id WHERE e.id = $1`,
    [id],
  );
  return rows[0];
}

export async function markThrottled(id: string, status: "scheduled" | "rate_limited", nextAttemptAt: Date): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = $2, next_attempt_at = $3, updated_at = now()
     WHERE id = $1 AND status IN ('scheduled', 'rate_limited')`,
    [id, status, nextAttemptAt],
  );
}

/**
 * Idempotency guard. Atomically moves a row into 'sending' only if it hasn't been picked up yet.
 * If two workers ever race on the same email, exactly one UPDATE matches; the other gets null.
 */
export async function claimForSending(id: string): Promise<EmailRow | null> {
  const { rows } = await pool.query<EmailRow>(
    `UPDATE emails SET status = 'sending', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status IN ('scheduled', 'rate_limited')
     RETURNING *`,
    [id],
  );
  return rows[0] ?? null;
}

export async function markSent(id: string, messageId: string, previewUrl: string | null, processedBy: string): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3, processed_by = $4, error = NULL, updated_at = now()
     WHERE id = $1 AND status = 'sending'`,
    [id, messageId, previewUrl, processedBy],
  );
}

export async function markFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = 'failed', sent_at = now(), error = $2, updated_at = now()
     WHERE id = $1 AND status IN ('sending', 'scheduled', 'rate_limited')`,
    [id, error.slice(0, 1000)],
  );
}

/** SMTP rejected the message before accepting it -> safe to let BullMQ retry. */
export async function releaseForRetry(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE emails SET status = 'scheduled', error = $2, updated_at = now() WHERE id = $1 AND status = 'sending'`,
    [id, error.slice(0, 1000)],
  );
}

/**
 * Deletes an email (cancels it if it hasn't gone out yet). Rows mid-send are refused so we never
 * lose track of an SMTP call in flight. The queued job may still wake up later; the worker then
 * finds no row and skips it.
 */
export async function deleteEmail(userId: string, id: string): Promise<"deleted" | "not_found" | "sending"> {
  const { rows } = await pool.query<{ status: EmailStatus }>(
    `DELETE FROM emails WHERE id = $1 AND user_id = $2 AND status <> 'sending' RETURNING status`,
    [id, userId],
  );
  if (rows.length) return "deleted";
  const { rows: existing } = await pool.query("SELECT 1 FROM emails WHERE id = $1 AND user_id = $2", [id, userId]);
  return existing.length ? "sending" : "not_found";
}

/** Rows the queue must know about; used to repair Redis after data loss. */
export async function listPendingForReconcile(): Promise<{ id: string; next_attempt_at: Date }[]> {
  const { rows } = await pool.query(
    `SELECT id, next_attempt_at FROM emails WHERE status IN ('scheduled', 'rate_limited') ORDER BY next_attempt_at, seq`,
  );
  return rows;
}

// ---------- Dashboard queries ----------

export interface EmailListItem {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: Date;
  next_attempt_at: Date;
  sent_at: Date | null;
  error: string | null;
  preview_url: string | null;
  sender_name: string;
  sender_email: string;
}

export type ListKind = "scheduled" | "sent";

const LIST_FILTERS: Record<ListKind, { statuses: EmailStatus[]; order: string }> = {
  scheduled: { statuses: ["scheduled", "rate_limited", "sending"], order: "e.next_attempt_at ASC, e.seq ASC" },
  sent: { statuses: ["sent", "failed"], order: "e.sent_at DESC NULLS LAST" },
};

export async function listEmails(params: {
  userId: string;
  kind: ListKind;
  /** Optional narrowing inside the tab, e.g. only 'failed' in the Sent tab. */
  status?: EmailStatus;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ items: EmailListItem[]; total: number }> {
  const { statuses, order } = LIST_FILTERS[params.kind];
  const filtered = params.status ? statuses.filter((s) => s === params.status) : statuses;
  const values: unknown[] = [params.userId, filtered];
  let where = "e.user_id = $1 AND e.status = ANY($2::email_status[])";
  if (params.search) {
    values.push(`%${params.search}%`);
    where += ` AND (e.recipient ILIKE $${values.length} OR e.subject ILIKE $${values.length})`;
  }

  const [items, count] = await Promise.all([
    pool.query<EmailListItem>(
      `SELECT e.id, e.recipient, e.subject, e.body, e.status, e.scheduled_at, e.next_attempt_at, e.sent_at,
              e.error, e.preview_url, s.name AS sender_name, s.email AS sender_email
       FROM emails e JOIN senders s ON s.id = e.sender_id
       WHERE ${where}
       ORDER BY ${order}
       LIMIT ${params.limit} OFFSET ${params.offset}`,
      values,
    ),
    pool.query<{ count: string }>(`SELECT count(*) FROM emails e WHERE ${where}`, values),
  ]);
  return { items: items.rows, total: Number(count.rows[0].count) };
}

export interface EmailStats extends Record<ListKind, number> {
  byStatus: Record<EmailStatus, number>;
  sentLastHour: number;
  campaigns: number;
}

export async function getStats(userId: string): Promise<EmailStats> {
  const { rows } = await pool.query<Record<EmailStatus | "sent_last_hour" | "campaigns", string>>(
    `SELECT count(*) FILTER (WHERE status = 'scheduled')    AS scheduled,
            count(*) FILTER (WHERE status = 'rate_limited') AS rate_limited,
            count(*) FILTER (WHERE status = 'sending')      AS sending,
            count(*) FILTER (WHERE status = 'sent')         AS sent,
            count(*) FILTER (WHERE status = 'failed')       AS failed,
            count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '1 hour') AS sent_last_hour,
            (SELECT count(*) FROM campaigns WHERE user_id = $1) AS campaigns
     FROM emails WHERE user_id = $1`,
    [userId],
  );
  const r = rows[0];
  const byStatus: Record<EmailStatus, number> = {
    scheduled: Number(r.scheduled),
    rate_limited: Number(r.rate_limited),
    sending: Number(r.sending),
    sent: Number(r.sent),
    failed: Number(r.failed),
  };
  return {
    scheduled: byStatus.scheduled + byStatus.rate_limited + byStatus.sending,
    sent: byStatus.sent + byStatus.failed,
    byStatus,
    sentLastHour: Number(r.sent_last_hour),
    campaigns: Number(r.campaigns),
  };
}

/**
 * Puts failed emails back in the queue, on explicit user request. Only 'failed' rows match,
 * so this can never resurrect an email that was actually sent.
 */
export async function resetFailedForRetry(userId: string, ids: string[] | "all"): Promise<CreatedEmail[]> {
  const { rows } = await pool.query<CreatedEmail>(
    `UPDATE emails
     SET status = 'scheduled', next_attempt_at = now(), attempts = 0, error = NULL, sent_at = NULL, updated_at = now()
     WHERE user_id = $1 AND status = 'failed' ${ids === "all" ? "" : "AND id = ANY($2::uuid[])"}
     RETURNING id, next_attempt_at`,
    ids === "all" ? [userId] : [userId, ids],
  );
  return rows;
}

export async function getEmailForUser(userId: string, id: string): Promise<EmailListItem | undefined> {
  const { rows } = await pool.query<EmailListItem>(
    `SELECT e.id, e.recipient, e.subject, e.body, e.status, e.scheduled_at, e.next_attempt_at, e.sent_at,
            e.error, e.preview_url, s.name AS sender_name, s.email AS sender_email
     FROM emails e JOIN senders s ON s.id = e.sender_id
     WHERE e.user_id = $1 AND e.id = $2`,
    [userId, id],
  );
  return rows[0];
}
