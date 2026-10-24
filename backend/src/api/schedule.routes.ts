import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import {
  createCampaign,
  deleteEmail,
  EmailStatus,
  getEmailForUser,
  getStats,
  listEmails,
  Lead,
  ListKind,
  resetFailedForRetry,
} from "../db/emails.repo";
import { listSenders } from "../mail/senders";
import { emailQueue, enqueueEmails, jobIdFor, requeueEmails } from "../queue/queue";
import { getSenderUsage } from "../rateLimiter/hourlyLimiter";
import { asyncHandler } from "./asyncHandler";

export const emailsRouter = Router();

const MAX_RECIPIENTS = 10_000;
const emailSchema = z.string().trim().toLowerCase().email();

const scheduleSchema = z.object({
  senderId: z.string().uuid().optional(),
  subject: z.string().trim().min(1, "Subject is required").max(300),
  body: z.string().trim().min(1, "Body is required").max(50_000),
  // Plain addresses, or { email, fields } where fields are the lead's CSV columns ({{variables}}).
  recipients: z
    .array(z.union([z.string(), z.object({ email: z.string(), fields: z.record(z.string().max(500)).optional() })]))
    .min(1, "Add at least one recipient")
    .max(MAX_RECIPIENTS),
  startAt: z.coerce.date().optional(),
  delayBetweenEmailsSec: z.coerce
    .number()
    .min(0)
    .max(24 * 3600)
    .default(0),
  hourlyLimit: z.coerce.number().int().min(1).max(100_000).optional(),
});

/**
 * POST /api/emails/schedule
 * Persists a campaign + one row per recipient, then enqueues one delayed BullMQ job per row.
 * The DB write commits first; if enqueueing were interrupted, reconcileQueue() re-adds the
 * missing jobs on next boot (job ids are deterministic, so nothing is duplicated).
 */
emailsRouter.post(
  "/schedule",
  asyncHandler(async (req, res) => {
    const parsed = scheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues });
      return;
    }
    const input = parsed.data;

    // Validate + de-duplicate recipients (case-insensitive), keeping first-seen order and fields.
    const leads = new Map<string, Lead>();
    const invalid: string[] = [];
    for (const raw of input.recipients) {
      const { email, fields } = typeof raw === "string" ? { email: raw, fields: undefined } : raw;
      const r = emailSchema.safeParse(email);
      if (!r.success) invalid.push(email);
      else if (!leads.has(r.data)) leads.set(r.data, { email: r.data, fields });
    }
    const recipients = [...leads.values()];
    if (recipients.length === 0) {
      res.status(400).json({ error: "No valid email addresses found", invalid });
      return;
    }

    const senders = await listSenders();
    const sender = input.senderId ? senders.find((s) => s.id === input.senderId) : senders[0];
    if (!sender) {
      res.status(400).json({ error: "Unknown sender" });
      return;
    }

    // A start time in the past is a client error (a minute of clock skew is tolerated and means "now").
    if (input.startAt && input.startAt.getTime() < Date.now() - 60_000) {
      res.status(400).json({ error: "startAt cannot be in the past" });
      return;
    }
    const startAt = input.startAt && input.startAt.getTime() > Date.now() ? input.startAt : new Date();
    const { campaignId, emails } = await createCampaign({
      userId: req.user!.id,
      senderId: sender.id,
      subject: input.subject,
      body: input.body,
      startAt,
      delayMs: Math.round(input.delayBetweenEmailsSec * 1000),
      hourlyLimit: input.hourlyLimit ?? env.MAX_EMAILS_PER_HOUR_PER_SENDER,
      recipients,
    });

    await enqueueEmails(emails.map((e) => ({ emailId: e.id, runAt: new Date(e.next_attempt_at) })));

    res.status(201).json({
      campaignId,
      scheduled: emails.length,
      duplicatesRemoved: input.recipients.length - invalid.length - recipients.length,
      invalid,
      sender,
      firstSendAt: emails[0].next_attempt_at,
      lastSendAt: emails[emails.length - 1].next_attempt_at,
    });
  }),
);

const STATUSES = ["scheduled", "rate_limited", "sending", "sent", "failed"] as const satisfies readonly EmailStatus[];

const listQuery = z.object({
  search: z.string().trim().max(200).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const listHandler = (kind: ListKind) =>
  asyncHandler(async (req, res) => {
    const q = listQuery.parse(req.query);
    const { items, total } = await listEmails({
      userId: req.user!.id,
      kind,
      status: q.status,
      search: q.search || undefined,
      limit: q.pageSize,
      offset: (q.page - 1) * q.pageSize,
    });
    res.json({ items, total, page: q.page, pageSize: q.pageSize });
  });

emailsRouter.get("/scheduled", listHandler("scheduled"));
emailsRouter.get("/sent", listHandler("sent"));

emailsRouter.get(
  "/stats",
  asyncHandler(async (req, res) => {
    res.json(await getStats(req.user!.id));
  }),
);

/** POST /api/emails/retry  { ids: string[] } or { all: true } — re-queue failed emails now. */
const retrySchema = z.union([z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }), z.object({ all: z.literal(true) })]);

emailsRouter.post(
  "/retry",
  asyncHandler(async (req, res) => {
    const parsed = retrySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Provide { ids: [...] } or { all: true }" });
      return;
    }
    const rows = await resetFailedForRetry(req.user!.id, "all" in parsed.data ? "all" : parsed.data.ids);
    await requeueEmails(rows.map((r) => ({ emailId: r.id, runAt: new Date(r.next_attempt_at) })));
    res.json({ retried: rows.length });
  }),
);

emailsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    const email = await getEmailForUser(req.user!.id, req.params.id);
    if (!email) {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    res.json({ ...email, max_attempts: env.SEND_MAX_ATTEMPTS });
  }),
);

/** DELETE /api/emails/:id — cancel a scheduled email or remove one from history. */
emailsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    const result = await deleteEmail(req.user!.id, req.params.id);
    if (result === "not_found") {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    if (result === "sending") {
      res.status(409).json({ error: "This email is being sent right now and can't be deleted" });
      return;
    }
    // Best effort: drop the queued job too (the worker would skip it anyway).
    // Also drop the queued job. If that fails (e.g. it is locked), the worker finds no row and skips it.
    const job = await emailQueue.getJob(jobIdFor(req.params.id));
    await job?.remove().catch((err: Error) => console.warn(`[api] could not remove job ${job.id}; worker will skip it:`, err.message));
    res.json({ ok: true });
  }),
);

export const metaRouter = Router();

/** Senders for the "From" dropdown + server-side limits so the UI can show sensible defaults. */
metaRouter.get(
  "/senders",
  asyncHandler(async (_req, res) => {
    const senders = await listSenders();
    const withUsage = await Promise.all(senders.map(async (s) => ({ ...s, usage: await getSenderUsage(s.id) })));
    res.json({
      senders: withUsage,
      limits: {
        maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        minDelayBetweenSendsMs: env.MIN_DELAY_BETWEEN_SENDS_MS,
        workerConcurrency: env.WORKER_CONCURRENCY,
      },
    });
  }),
);
