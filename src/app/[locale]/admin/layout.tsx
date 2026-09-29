import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({ params }: LayoutProps<"/[locale]/admin">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: { default: t("title"), template: `%s · ${t("title")}` }, robots: { index: false, follow: false } };
}

// The admin area uses the light theme tokens for dense data work.
export default function AdminRootLayout({ children }: LayoutProps<"/[locale]/admin">) {
  return (
    <div data-theme="light" className="min-h-dvh bg-bg text-text">
      {children}
    </div>
  );
}
