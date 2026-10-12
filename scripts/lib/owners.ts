// The two RoboNest.3D owners (confirmed by the business, 2026-10-10; display
// names shortened at the owners' request, 2026-10-12). Only these display
// names can be provisioned with the OWNER role.
export const OWNERS = {
  yasser: { displayName: "Yasser" },
  ayman: { displayName: "Ayman" },
} as const;
export type OwnerKey = keyof typeof OWNERS;

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Idempotent insert: does nothing if this owner already exists. The
 * admin_owner_limit trigger (migration 0001) rejects a third owner.
 */
export function ownerInsertSql(input: { id: string; username: string; displayName: string; passwordHash: string; now: number }) {
  return `INSERT INTO admin_users (id, username, display_name, role, password_hash, totp_enabled, status, failed_login_count, password_changed_at, created_at, updated_at)
SELECT ${sqlString(input.id)}, ${sqlString(input.username)}, ${sqlString(input.displayName)}, 'OWNER', ${sqlString(input.passwordHash)}, 0, 'ACTIVE', 0, ${input.now}, ${input.now}, ${input.now}
WHERE NOT EXISTS (SELECT 1 FROM admin_users WHERE role = 'OWNER' AND display_name = ${sqlString(input.displayName)});\n`;
}
