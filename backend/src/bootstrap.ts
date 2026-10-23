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
export async function bootstrap({ api, worker: runWorker }: Options): Promise<void> {
  await migrate();
  await ensureSenders();

  let server: Server | undefined;
  let worker: Worker | undefined;

  if (api) {
    await reconcileQueue();
    server = createApp().listen(env.PORT, () => {
      console.log(`[api] listening on http://localhost:${env.PORT}  (queue dashboard: /admin/queues)`);
    });
  }
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
    console.error("[boot] failed to start", err);
    process.exit(1);
  });
}
