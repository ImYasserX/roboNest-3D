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
  SUPER_ADMIN: new Set(PERMISSIONS),
  OPERATIONS: new Set(OPERATIONS),
};

export function hasPermission(role: AdminRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/** Roles that must use TOTP two-factor authentication to reach the admin area. */
export function roleRequiresTotp(role: AdminRole): boolean {
  return role === "SUPER_ADMIN";
}
