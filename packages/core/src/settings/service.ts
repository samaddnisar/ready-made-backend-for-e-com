import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { settings } from "../db/schema/platform";
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_KEYS,
  normalizeFlags,
  type FeatureFlags,
  type FeatureKey,
} from "../features/flags";

export type Settings = typeof settings.$inferSelect;
export type SettingsUpdate = Partial<
  Omit<Settings, "id" | "createdAt" | "updatedAt" | "featureFlags"> & {
    featureFlags: Partial<FeatureFlags>;
  }
>;

const SETTINGS_ID = 1;
const CACHE_TTL_MS = 30_000;

let cache: { value: Settings; loadedAt: number } | undefined;

/** Read the settings singleton, creating it with defaults on first access. */
export async function getSettings(): Promise<Settings> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache.value;

  const db = getDb();
  let row = await db.query.settings.findFirst({ where: eq(settings.id, SETTINGS_ID) });
  if (!row) {
    const inserted = await db
      .insert(settings)
      .values({ id: SETTINGS_ID, featureFlags: DEFAULT_FEATURE_FLAGS })
      .onConflictDoNothing()
      .returning();
    row =
      inserted[0] ?? (await db.query.settings.findFirst({ where: eq(settings.id, SETTINGS_ID) }));
  }
  if (!row) throw new Error("Failed to load settings");

  const value = { ...row, featureFlags: normalizeFlags(row.featureFlags) };
  cache = { value, loadedAt: Date.now() };
  return value;
}

/** Patch the singleton; feature flags merge rather than replace. */
export async function updateSettings(patch: SettingsUpdate): Promise<Settings> {
  const db = getDb();
  await getSettings(); // ensure the row exists

  const { featureFlags: flagsPatch, ...rest } = patch;
  // Drop undefined keys so we don't null-out columns unintentionally.
  const set: Record<string, unknown> = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  );
  set.updatedAt = new Date();
  if (flagsPatch && Object.keys(flagsPatch).length > 0) {
    // Atomic jsonb merge: the DB row — never a possibly-stale cached copy —
    // is the merge base, so concurrent single-flag toggles from different
    // serverless instances can't silently revert each other.
    set.featureFlags = sql`${settings.featureFlags} || ${JSON.stringify(flagsPatch)}::jsonb`;
  }

  const [row] = await db
    .update(settings)
    .set(set as Partial<typeof settings.$inferInsert>)
    .where(eq(settings.id, SETTINGS_ID))
    .returning();
  if (!row) throw new Error("Settings row missing — run db:seed");

  const value = { ...row, featureFlags: normalizeFlags(row.featureFlags) };
  cache = { value, loadedAt: Date.now() };
  return value;
}

export function invalidateSettingsCache(): void {
  cache = undefined;
}

/** Server-side feature check (§4) — backed by the cached settings row. */
export async function isFeatureEnabled(key: FeatureKey): Promise<boolean> {
  const settings = await getSettings();
  return normalizeFlags(settings.featureFlags)[key];
}

/** List of enabled feature keys — used by GET /api/public/settings. */
export async function getEnabledFeatures(): Promise<FeatureKey[]> {
  const settings = await getSettings();
  const flags = normalizeFlags(settings.featureFlags);
  return FEATURE_KEYS.filter((k) => flags[k]);
}
