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
  // Confirming that money was received (deposits and full payments). This is
  // what unlocks paid downloads and the deposit-gated fulfilment stages.
  "payments.verify",
  "notifications.manage",
  // Publishing an interactive 3D preview proxy. Operations can generate and
  // upload candidates (products.edit); an Owner or Super Admin approves them.
  "previews.approve",
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

/**
 * Business decision (2026-10-12): only Owners confirm that a payment or deposit
 * was received. Whether Super Admins may also do it was left open by the
 * owners, so it stays OFF. Set this to true (a reviewed code change) to let
 * Super Admins verify payments too; nothing else grants payments.verify.
 */
export const SUPER_ADMIN_MAY_VERIFY_PAYMENTS = false;

const ROLE_PERMISSIONS: Record<AdminRole, ReadonlySet<Permission>> = {
  // Owners hold every permission. What sets them apart from Super Admins is
  // protection: owner accounts cannot be created, demoted, disabled or deleted
  // from the admin UI, and database triggers enforce the same (migration 0001).
  OWNER: new Set(PERMISSIONS),
  SUPER_ADMIN: new Set(PERMISSIONS.filter((p) => p !== "payments.verify" || SUPER_ADMIN_MAY_VERIFY_PAYMENTS)),
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
