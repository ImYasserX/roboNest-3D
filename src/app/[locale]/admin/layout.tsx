import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: { default: t("title"), template: `%s · ${t("title")}` }, robots: { index: false, follow: false } };
}

// The admin follows the site theme (dark charcoal by default, light on
// request); .admin-shell (globals.css) tunes the tokens for data-heavy work.
export default function AdminRootLayout({ children }: LayoutProps<"/[locale]/admin">) {
  return <div className="admin-shell min-h-dvh bg-[var(--rn-admin-canvas)] text-text">{children}</div>;
}
