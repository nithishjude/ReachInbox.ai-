/**
 * Proof that rate limiting and idempotency hold across MULTIPLE worker processes.
 *
 *   npm run proof:workers -- <your-login-email> [emails=60] [hourlyLimit=20] [workers=3]
 *
 * 1. Schedules <emails> emails for "now" with a campaign limit of <hourlyLimit>/hour,
 *    from a dry-run sender (messages are rendered but never leave the machine).
 * 2. Starts <workers> separate worker processes (own PIDs, own Redis connections).
 * 3. Waits, then checks from Postgres:
 *      - exactly <hourlyLimit> sent, spread over several workers
 *      - the rest rate-limited into the next hour window (none dropped, none failed)
 *      - no email sent twice
 * 4. Stops the workers and deletes the proof campaign (pass --keep to keep it).
 *
 * If your API is running with its in-process worker, it joins in as one more instance.
 */
import { ChildProcess, spawn } from "child_process";
import path from "path";
import { pool } from "../src/db/client";
import { createCampaign } from "../src/db/emails.repo";
import { migrate } from "../src/db/migrate";
import { redis } from "../src/lib/redis";
import { DRY_RUN_HOST } from "../src/mail/senders";
import { emailQueue, enqueueEmails } from "../src/queue/queue";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const keep = process.argv.includes("--keep");
  const [userEmail, countArg = "60", limitArg = "20", workersArg = "3"] = args;
  if (!userEmail) throw new Error("usage: npm run proof:workers -- <user-email> [emails] [hourlyLimit] [workers]");
  const [count, limit, workerCount] = [countArg, limitArg, workersArg].map(Number);

  await migrate();
  const {
    rows: [user],
  } = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [userEmail]);
  if (!user) throw new Error(`No user ${userEmail}; log in through the dashboard first`);

  const {
    rows: [sender],
  } = await pool.query<{ id: string }>(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ('Proof Sender', 'proof@dry-run.local', $1, 0, 'proof', 'proof')
     ON CONFLICT (email) DO UPDATE SET smtp_host = EXCLUDED.smtp_host RETURNING id`,
    [DRY_RUN_HOST],
  );

  // 1. Start the workers first so they all compete for the same jobs.
  const tsxCli = require.resolve("tsx/cli");
  const workers: ChildProcess[] = [];
  for (let i = 0; i < workerCount; i++) {
    const child = spawn(process.execPath, [tsxCli, path.join(__dirname, "../src/workerMain.ts")], {
      env: { ...process.env, WORKER_CONCURRENCY: "5", MIN_DELAY_BETWEEN_SENDS_MS: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line.includes("started")) console.log(`  worker ${i + 1}: ${line.replace("[worker] ", "")}`);
    });
    workers.push(child);
  }
  console.log(`Started ${workerCount} worker processes, waiting for them to connect...`);
  await sleep(6000);

  // 2. Schedule the burst.
  const tag = Date.now().toString(36);
  const { campaignId, emails } = await createCampaign({
    userId: user.id,
    senderId: sender.id,
    subject: `Multi-worker proof ${tag}`,
    body: "Rate limiting must hold across worker processes.",
    startAt: new Date(),
    delayMs: 0,
    hourlyLimit: limit,
    recipients: Array.from({ length: count }, (_, i) => ({ email: `proof${i + 1}-${tag}@example.com` })),
  });
  await enqueueEmails(emails.map((e) => ({ emailId: e.id, runAt: new Date(e.next_attempt_at) })));
  console.log(`Scheduled ${count} emails (campaign limit ${limit}/hour).`);

  // 3. Wait until every email is either sent or rescheduled.
  const deadline = Date.now() + 120_000;
  let stats: { status: string; n: number }[] = [];
  while (Date.now() < deadline) {
    ({ rows: stats } = await pool.query("SELECT status, count(*)::int AS n FROM emails WHERE campaign_id = $1 GROUP BY status", [
      campaignId,
    ]));
    const settled = stats.filter((s) => s.status === "sent" || s.status === "rate_limited").reduce((a, s) => a + s.n, 0);
    if (settled === count) break;
    await sleep(1000);
  }

  const { rows: byWorker } = await pool.query<{ processed_by: string; n: number }>(
    "SELECT processed_by, count(*)::int AS n FROM emails WHERE campaign_id = $1 AND status = 'sent' GROUP BY 1 ORDER BY 1",
    [campaignId],
  );
  const {
    rows: [dups],
  } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM (SELECT message_id FROM emails WHERE campaign_id = $1 AND message_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) d",
    [campaignId],
  );
  const {
    rows: [limited],
  } = await pool.query<{ earliest: Date | null }>(
    "SELECT min(next_attempt_at) AS earliest FROM emails WHERE campaign_id = $1 AND status = 'rate_limited'",
    [campaignId],
  );

  const sent = stats.find((s) => s.status === "sent")?.n ?? 0;
  const rateLimited = stats.find((s) => s.status === "rate_limited")?.n ?? 0;
  const nextHour = (Math.floor(Date.now() / 3_600_000) + 1) * 3_600_000;

  console.log("\n=== Result ===");
  console.log(`Sent:          ${sent}  (limit ${limit})`);
  for (const w of byWorker) console.log(`  by ${w.processed_by}: ${w.n}`);
  console.log(`Rate limited:  ${rateLimited}  (rescheduled to ${limited.earliest?.toISOString() ?? "-"})`);
  console.log(
    `Other states:  ${
      stats
        .filter((s) => !["sent", "rate_limited"].includes(s.status))
        .map((s) => `${s.status}=${s.n}`)
        .join(", ") || "none"
    }`,
  );
  console.log(`Duplicates:    ${dups.n}`);

  const checks: [string, boolean][] = [
    [`exactly ${limit} sent across all workers`, sent === limit],
    ["work was shared by more than one worker process", byWorker.length > 1],
    [`remaining ${count - limit} rescheduled, none dropped or failed`, rateLimited === count - limit],
    ["rescheduled into the next hour window", !!limited.earliest && limited.earliest.getTime() >= nextHour],
    ["no email sent twice", dups.n === 0],
  ];
  console.log("");
  for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);

  // 4. Clean up.
  for (const w of workers) w.kill();
  if (!keep) {
    await pool.query("DELETE FROM campaigns WHERE id = $1", [campaignId]);
    console.log("\n(proof campaign deleted; pass --keep to keep it in the dashboard)");
  }
  await emailQueue.close();
  await redis.quit();
  await pool.end();
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
