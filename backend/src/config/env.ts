import "dotenv/config";
import { z } from "zod";

// nodemailer memoises createTestAccount() unless this is off (read once at import time), which would
// make every "new" Ethereal sender the same account. This module is imported before nodemailer.
process.env.ETHEREAL_CACHE ??= "false";

const bool = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : ["1", "true", "yes"].includes(v.toLowerCase())));

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default("redis://localhost:6379"),

  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  GOOGLE_REDIRECT_URI: z.string().url().default("http://localhost:4000/api/auth/google/callback"),

  ETHEREAL_SENDER_COUNT: z.coerce.number().int().min(1).max(10).default(3),
  ETHEREAL_SENDERS: z.string().optional(),
  // Ethereal accepts SMTP on 587 and 2525. Use 2525 on hosts that block standard SMTP ports (e.g. Render free tier).
  ETHEREAL_SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SENDERS: z.string().optional(),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MIN_DELAY_BETWEEN_SENDS_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(200),
  SEND_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  // Seconds an idle worker waits for new jobs per Redis call. Raise it (e.g. 30) on hosted Redis
  // plans that bill per command, such as Upstash's free tier; delayed jobs still fire on time.
  WORKER_DRAIN_DELAY_SEC: z.coerce.number().int().min(1).max(300).default(5),

  RUN_WORKER_IN_API: bool,

  // Comma-separated emails allowed to open the BullMQ dashboard (/admin/queues).
  ADMIN_EMAILS: z
    .string()
    .default("")
    .transform((s) =>
      s
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
});

// Hosting dashboards often save blank fields as "" — treat those as "not set" so defaults apply.
const definedEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== undefined && v.trim() !== ""));
const parsed = schema.safeParse(definedEnv);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const env = { ...parsed.data, RUN_WORKER_IN_API: parsed.data.RUN_WORKER_IN_API ?? true };
export type Env = typeof env;
