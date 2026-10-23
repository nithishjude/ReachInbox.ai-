import { Client } from "pg";
import { applyTestEnv, TEST_DATABASE_URL } from "./env";

/** Create the test database once (if needed) and apply the schema. */
export default async function setup(): Promise<void> {
  applyTestEnv();
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  url.pathname = "/postgres";

  const admin = new Client({ connectionString: url.toString() });
  await admin.connect();
  const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  const { migrate } = await import("../src/db/migrate");
  const { pool } = await import("../src/db/client");
  await migrate();
  await pool.end();
}
