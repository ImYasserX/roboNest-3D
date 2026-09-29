"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { GlobeIcon } from "@/components/ui/icons";

function SwitcherLink({ className }: { className?: string }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const target = locale === "ar" ? "en" : "ar";
  return (
    <Link
      href={search ? `${pathname}?${search}` : pathname}
      locale={target}
      hrefLang={target}
      lang={target}
      aria-label={t("switchToLabel")}
      className={className}
    >
      <GlobeIcon size={18} />
      <span>{t("switchTo")}</span>
    </Link>
  );
}

export function LanguageSwitcher({ className }: { className?: string }) {
  return (
    <Suspense fallback={<span className={className} />}>
      <SwitcherLink className={className} />
    </Suspense>
  );
}
