import { randomUUID } from "crypto";
import { pool } from "../src/db/client";
import { createCampaign } from "../src/db/emails.repo";

/** A user + sender pair unique to the calling test (no cross-test interference). */
export async function seedUserAndSender(): Promise<{ userId: string; senderId: string; senderEmail: string }> {
  const tag = randomUUID().slice(0, 8);
  const {
    rows: [user],
  } = await pool.query<{ id: string }>(`INSERT INTO users (google_sub, email, name) VALUES ($1, $2, 'Test User') RETURNING id`, [
    `sub-${tag}`,
    `user-${tag}@example.com`,
  ]);
  const senderEmail = `sender-${tag}@ethereal.email`;
  const {
    rows: [sender],
  } = await pool.query<{ id: string }>(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_user, smtp_pass) VALUES ('Test Sender', $1, 'smtp.test', 587, $1, 'x') RETURNING id`,
    [senderEmail],
  );
  return { userId: user.id, senderId: sender.id, senderEmail };
}

export async function seedCampaign(opts: { count: number; hourlyLimit: number; startAt?: Date }) {
  const { userId, senderId, senderEmail } = await seedUserAndSender();
  const recipients = Array.from({ length: opts.count }, (_, i) => ({ email: `lead${i}-${randomUUID().slice(0, 6)}@example.com` }));
  const { campaignId, emails } = await createCampaign({
    userId,
    senderId,
    subject: "Test subject",
    body: "Test body",
    startAt: opts.startAt ?? new Date(),
    delayMs: 0,
    hourlyLimit: opts.hourlyLimit,
    recipients,
  });
  return { userId, senderId, senderEmail, campaignId, emailIds: emails.map((e) => e.id) };
}

export async function statusOf(emailId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>("SELECT status FROM emails WHERE id = $1", [emailId]);
  return rows[0]?.status;
}
