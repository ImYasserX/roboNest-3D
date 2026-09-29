import { cn } from "@/components/ui/cn";

export type Column<T> = { key: string; header: string; cell: (row: T) => React.ReactNode; className?: string; align?: "start" | "end" };

/**
 * Data table that stays usable on phones: a real <table> from md upwards and
 * a stacked, labelled card per row below that (no uncontrolled overflow).
 */
export function DataTable<T>({ columns, rows, rowKey, caption, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; caption: string; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg border border-dashed border-border p-8 text-center text-muted">{empty}</p>;
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden bg-surface-2 md:table-header-group">
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={cn("px-3 py-2.5 font-semibold", c.align === "end" ? "text-end" : "text-start")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={rowKey(row)} className="block p-3 md:table-row md:p-0">
              {columns.map((c) => (
                <td key={c.key} className={cn("flex justify-between gap-4 py-1 md:table-cell md:px-3 md:py-2.5", c.align === "end" ? "md:text-end" : "", c.className)}>
                  <span className="font-medium text-muted md:hidden">{c.header}</span>
                  <span className="min-w-0 text-end md:text-[inherit]">{c.cell(row)}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
