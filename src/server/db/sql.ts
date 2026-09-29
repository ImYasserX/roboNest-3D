import { getTableName, sql, type Column } from "drizzle-orm";

/**
 * Fully qualified column reference ("table"."column"). Drizzle omits table
 * names in single-table selects, which makes correlated subqueries ambiguous
 * or — worse — silently bind to the inner table. Always use this for columns
 * of the OUTER query inside a subquery.
 */
export function qualified(column: Column) {
  return sql.raw(`"${getTableName(column.table)}"."${column.name}"`);
}
