import { Queue } from "bullmq";
import { env } from "../config/env";
import { redis } from "../lib/redis";

export const EMAIL_QUEUE = "email-send";

export interface EmailJobData {
  emailId: string;
}

/**
 * BullMQ job ids are derived from the email row id. BullMQ refuses to add a job whose id
 * already exists, so enqueuing the same email twice (retry of the API call, reconciliation
 * after a restart...) is a no-op instead of a duplicate send.
 */
export const jobIdFor = (emailId: string) => `email-${emailId}`;

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: redis,
  defaultJobOptions: {
    attempts: env.SEND_MAX_ATTEMPTS,
    backoff: { type: "exponential", delay: 30_000 },
    // Keep a bounded history for the dashboard; the DB keeps the permanent record.
    removeOnComplete: { age: 24 * 3600, count: 5000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  },
});

export interface EnqueueItem {
  emailId: string;
  runAt: Date;
}

const ADD_BULK_CHUNK = 500;

/** Enqueue delayed jobs in chunks so 1000+ emails don't produce one giant Redis pipeline. */
export async function enqueueEmails(items: EnqueueItem[]): Promise<void> {
  const now = Date.now();
  for (let i = 0; i < items.length; i += ADD_BULK_CHUNK) {
    const chunk = items.slice(i, i + ADD_BULK_CHUNK);
    await emailQueue.addBulk(
      chunk.map(({ emailId, runAt }) => ({
        name: "send-email",
        data: { emailId },
        opts: { jobId: jobIdFor(emailId), delay: Math.max(0, runAt.getTime() - now) },
      })),
    );
  }
}
