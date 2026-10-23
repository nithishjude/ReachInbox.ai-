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

export interface PublicSender extends Pick<SenderRow, "id" | "name" | "email"> {
  /** true = real SMTP provider (e.g. Gmail) that delivers to real inboxes; false = Ethereal test inbox. */
  real: boolean;
}

interface SmtpServer {
  host: string;
  port: number;
  secure: boolean;
}

const ETHEREAL: SmtpServer = { host: "smtp.ethereal.email", port: 587, secure: false };
/** Senders with this host never touch the network (proof/benchmark scripts only). */
export const DRY_RUN_HOST = "dry-run";
const SENDER_NAMES = ["Oliver Brooks", "Maya Patel", "Liam Carter", "Sofia Reyes", "Noah Kim"];

const etherealSendersSchema = z.array(z.object({ name: z.string().min(1), user: z.string().email(), pass: z.string().min(1) }));

// Real providers. Defaults are Gmail's (SSL on 465); `pass` must be a Gmail App Password.
const smtpSendersSchema = z.array(
  z.object({
    name: z.string().min(1),
    user: z.string().email(),
    pass: z.string().min(1),
    host: z.string().min(1).default("smtp.gmail.com"),
    port: z.number().int().positive().default(465),
    secure: z.boolean().default(true),
  }),
);

async function upsertSender(name: string, user: string, pass: string, server: SmtpServer): Promise<void> {
  await pool.query(
    `INSERT INTO senders (name, email, smtp_host, smtp_port, smtp_secure, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $4, $5, $2, $6)
     ON CONFLICT (email) DO UPDATE
       SET name = EXCLUDED.name, smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port,
           smtp_secure = EXCLUDED.smtp_secure, smtp_pass = EXCLUDED.smtp_pass`,
    [name, user, server.host, server.port, server.secure, pass],
  );
}

/**
 * Makes sure the configured SMTP senders exist.
 * - Ethereal (test inboxes, the default): ETHEREAL_SENDERS (JSON) if provided, otherwise
 *   ETHEREAL_SENDER_COUNT accounts are created once and persisted, so restarts reuse them.
 * - SMTP_SENDERS (optional JSON): real providers such as Gmail, which deliver to real inboxes.
 */
export async function ensureSenders(): Promise<void> {
  if (env.ETHEREAL_SENDERS) {
    for (const s of etherealSendersSchema.parse(JSON.parse(env.ETHEREAL_SENDERS))) await upsertSender(s.name, s.user, s.pass, ETHEREAL);
  } else {
    const { rows } = await pool.query<{ count: string }>("SELECT count(*) FROM senders WHERE smtp_host = $1", [ETHEREAL.host]);
    const existing = Number(rows[0].count);
    for (let i = 0; i < env.ETHEREAL_SENDER_COUNT - existing; i++) {
      const account = await nodemailer.createTestAccount();
      await upsertSender(SENDER_NAMES[(existing + i) % SENDER_NAMES.length], account.user, account.pass, ETHEREAL);
      console.log(`[senders] created Ethereal account ${account.user} (credentials saved in the senders table)`);
    }
  }

  if (env.SMTP_SENDERS) {
    for (const s of smtpSendersSchema.parse(JSON.parse(env.SMTP_SENDERS))) {
      await upsertSender(s.name, s.user, s.pass, s);
      console.log(`[senders] real SMTP sender ready: ${s.user} via ${s.host}:${s.port}`);
    }
  }
}

export async function listSenders(): Promise<PublicSender[]> {
  const { rows } = await pool.query<PublicSender>(
    `SELECT id, name, email, smtp_host <> $1 AS real FROM senders WHERE smtp_host <> $2
     ORDER BY (smtp_host <> $1), created_at, email`,
    [ETHEREAL.host, DRY_RUN_HOST],
  );
  return rows;
}

// One pooled SMTP transport per sender, shared by all concurrent jobs in this process.
const transports = new Map<string, Transporter>();

export async function getTransport(senderId: string): Promise<{ transport: Transporter; sender: SenderRow }> {
  const { rows } = await pool.query<SenderRow>("SELECT * FROM senders WHERE id = $1", [senderId]);
  const sender = rows[0];
  if (!sender) throw new Error(`Sender ${senderId} not found`);

  let transport = transports.get(senderId);
  if (!transport && sender.smtp_host === DRY_RUN_HOST) {
    // Used by scripts/multiWorkerProof.ts: renders the message but sends nothing over the network.
    transport = nodemailer.createTransport({ jsonTransport: true });
    transports.set(senderId, transport);
  }
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
