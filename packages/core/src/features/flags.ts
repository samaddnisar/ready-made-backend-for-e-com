/**
 * Feature-flag system (§4 of the spec).
 *
 * Flags live in the `settings` singleton row and are toggled from the admin —
 * no redeploy. The API layer is the security boundary: every feature-scoped
 * route must be wrapped so a disabled feature returns 404.
 */

export const FEATURE_KEYS = [
  "reviews",
  "wishlists",
  "gift_cards",
  "loyalty",
  "cms",
  "abandoned_cart",
  "related_products",
  "newsletter",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureFlags = Record<FeatureKey, boolean>;

/** Boilerplate defaults for a fresh clone (confirmed per-project). */
export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  reviews: true,
  related_products: true,
  wishlists: false,
  gift_cards: false,
  loyalty: false,
  cms: false,
  abandoned_cart: false,
  newsletter: false,
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  reviews: "Reviews & ratings",
  wishlists: "Wishlists",
  gift_cards: "Gift cards",
  loyalty: "Loyalty points",
  cms: "Blog / CMS",
  abandoned_cart: "Abandoned-cart recovery",
  related_products: "Related products",
  newsletter: "Newsletter signup",
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}

/** Fill in any missing keys (e.g. a flag added after the row was created). */
export function normalizeFlags(raw: Partial<FeatureFlags> | null | undefined): FeatureFlags {
  return { ...DEFAULT_FEATURE_FLAGS, ...(raw ?? {}) };
}

// NOTE: this module must stay free of server-only imports — client components
// (e.g. the admin settings form) import it directly. The DB-backed checks
// (isFeatureEnabled, getEnabledFeatures) live in settings/service.ts.
