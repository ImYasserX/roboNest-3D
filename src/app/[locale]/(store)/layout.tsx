import { getTranslations, setRequestLocale } from "next-intl/server";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";

export default async function StoreLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("common");
  return (
    <>
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-on-primary focus:not-sr-only focus:fixed focus:start-4 focus:top-4">
        {t("skipToContent")}
      </a>
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
