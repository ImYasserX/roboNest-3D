import "server-only";
import type { Database } from "@/server/db/client";
import { getCategoryTree } from "@/server/services/catalog";
import { pick } from "@/lib/localize";

/** Leaf-friendly category options grouped by top-level parent. */
export async function categoryOptions(db: Database, locale: string) {
  const tree = await getCategoryTree(db, { includeInactive: true });
  return tree.roots.flatMap((root) => {
    const group = pick(locale, root.nameEn, root.nameAr);
    return [{ id: root.id, label: group, group }, ...root.children.map((c) => ({ id: c.id, label: pick(locale, c.nameEn, c.nameAr), group }))];
  });
}
