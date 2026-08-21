import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Load env from the monorepo root first, then local overrides.
config({ path: "../../.env" });
config();

export default defineConfig({
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:54322/postgres",
  },
  strict: true,
  verbose: true,
});
