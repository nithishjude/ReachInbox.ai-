import { DelayedError, Job, UnrecoverableError, Worker } from "bullmq";
import os from "os";
import { env } from "../config/env";
import { claimForSending, getEmailForSend, markFailed, markSent, markThrottled, releaseForRetry } from "../db/emails.repo";
import { createRedis } from "../lib/redis";
import { closeTransports, getTransport } from "../mail/senders";
import { sendEmail } from "../mail/sendEmail";
import { reserveSendSlot } from "../rateLimiter/hourlyLimiter";
import { EMAIL_QUEUE, EmailJobData } from "./queue";

/** Job data once the rate limiter has handed out a send slot. */
interface ReservedJobData extends EmailJobData {
  reservedAt?: number;
}

// A row left in 'sending' longer than this belongs to a worker that died mid-send.
const STALE_SENDING_MS = 2 * 60_000;
// Jobs rescheduled into the next window are offset by their position in the campaign so they
// wake up in the original order instead of all at the same millisecond.
const ORDER_SPREAD_MS = 25;
// Waking up this close to a reserved slot counts as "on time".
const SLOT_TOLERANCE_MS = 250;
// Identifies this worker instance in the DB (emails.processed_by).
export const WORKER_ID = `${os.hostname()}:${process.pid}`;

async function postpone(job: Job<ReservedJobData>, token: string | undefined, runAt: number, data: ReservedJobData) {
  await job.updateData(data);
  await job.moveToDelayed(runAt, token);
  // Tells BullMQ the job was intentionally moved back to "delayed": no attempt is consumed.
  throw new DelayedError();
}

export async function processEmailJob(job: Job<ReservedJobData>, token?: string): Promise<string> {
  const { emailId } = job.data;
  const email = await getEmailForSend(emailId);

  // ---- 1. Idempotency: the DB, not the queue, decides whether this email still needs sending.
  if (!email) return "skipped: email no longer exists";
  if (email.status === "sent" || email.status === "failed") return `skipped: already ${email.status}`;
  if (email.status === "sending") {
    const age = Date.now() - new Date(email.updated_at).getTime();
    if (age < STALE_SENDING_MS) return "skipped: another worker is sending it";
    // The previous worker crashed between "claim" and "mark sent". We can't know whether SMTP
    // accepted the message, so we choose at-most-once delivery: never risk a duplicate.
    await markFailed(emailId, "Worker stopped mid-send; not retried to avoid a duplicate email");
    return "failed: interrupted mid-send";
  }

  // ---- 2. Throughput controls (Redis-backed, shared by every worker instance).
  const hasSlot = job.data.reservedAt !== undefined && Date.now() >= job.data.reservedAt - SLOT_TOLERANCE_MS;
  if (!hasSlot) {
    const r = await reserveSendSlot({ senderId: email.sender_id, campaignId: email.campaign_id, campaignHourlyLimit: email.hourly_limit });

    if (r.kind === "limited") {
      const runAt = r.retryAt + email.seq * ORDER_SPREAD_MS;
      await markThrottled(emailId, "rate_limited", new Date(runAt));
      console.log(`[worker] ${email.recipient}: ${r.scope} hourly limit reached -> ${new Date(runAt).toISOString()}`);
      await postpone(job, token, runAt, { emailId });
    }

    if (r.kind === "reserved" && r.at - r.now > SLOT_TOLERANCE_MS) {
      // Slot is in the future because of the min-gap between sends: sleep in Redis, not in the worker.
      await markThrottled(emailId, email.status === "rate_limited" ? "rate_limited" : "scheduled", new Date(r.at));
      await postpone(job, token, r.at, { emailId, reservedAt: r.at });
    }
  }

  // ---- 3. Claim the row (atomic compare-and-set), then send.
  const claimed = await claimForSending(emailId);
  if (!claimed) return "skipped: claimed by another worker";

  try {
    const { transport, sender } = await getTransport(claimed.sender_id);
    const result = await sendEmail(transport, sender, claimed);
    await markSent(emailId, result.messageId, result.previewUrl, WORKER_ID);
    console.log(`[worker] sent ${claimed.recipient} from ${sender.email} ${result.previewUrl ?? ""}`);
    return `sent ${result.messageId}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const responseCode = (err as { responseCode?: number }).responseCode;
    const permanent = typeof responseCode === "number" && responseCode >= 500;
    const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

    if (permanent || lastAttempt) {
      await markFailed(emailId, message);
      throw new UnrecoverableError(message);
    }
    // Transient error (network, 4xx): SMTP did not accept the message, so a retry can't duplicate it.
    await releaseForRetry(emailId, message);
    await job.updateData({ emailId }); // the retry must go through the rate limiter again
    throw err;
  }
}

export function startWorker(): Worker<ReservedJobData> {
  const worker = new Worker<ReservedJobData>(EMAIL_QUEUE, processEmailJob, {
    connection: createRedis("worker"),
    concurrency: env.WORKER_CONCURRENCY,
    // If a worker dies, its active jobs are detected as stalled and picked up again;
    // the DB status check above makes that re-run harmless.
    stalledInterval: 30_000,
    maxStalledCount: 2,
    drainDelay: env.WORKER_DRAIN_DELAY_SEC,
  });

  worker.on("failed", (job, err) => {
    if (job) console.warn(`[worker] job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`);
  });
  worker.on("error", (err) => console.error("[worker] error", err.message));

  console.log(
    `[worker] ${WORKER_ID} started: concurrency=${env.WORKER_CONCURRENCY}, min gap=${env.MIN_DELAY_BETWEEN_SENDS_MS}ms/sender, ` +
      `max ${env.MAX_EMAILS_PER_HOUR_PER_SENDER}/hour/sender`,
  );
  return worker;
}

export async function stopWorker(worker: Worker): Promise<void> {
  // close() waits for in-flight sends to finish, so a graceful restart never interrupts an SMTP call.
  await worker.close();
  closeTransports();
}
