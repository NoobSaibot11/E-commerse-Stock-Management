import { execSync } from "node:child_process";
import pg from "pg";
import { TEST_DATABASE_URL } from "./database-url.js";

// Runs once before the whole suite: creates the test database if needed and
// brings its schema up to date with the migrations.
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  // Every test truncates all tables, so refuse anything that isn't
  // clearly a throwaway database.
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Refusing to run tests against "${dbName}": the database name must end in _test`,
    );
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const { rowCount } = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [dbName],
    );
    if (!rowCount) {
      await admin.query(`CREATE DATABASE "${dbName}"`);
    }
  } finally {
    await admin.end();
  }

  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "inherit",
  });
}
