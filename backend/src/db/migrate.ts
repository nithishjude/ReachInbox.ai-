import fs from "fs";
import path from "path";
import { pool } from "./client";

// Arbitrary constant: serialises migrations when API and worker processes boot at the same time.
const MIGRATION_LOCK_ID = 727_001;

export async function migrate(): Promise<void> {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(sql);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => undefined);
    client.release();
  }
}
