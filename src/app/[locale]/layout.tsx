import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { IBM_Plex_Sans_Arabic, Inter, Manrope } from "next/font/google";
import { cookies } from "next/headers";
import { routing } from "@/i18n/routing";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { getSiteUrl } from "@/server/env";

const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });
const display = Manrope({ subsets: ["latin"], variable: "--font-display-face", display: "swap", weight: ["600", "700", "800"] });
const arabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-arabic",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Browser UI colour follows the chosen theme (read from the same cookie).
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return { themeColor: theme === "light" ? "#f7f6fb" : "#0c0a14", width: "device-width", initialScale: 1 };
}


export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const siteUrl = await getSiteUrl();
  return {
    metadataBase: new URL(siteUrl),
    title: { default: t("defaultTitle"), template: `%s · RoboNest.3D` },
    description: t("defaultDescription"),
    applicationName: "RoboNest.3D",
    manifest: "/manifest.webmanifest",
    openGraph: { siteName: "RoboNest.3D", locale: locale === "ar" ? "ar_IQ" : "en_US", type: "website" },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false },
  };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // The theme comes from a cookie, so the server paints the right theme first.
  // Always an explicit attribute: no client script decides the theme, so there is no flash or hydration mismatch.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang={locale === "ar" ? "ar-IQ" : "en"}
      dir={locale === "ar" ? "rtl" : "ltr"}
      data-theme={theme}
      className={`${body.variable} ${display.variable} ${arabic.variable}`}
    >
      <body className="min-h-dvh bg-bg text-text antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}

// Every page reads live data from D1 (prices, stock, sessions), so nothing is
// prerendered at build time and the build never needs database access.
export const dynamic = "force-dynamic";
