import type { Server } from "http";
import type { Worker } from "bullmq";
import { createApp } from "./app";
import { env } from "./config/env";
import { pool } from "./db/client";
import { migrate } from "./db/migrate";
import { redis } from "./lib/redis";
import { ensureSenders } from "./mail/senders";
import { emailQueue } from "./queue/queue";
import { reconcileQueue } from "./queue/reconcile";
import { startWorker, stopWorker } from "./queue/worker";

interface Options {
  api: boolean;
  worker: boolean;
}

/** Shared entry for the three run modes: API only, worker only, or both in one process. */
/** Hide the password in connection URLs before they reach any log. */
const redactUrl = (raw: string) => raw.replace(/\/\/([^:@/]*):[^@/]*@/, "//$1:****@");

/** Fail fast with a clear message instead of hanging when Redis or Postgres is unreachable. */
async function checkDependencies(): Promise<void> {
  const timeout = (what: string) =>
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${what} did not respond within 5s`)), 5000).unref());
  try {
    await Promise.race([redis.ping(), timeout("Redis")]);
  } catch (err) {
    const url = redactUrl(env.REDIS_URL);
    const hint = url.startsWith("redis://") && !/localhost|127\.0\.0\.1|redis:\d/.test(url)
      ? ' Hosted Redis (e.g. Upstash) usually requires TLS: use "rediss://" (two s).'
      : ' Is "docker compose up -d" running?';
    throw new Error(`Cannot reach Redis at REDIS_URL=${url}: ${(err as Error).message}.${hint}`);
  }
  try {
    await Promise.race([pool.query("SELECT 1"), timeout("Postgres")]);
  } catch (err) {
    throw new Error(`Cannot reach Postgres at DATABASE_URL: ${(err as Error).message}. Is "docker compose up -d" running?`);
  }
}

/** Retries sender setup in the background (every 30 s, up to 10 times) instead of failing the boot. */
async function ensureSendersWithRetry(attempt = 1): Promise<void> {
  try {
    await ensureSenders();
  } catch (err) {
    console.warn(`[senders] setup failed (attempt ${attempt}/10): ${(err as Error).message}`);
    if (attempt < 10) setTimeout(() => void ensureSendersWithRetry(attempt + 1), 30_000).unref();
  }
}

export async function bootstrap({ api, worker: runWorker }: Options): Promise<void> {
  await checkDependencies();
  await migrate();

  let server: Server | undefined;
  let worker: Worker | undefined;

  if (api) {
    // Listen first: hosting platforms (e.g. Render) treat a service that doesn't open its port quickly as failed.
    server = createApp().listen(env.PORT, () => {
      console.log(`[api] listening on http://localhost:${env.PORT}  (queue dashboard: /admin/queues)`);
    });
    await reconcileQueue();
  }
  // Creating Ethereal accounts needs an external API; a slow or failed call must not block or crash startup.
  void ensureSendersWithRetry();
  if (runWorker) worker = startWorker();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received, draining...`);
    const force = setTimeout(() => process.exit(1), 30_000);
    force.unref();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    if (worker) await stopWorker(worker);
    await emailQueue.close();
    await redis.quit();
    await pool.end();
    console.log("[shutdown] clean exit");
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

export function run(options: Options): void {
  bootstrap(options).catch((err) => {
    console.error("[boot] failed to start:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
