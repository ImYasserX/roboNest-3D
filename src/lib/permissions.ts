import type { AdminRole } from "./domain";

// Role → permission map. The UI uses this only to hide controls; every server
// action and route handler enforces it again via requireAdmin(permission).
// Roles are fixed (two administrators with distinct responsibilities), so the
// map lives in code where it is reviewed and versioned rather than in tables
// that could be edited at runtime. See ARCHITECTURE.md ("Authorization").

export const PERMISSIONS = [
  "dashboard.view",
  "orders.view",
  "orders.update",
  "products.view",
  "products.edit",
  "products.delete",
  "categories.edit",
  "categories.delete",
  "customers.view",
  "customers.edit",
  "customers.delete",
  "inventory.edit",
  "delivery.edit",
  "customRequests.manage",
  "digitalFiles.manage",
  "analytics.view",
  "analytics.profit",
  "discounts.manage",
  "content.edit",
  "messages.view",
  "settings.edit",
  "admins.manage",
  "audit.view",
  "payments.manage",
  "deposits.verify",
  "notifications.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const OPERATIONS: readonly Permission[] = [
  "dashboard.view",
  "orders.view",
  "orders.update",
  "products.view",
  "products.edit",
  "categories.edit",
  "customers.view",
  "customers.edit",
  "inventory.edit",
  "delivery.edit",
  "customRequests.manage",
  "digitalFiles.manage",
  "analytics.view",
  "content.edit",
  "messages.view",
];

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<Permission>> = {
  // Owners hold every permission. What sets them apart from Super Admins is
  // protection: owner accounts cannot be created, demoted, disabled or deleted
  // from the admin UI, and database triggers enforce the same (migration 0001).
  OWNER: new Set(PERMISSIONS),
  SUPER_ADMIN: new Set(PERMISSIONS),
  OPERATIONS: new Set(OPERATIONS),
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Roles that must use TOTP two-factor authentication to reach the admin area. */
export function roleRequiresTotp(role: AdminRole): boolean {
  return role === "OWNER" || role === "SUPER_ADMIN";
}

/** Whether `actorRole` may change credentials or settings of an admin with `targetRole`. */
export function canManageAdmin(actorRole: AdminRole, targetRole: AdminRole): boolean {
  if (!hasPermission(actorRole, "admins.manage")) return false;
  // Only an owner can reset another owner's password or authenticator.
  return targetRole !== "OWNER" || actorRole === "OWNER";
}
