import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

let _db: Db | undefined;

/**
 * Lazy singleton. `prepare: false` is required for Supabase's transaction
 * pooler (PgBouncer) — prepared statements aren't supported there.
 */
export function getDb(): Db {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const client = postgres(url, { prepare: false, max: 10 });
  _db = drizzle(client, { schema });
  return _db;
}

/** Test hook — lets tests inject a db (e.g. pglite or a transaction). */
export function setDb(db: Db): void {
  _db = db;
}

export { schema };
