export type EmailStatus = "scheduled" | "rate_limited" | "sending" | "sent" | "failed";
export type ListKind = "scheduled" | "sent";
export type DashboardTab = ListKind | "campaigns";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  /** Allowed to open the BullMQ dashboard (ADMIN_EMAILS). */
  isAdmin: boolean;
}

export interface EmailItem {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduled_at: string;
  next_attempt_at: string;
  sent_at: string | null;
  error: string | null;
  preview_url: string | null;
  sender_name: string;
  sender_email: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface EmailStats extends Record<ListKind, number> {
  byStatus: Record<EmailStatus, number>;
  sentLastHour: number;
  campaigns: number;
}

export interface CampaignProgress {
  id: string;
  subject: string;
  sender_name: string;
  sender_email: string;
  created_at: string;
  start_at: string;
  delay_ms: number;
  hourly_limit: number;
  total: number;
  counts: Record<EmailStatus, number>;
  sent_this_hour: number;
  first_sent_at: string | null;
  last_sent_at: string | null;
  next_send_at: string | null;
  resumes_at: string | null;
}

export interface CampaignDetail {
  campaign: CampaignProgress;
  emails: EmailItem[];
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  /** Real SMTP provider (delivers to real inboxes) vs Ethereal test inbox. */
  real: boolean;
  usage: { window: number; used: number; limit: number };
}

export interface SendersResponse {
  senders: Sender[];
  limits: {
    maxEmailsPerHourPerSender: number;
    minDelayBetweenSendsMs: number;
    workerConcurrency: number;
  };
}

export interface ScheduleRequest {
  senderId?: string;
  subject: string;
  body: string;
  /** Plain addresses, or leads with CSV columns for {{variables}}. */
  recipients: (string | { email: string; fields: Record<string, string> })[];
  startAt: string;
  delayBetweenEmailsSec: number;
  hourlyLimit: number;
}

export interface ScheduleResponse {
  campaignId: string;
  scheduled: number;
  duplicatesRemoved: number;
  invalid: string[];
  sender: Pick<Sender, "id" | "name" | "email">;
  firstSendAt: string;
  lastSendAt: string;
}
