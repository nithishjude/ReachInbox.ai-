import { afterAll } from "vitest";
import { applyTestEnv } from "./env";

// Must run before any src module reads config (setup files execute before each test file's imports).
applyTestEnv();

afterAll(async () => {
  const { pool } = await import("../src/db/client");
  const { redis } = await import("../src/lib/redis");
  const { emailQueue } = await import("../src/queue/queue");
  await emailQueue.close();
  await pool.end();
  redis.disconnect();
});
