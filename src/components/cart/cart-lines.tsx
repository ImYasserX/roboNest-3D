import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { removeCartItemAction, updateCartItemAction } from "@/server/actions/cart";
import type { CartLine } from "@/server/services/cart";
import { formatIQD } from "@/lib/money";
import { mediaUrl, pick, pickText } from "@/lib/localize";
import { CubeIcon, TrashIcon } from "@/components/ui/icons";
import { SubmitButton } from "@/components/ui/submit-button";

export async function CartLines({ lines, editable = true }: { lines: CartLine[]; editable?: boolean }) {
  const [t, tp, locale] = await Promise.all([getTranslations("cart"), getTranslations("product"), getLocale()]);
  return (
    <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
      {lines.map((line) => {
        const name = pick(locale, line.nameEn, line.nameAr);
        const problem = line.errors[0];
        return (
          <li key={line.id} className={`flex gap-4 p-4 ${problem ? "bg-danger-soft" : ""}`}>
            <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:size-24">
              {line.imageKey ? <Image src={mediaUrl(line.imageKey)} alt="" fill sizes="96px" className="object-cover" /> : <CubeIcon className="m-auto mt-7 text-muted" />}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link href={`/products/${line.slug}`} className="font-semibold hover:underline">
                  {name}
                </Link>
                {!problem ? <span className="ltr-nums font-semibold">{formatIQD(line.lineTotal, locale)}</span> : null}
              </div>
              {line.snapshot.length ? (
                <dl className="grid gap-x-3 gap-y-0.5 text-sm text-muted sm:grid-cols-[auto_1fr]">
                  {line.snapshot.map((o) => (
                    <div key={o.optionId} className="contents">
                      <dt>{pickText(locale, o.label)}:</dt>
                      <dd className="break-words text-text/90">{pickText(locale, o.value)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {!problem ? <p className="text-sm text-muted"><bdi className="ltr-nums">{formatIQD(line.unitPrice, locale)}</bdi> × <bdi className="ltr-nums">{line.quantity}</bdi></p> : null}
              {problem ? (
                <p className="text-sm font-medium text-danger" role="alert">
                  {t("lineProblem")} {tp(`errors.${problem.code}`, { option: "" })}
                </p>
              ) : null}
              {editable ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <form action={updateCartItemAction} className="flex items-center gap-2">
                    <input type="hidden" name="itemId" value={line.id} />
                    <label htmlFor={`qty-${line.id}`} className="sr-only">
                      {t("quantityFor", { name })}
                    </label>
                    <input id={`qty-${line.id}`} name="quantity" type="number" min={1} max={100} defaultValue={line.quantity} className="ltr-nums h-10 w-20 rounded-md border border-border-strong bg-surface px-2 text-center" />
                    <SubmitButton variant="secondary" size="sm" className="min-h-10">
                      {t("updateQuantity")}
                    </SubmitButton>
                  </form>
                  <form action={removeCartItemAction}>
                    <input type="hidden" name="itemId" value={line.id} />
                    <SubmitButton variant="ghost" size="sm" className="min-h-10 text-danger" aria-label={t("removeItem", { name })}>
                      <TrashIcon size={16} />
                      {t("remove")}
                    </SubmitButton>
                  </form>
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
