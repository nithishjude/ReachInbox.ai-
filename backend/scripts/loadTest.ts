/**
 * Schedules N emails for "right now" for an existing user, to watch the min-gap and hourly
 * limit behave under load (see /admin/queues and the Scheduled tab).
 *
 *   npm run load-test -- <your-login-email> [count=1000] [hourlyLimit=50]
 *
 * Recipients are @example.com addresses; Ethereal never delivers anything for real.
 */
import { pool } from "../src/db/client";
import { createCampaign } from "../src/db/emails.repo";
import { redis } from "../src/lib/redis";
import { listSenders } from "../src/mail/senders";
import { emailQueue, enqueueEmails } from "../src/queue/queue";

async function main() {
  const [userEmail, countArg = "1000", limitArg = "50"] = process.argv.slice(2);
  if (!userEmail) throw new Error("usage: npm run load-test -- <user-email> [count] [hourlyLimit]");

  const { rows: [user] } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [userEmail]);
  if (!user) throw new Error(`No user ${userEmail}; log in through the dashboard first`);
  const [sender] = await listSenders();
  if (!sender) throw new Error("No senders; start the API once first");

  const count = Number(countArg);
  const recipients = Array.from({ length: count }, (_, i) => ({ email: `lead${i + 1}@example.com`, fields: { first_name: `Lead ${i + 1}` } }));
  const t0 = Date.now();
  const { campaignId, emails } = await createCampaign({
    userId: user.id,
    senderId: sender.id,
    subject: `Load test (${count} emails)`,
    body: "Hello from the ReachInbox scheduler load test.",
    startAt: new Date(),
    delayMs: 0,
    hourlyLimit: Number(limitArg),
    recipients,
  });
  await enqueueEmails(emails.map((e) => ({ emailId: e.id, runAt: new Date(e.next_attempt_at) })));
  console.log(`campaign ${campaignId}: ${emails.length} emails persisted + enqueued in ${Date.now() - t0} ms`);
  console.log(`expect: 1 send / MIN_DELAY_BETWEEN_SENDS_MS from ${sender.email}, ${limitArg}/hour, rest moved to next hour windows`);

  await emailQueue.close();
  await redis.quit();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
