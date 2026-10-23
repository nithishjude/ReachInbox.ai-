/**
 * Test environment: a dedicated Postgres database and Redis DB so tests never touch dev data.
 * Override with TEST_DATABASE_URL / TEST_REDIS_URL (CI sets them).
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://reachinbox:reachinbox@localhost:5432/reachinbox_test";
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15";

export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    JWT_SECRET: "test-secret-test-secret-test-secret",
    ETHEREAL_SENDERS: "",
    SMTP_SENDERS: "",
    MIN_DELAY_BETWEEN_SENDS_MS: "0",
    MAX_EMAILS_PER_HOUR_PER_SENDER: "1000",
    SEND_MAX_ATTEMPTS: "3",
    ADMIN_EMAILS: "admin@example.com",
  });
}
