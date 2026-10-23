import { pool } from "./client";
import type { EmailStatus } from "./emails.repo";

export interface CampaignProgress {
  id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  created_at: Date;
  start_at: Date;
  delay_ms: number;
  hourly_limit: number;
  total: number;
  counts: Record<EmailStatus, number>;
  /** Sent during the current clock hour (the window the hourly limit applies to). */
  sent_this_hour: number;
  first_sent_at: Date | null;
  last_sent_at: Date | null;
  /** Earliest pending send (scheduled, rate-limited or in flight); null when finished. */
  next_send_at: Date | null;
  /** When rate-limited emails resume; null when nothing is throttled. */
  resumes_at: Date | null;
}

// One pass over the campaign's emails; cheap thanks to the (campaign_id, ...) unique index.
const PROGRESS_SQL = `
  SELECT c.id, c.subject, s.name AS sender_name, s.email AS sender_email, c.created_at, c.start_at,
         c.delay_ms, c.hourly_limit, c.total,
         json_build_object(
           'scheduled',    count(e.id) FILTER (WHERE e.status = 'scheduled'),
           'rate_limited', count(e.id) FILTER (WHERE e.status = 'rate_limited'),
           'sending',      count(e.id) FILTER (WHERE e.status = 'sending'),
           'sent',         count(e.id) FILTER (WHERE e.status = 'sent'),
           'failed',       count(e.id) FILTER (WHERE e.status = 'failed')
         ) AS counts,
         count(e.id) FILTER (WHERE e.status = 'sent' AND e.sent_at >= date_trunc('hour', now()))::int AS sent_this_hour,
         min(e.sent_at) FILTER (WHERE e.status = 'sent') AS first_sent_at,
         max(e.sent_at) FILTER (WHERE e.status = 'sent') AS last_sent_at,
         min(e.next_attempt_at) FILTER (WHERE e.status IN ('scheduled', 'rate_limited', 'sending')) AS next_send_at,
         min(e.next_attempt_at) FILTER (WHERE e.status = 'rate_limited') AS resumes_at
  FROM campaigns c
  JOIN senders s ON s.id = c.sender_id
  LEFT JOIN emails e ON e.campaign_id = c.id
  WHERE c.user_id = $1 %FILTER%
  GROUP BY c.id, s.name, s.email`;

export async function listCampaigns(params: {
  userId: string;
  search?: string;
  limit: number;
  offset: number;
}): Promise<{ items: CampaignProgress[]; total: number }> {
  const values: unknown[] = [params.userId];
  let filter = "";
  if (params.search) {
    values.push(`%${params.search}%`);
    filter = `AND c.subject ILIKE $${values.length}`;
  }
  const [items, count] = await Promise.all([
    pool.query<CampaignProgress>(
      `${PROGRESS_SQL.replace("%FILTER%", filter)} ORDER BY c.created_at DESC LIMIT ${params.limit} OFFSET ${params.offset}`,
      values,
    ),
    pool.query<{ count: string }>(`SELECT count(*) FROM campaigns c WHERE c.user_id = $1 ${filter}`, values),
  ]);
  return { items: items.rows, total: Number(count.rows[0].count) };
}

export async function getCampaign(userId: string, id: string): Promise<CampaignProgress | undefined> {
  const { rows } = await pool.query<CampaignProgress>(PROGRESS_SQL.replace("%FILTER%", "AND c.id = $2"), [userId, id]);
  return rows[0];
}
