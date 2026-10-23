import IORedis, { RedisOptions } from "ioredis";
import { env } from "../config/env";

// BullMQ requires maxRetriesPerRequest=null on connections used by workers (blocking commands).
const options: RedisOptions = { maxRetriesPerRequest: null, enableReadyCheck: true };

export function createRedis(name: string): IORedis {
  const conn = new IORedis(env.REDIS_URL, { ...options, connectionName: name });
  conn.on("error", (err) => console.error(`[redis:${name}]`, err.message));
  return conn;
}

/** Shared connection for non-blocking commands (queue producer, rate limiter). */
export const redis = createRedis("shared");
