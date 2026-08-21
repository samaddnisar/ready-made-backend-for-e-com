/**
 * Idempotent seed: system roles, settings singleton, tax settings.
 * Run with `pnpm db:seed` after migrations. Safe to re-run.
 *
 * To bootstrap the first admin user, set SEED_ADMIN_EMAIL (the user must
 * already exist in Supabase Auth — create it in the Supabase dashboard),
 * or use the invite flow in the admin UI once someone can log in.
 */
import { config } from "dotenv";
config({ path: "../../.env" });
config();

import { eq } from "drizzle-orm";
import { getDb } from "./client";
import { DEFAULT_FEATURE_FLAGS } from "../features/flags";
import { SYSTEM_ROLES } from "../rbac/index";
import { adminUsers, roles, settings } from "./schema/platform";
import { taxSettings } from "./schema/shipping";

async function main() {
  const db = getDb();

  for (const role of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({ name: role.name, permissions: role.permissions, isSystem: true })
      .onConflictDoNothing();
  }
  console.log(`✓ system roles (${SYSTEM_ROLES.map((r) => r.name).join(", ")})`);

  await db
    .insert(settings)
    .values({ id: 1, featureFlags: DEFAULT_FEATURE_FLAGS })
    .onConflictDoNothing();
  console.log("✓ settings singleton");

  await db.insert(taxSettings).values({ id: 1 }).onConflictDoNothing();
  console.log("✓ tax settings singleton");

  const seedEmail = process.env.SEED_ADMIN_EMAIL;
  const seedAuthUserId = process.env.SEED_ADMIN_AUTH_USER_ID;
  if (seedEmail && seedAuthUserId) {
    const superAdmin = await db.query.roles.findFirst({ where: eq(roles.name, "super_admin") });
    if (!superAdmin) throw new Error("super_admin role missing");
    await db
      .insert(adminUsers)
      .values({ email: seedEmail, authUserId: seedAuthUserId, roleId: superAdmin.id })
      .onConflictDoNothing();
    console.log(`✓ admin user ${seedEmail}`);
  } else {
    console.log("· skipped admin user (set SEED_ADMIN_EMAIL + SEED_ADMIN_AUTH_USER_ID to seed one)");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
