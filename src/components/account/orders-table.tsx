import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatIQD } from "@/lib/money";
import { formatDate } from "@/lib/localize";
import { Badge } from "@/components/ui/misc";
import type { OrderStatus } from "@/lib/domain";

type Row = { orderNumber: string; status: OrderStatus; total: number; createdAt: Date };

/** Responsive list: a table on wide screens, stacked cards on phones. */
export async function OrdersTable({ rows }: { rows: Row[] }) {
  const [t, ts, locale] = await Promise.all([getTranslations("account"), getTranslations("status"), getLocale()]);
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <caption className="sr-only">{t("orders")}</caption>
        <thead className="hidden bg-surface-2 text-start sm:table-header-group">
          <tr>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t("orderNumber")}</th>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t("date")}</th>
            <th scope="col" className="px-4 py-3 text-start font-medium">{t("status")}</th>
            <th scope="col" className="px-4 py-3 text-end font-medium">{t("total")}</th>
            <th scope="col" className="px-4 py-3"><span className="sr-only">{t("view")}</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-surface">
          {rows.map((o) => (
            <tr key={o.orderNumber} className="grid grid-cols-2 gap-1 p-4 sm:table-row sm:p-0">
              <td className="ltr-nums font-semibold sm:px-4 sm:py-3">{o.orderNumber}</td>
              <td className="text-end text-muted sm:px-4 sm:py-3 sm:text-start">{formatDate(o.createdAt, locale)}</td>
              <td className="sm:px-4 sm:py-3"><Badge tone={o.status === "DELIVERED" ? "success" : o.status === "CANCELLED" ? "danger" : "primary"}>{ts(`order.${o.status}`)}</Badge></td>
              <td className="ltr-nums text-end font-medium sm:px-4 sm:py-3">{formatIQD(o.total, locale)}</td>
              <td className="col-span-2 sm:px-4 sm:py-3 sm:text-end">
                <Link href={`/account/orders/${o.orderNumber}`} className="inline-flex min-h-10 items-center font-semibold text-primary-text underline" aria-label={t("viewOrder", { number: o.orderNumber })}>
                  {t("view")}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
