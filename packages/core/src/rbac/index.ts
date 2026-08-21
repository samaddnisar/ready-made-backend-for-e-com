/**
 * RBAC (§7/§9): roles carry a `permissions` JSON of resource → actions.
 * Checked server-side on every admin route — never trust the client.
 */

export const RESOURCES = [
  "dashboard",
  "products",
  "orders",
  "customers",
  "inventory",
  "discounts",
  "shipping",
  "tax",
  "settings",
  "users",
  "media",
  "audit_log",
  // Toggleable modules
  "reviews",
  "wishlists",
  "gift_cards",
  "loyalty",
  "cms",
  "abandoned_carts",
  "newsletter",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = ["read", "create", "update", "delete"] as const;

export type Action = (typeof ACTIONS)[number];

/** "*" grants everything for that slot. */
export type RolePermissions = Partial<Record<Resource | "*", Array<Action | "*">>>;

export function hasPermission(
  permissions: RolePermissions,
  resource: Resource,
  action: Action,
): boolean {
  const grants = permissions[resource] ?? permissions["*"];
  if (!grants) return false;
  return grants.includes("*") || grants.includes(action);
}

// ── Built-in roles (seeded; isSystem = true) ─────────────────

export const SUPER_ADMIN_PERMISSIONS: RolePermissions = { "*": ["*"] };

/** Everything except managing admin users/roles and store settings. */
export const MANAGER_PERMISSIONS: RolePermissions = {
  "*": ["*"],
  users: [],
  settings: ["read"],
};

/** Read-only across the board. */
export const VIEWER_PERMISSIONS: RolePermissions = { "*": ["read"] };

export const SYSTEM_ROLES = [
  { name: "super_admin", permissions: SUPER_ADMIN_PERMISSIONS },
  { name: "manager", permissions: MANAGER_PERMISSIONS },
  { name: "viewer", permissions: VIEWER_PERMISSIONS },
] as const;
