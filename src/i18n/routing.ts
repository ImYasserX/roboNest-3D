import { defineRouting } from "next-intl/routing";
import { DEFAULT_LOCALE, LOCALES } from "@/lib/domain";

export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
  localeCookie: { name: "rn_locale", sameSite: "lax", maxAge: 60 * 60 * 24 * 365 },
});
