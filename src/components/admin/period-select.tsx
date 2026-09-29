import { getTranslations } from "next-intl/server";
import { PERIODS } from "@/server/services/analytics";
import { controlClass } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";

export async function PeriodSelect({ action, value }: { action: string; value: number }) {
  const t = await getTranslations("admin.dashboard");
  const tc = await getTranslations("admin.common");
  return (
    <form action={action} method="get" className="flex items-end gap-2">
      <div>
        <label htmlFor="days" className="mb-1 block text-xs font-medium text-muted">{t("period")}</label>
        <select id="days" name="days" defaultValue={String(value)} className={controlClass}>
          {PERIODS.map((p) => <option key={p} value={p}>{t("days", { count: p })}</option>)}
        </select>
      </div>
      <button type="submit" className={buttonClass("secondary", "md")}>{tc("filter")}</button>
    </form>
  );
}
