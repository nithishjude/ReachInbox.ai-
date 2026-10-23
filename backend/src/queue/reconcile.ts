import { listPendingForReconcile } from "../db/emails.repo";
import { redis } from "../lib/redis";
import { enqueueEmails } from "./queue";

/**
 * Safety net for the case where Redis itself lost data (e.g. volume wiped) while Postgres still
 * has pending emails. In the normal restart case BullMQ's delayed jobs are already in Redis and
 * this is a no-op: re-adding a job with an existing jobId is ignored by BullMQ, so this can
 * never create a duplicate job. The worker's DB status check covers everything else.
 */
export async function reconcileQueue(): Promise<void> {
  // Only one process runs it when several API instances boot together.
  const gotLock = await redis.set("lock:reconcile", String(process.pid), "PX", 60_000, "NX");
  if (!gotLock) return;
  try {
    const pending = await listPendingForReconcile();
    if (pending.length === 0) return;
    await enqueueEmails(pending.map((p) => ({ emailId: p.id, runAt: new Date(p.next_attempt_at) })));
    console.log(`[reconcile] verified ${pending.length} pending email(s) are queued`);
  } finally {
    await redis.del("lock:reconcile");
  }
}
