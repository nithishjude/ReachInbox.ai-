import nodemailer, { Transporter } from "nodemailer";
import { z } from "zod";
import { env } from "../config/env";
import { pool } from "../db/client";

export interface SenderRow {
  id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass: string;
}

export type PublicSender = Pick<SenderRow, "id" | "name" | "email">;

const ETHEREAL = { host: "smtp.ethereal.email", port: 587, secure: false };
const SENDER_NAMES = ["Oliver Brooks", "Maya Patel", "Liam Carter", "Sofia Reyes", "Noah Kim"];

const envSendersSchema = z.array(z.object({ name: z.string().min(1), user: z.string().email(), pass: z.string().min(1) }));

async function insertSender(name: string, user: string, pass: string): Promise<void> {
  await pool.query(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $2, $6)
     ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, smtp_pass = EXCLUDED.smtp_pass`,
    [name, user, ETHEREAL.host, ETHEREAL.port, ETHEREAL.secure, pass],
  );
}

/**
 * Makes sure at least one SMTP sender exists.
 * - ETHEREAL_SENDERS (JSON) wins if provided.
 * - Otherwise Ethereal test accounts are created once and persisted, so restarts reuse them
 *   (and previously sent messages stay viewable in the same Ethereal inboxes).
 */
export async function ensureSenders(): Promise<void> {
  if (env.ETHEREAL_SENDERS) {
    const parsed = envSendersSchema.parse(JSON.parse(env.ETHEREAL_SENDERS));
    for (const s of parsed) await insertSender(s.name, s.user, s.pass);
    return;
  }

  const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM senders");
  const missing = env.ETHEREAL_SENDER_COUNT - Number(rows[0].count);
  for (let i = 0; i < missing; i++) {
    const account = await nodemailer.createTestAccount();
    const name = SENDER_NAMES[(Number(rows[0].count) + i) % SENDER_NAMES.length];
    await insertSender(name, account.user, account.pass);
    console.log(`[senders] created Ethereal account ${account.user} (pass: ${account.pass})`);
  }
}

export async function listSenders(): Promise<PublicSender[]> {
  const { rows } = await pool.query<PublicSender>("SELECT id, name, email FROM senders ORDER BY created_at, email");
  return rows;
}

// One pooled SMTP transport per sender, shared by all concurrent jobs in this process.
const transports = new Map<string, Transporter>();

export async function getTransport(senderId: string): Promise<{ transport: Transporter; sender: SenderRow }> {
  const { rows } = await pool.query<SenderRow>("SELECT * FROM senders WHERE id = $1", [senderId]);
  const sender = rows[0];
  if (!sender) throw new Error(`Sender ${senderId} not found`);

  let transport = transports.get(senderId);
  if (!transport) {
    transport = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_secure,
      auth: { user: sender.smtp_user, pass: sender.smtp_pass },
      pool: true,
      maxConnections: 3,
    });
    transports.set(senderId, transport);
  }
  return { transport, sender };
}

export function closeTransports(): void {
  for (const t of transports.values()) t.close();
  transports.clear();
}
