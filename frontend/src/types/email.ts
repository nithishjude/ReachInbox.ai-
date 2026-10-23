export type EmailStatus = "scheduled" | "rate_limited" | "sending" | "sent" | "failed";
export type ListKind = "scheduled" | "sent";

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
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

export type EmailStats = Record<ListKind, number>;

export interface Sender {
  id: string;
  name: string;
  email: string;
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
  recipients: string[];
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
