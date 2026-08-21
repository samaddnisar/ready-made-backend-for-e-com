import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "../db/schema";
import { setDb, type Db } from "../db/client";

/**
 * In-memory Postgres for money-path tests (§9): real SQL, real constraints,
 * real row locks — no Supabase needed. Fresh database per call.
 * Also wires it into getDb() via setDb so services under test use it.
 */
export async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: new URL("../../drizzle", import.meta.url).pathname });
  setDb(db);
  return db;
}
