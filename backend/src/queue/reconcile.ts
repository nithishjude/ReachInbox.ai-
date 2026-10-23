import { listPendingForReconcile } from "../db/emails.repo";
import { redis } from "../lib/redis";
import { emailQueue, enqueueEmails, jobIdFor } from "./queue";

/**
 * Safety net for one specific failure: Redis LOST data (e.g. its volume was wiped) while Postgres
 * still has emails waiting to be sent.
 *
 * It does NOT re-seed the queue on every start. On a normal restart BullMQ's delayed jobs are
 * still in Redis (AOF persistence), every pending email already has its job, and this restores
 * nothing. Only emails whose job is genuinely missing are re-added, with the same deterministic
 * job id, and the worker's status check / atomic claim still guarantees a single send.
 */
export async function reconcileQueue(): Promise<void> {
  // Only one process runs it when several API instances boot together.
  const gotLock = await redis.set("lock:reconcile", String(process.pid), "PX", 60_000, "NX");
  if (!gotLock) return;
  try {
    const pending = await listPendingForReconcile();
    const missing = [];
    for (const email of pending) {
      if (!(await emailQueue.getJob(jobIdFor(email.id)))) missing.push(email);
    }
    if (missing.length === 0) {
      console.log(`[reconcile] all ${pending.length} pending email(s) are already queued, nothing to restore`);
      return;
    }
    await enqueueEmails(missing.map((m) => ({ emailId: m.id, runAt: new Date(m.next_attempt_at) })));
    console.warn(`[reconcile] restored ${missing.length} job(s) missing from Redis (Redis data was lost)`);
  } finally {
    await redis.del("lock:reconcile");
  }
}
