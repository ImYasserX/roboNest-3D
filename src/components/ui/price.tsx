import { useLocale, useTranslations } from "next-intl";
import { formatIQD } from "@/lib/money";
import { cn } from "./cn";

/** Displays a price; when on sale, the original is struck through with an accessible label. */
export function Price({ amount, compareAt, className, size = "md" }: { amount: number; compareAt?: number | null; className?: string; size?: "sm" | "md" | "lg" }) {
  const locale = useLocale();
  const t = useTranslations("product");
  const onSale = compareAt != null && compareAt > amount;
  const sizeClass = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-base";
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      {onSale ? <span className="sr-only">{t("nowPrice")}:</span> : null}
      <span className={cn("ltr-nums font-bold text-text", sizeClass)}>{formatIQD(amount, locale)}</span>
      {onSale ? (
        <>
          <span className="sr-only">{t("wasPrice")}:</span>
          <s className="ltr-nums text-sm text-muted">{formatIQD(compareAt!, locale)}</s>
        </>
      ) : null}
    </span>
  );
}
