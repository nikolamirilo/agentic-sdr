// Standalone migration runner: `node scripts/migrate.mjs`.
// Deliberately dependency-light so it can run as a Render predeploy command
// without booting Next.js. A bad migration fails the deploy, not the process.
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
dotenv.config({ path: ".env", quiet: true });

const connectionString =
  process.env.DATABASE_URL || process.env.NEON_PG_DB_CONNECTION_STRING;
if (!connectionString) {
  console.error("DATABASE_URL (or NEON_PG_DB_CONNECTION_STRING) is not set");
  process.exit(1);
}

const sql = await readFile(path.join(process.cwd(), "lib/db/schema.sql"), "utf8");
const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await pool.query(sql);
  console.log("migrations applied");
} catch (error) {
  console.error("migration failed:", error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
