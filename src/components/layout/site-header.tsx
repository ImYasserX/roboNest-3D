import Image from "next/image";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getDb } from "@/server/db/client";
import { getCartView } from "@/server/services/cart";
import { getSetting } from "@/server/services/settings";
import { pickText } from "@/lib/localize";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { CartIcon, HeartIcon, SearchIcon, UserIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/misc";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";

/** Storefront navigation. One catalog entry ("3D Models" → /products); no order tracking. */
export function storefrontNav(t: (key: "models" | "categories" | "customPrinting" | "about" | "contact") => string) {
  return [
    { href: "/products", label: t("models") },
    { href: "/categories", label: t("categories") },
    { href: "/custom-printing", label: t("customPrinting") },
    { href: "/about", label: t("about") },
    { href: "/contact", label: t("contact") },
  ];
}

export async function SiteHeader() {
  const [t, locale, user, owner, db, cookieStore] = await Promise.all([
    getTranslations("nav"),
    getLocale(),
    getCurrentUser(),
    getCartOwner({ create: false }),
    getDb(),
    cookies(),
  ]);
  const [cart, homepage] = await Promise.all([getCartView(db, owner), getSetting(db, "homepage")]);
  const announcement = pickText(locale, homepage.announcement);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  const items = storefrontNav(t);
  const secondary = [
    { href: user ? "/account" : "/login", label: user ? t("account") : t("signIn") },
    ...(user ? [{ href: "/account/orders", label: t("orders") }] : []),
    { href: "/wishlist", label: t("wishlist") },
  ];
  // No display value here: each control sets its own (inline-flex / hidden), so
  // responsive visibility classes never fight a base `inline-flex`.
  const iconLink = "relative size-10 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-surface-2 sm:size-11";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      {announcement ? (
        <p className="bg-primary px-4 py-1.5 text-center text-xs font-medium text-on-primary sm:text-sm">{announcement}</p>
      ) : null}
      {/* Three columns on desktop: brand | search (centred) | actions. The
          outer columns share the remaining space equally, so the search box
          sits in the true centre of the header at every desktop width. */}
      <Container className="flex h-16 items-center gap-1.5 sm:gap-3 lg:grid lg:grid-cols-[minmax(max-content,1fr)_minmax(16rem,36rem)_minmax(max-content,1fr)] lg:gap-6">
        <div className="flex min-w-0 items-center gap-1.5">
          <MobileNav items={items} secondary={secondary} theme={theme} />
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="RoboNest.3D">
            <Image src="/brand/robonest-mark-256.png" alt="" width={36} height={36} priority unoptimized className="size-8 sm:size-9" />
            <span className="font-display text-base font-extrabold tracking-tight sm:text-lg" dir="ltr">
              RoboNest<span className="text-primary-text">.3D</span>
            </span>
          </Link>
        </div>

        <form action={`/${locale}/search`} method="get" role="search" className="relative hidden w-full lg:block">
          <label htmlFor="header-search" className="sr-only">
            {t("search")}
          </label>
          <input
            id="header-search"
            name="q"
            type="search"
            required
            maxLength={100}
            enterKeyHint="search"
            placeholder={t("searchPlaceholder")}
            className="h-11 w-full rounded-full border border-border-strong bg-surface ps-11 pe-24 text-sm shadow-card placeholder:text-muted/80 focus:border-primary"
          />
          <SearchIcon size={18} className="pointer-events-none absolute start-4 top-1/2 -translate-y-1/2 text-muted" />
          <button type="submit" className="absolute end-1.5 top-1/2 h-8 -translate-y-1/2 rounded-full bg-primary px-4 text-sm font-semibold text-on-primary hover:bg-primary-hover">
            {t("searchSubmit")}
          </button>
        </form>

        <div className="ms-auto flex items-center justify-end gap-0.5 sm:gap-1 lg:ms-0">
          <Link href="/search" className={`${iconLink} inline-flex lg:hidden`} aria-label={t("search")}>
            <SearchIcon />
          </Link>
          {/* Theme and language live in the desktop nav row from lg up, keeping this column narrow. */}
          <ThemeToggle initial={theme} className={`${iconLink} hidden sm:inline-flex lg:hidden`} />
          <LanguageSwitcher className="hidden min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-surface-2 sm:inline-flex lg:hidden" />
          <Link href="/wishlist" className={`${iconLink} hidden sm:inline-flex`} aria-label={t("wishlist")}>
            <HeartIcon />
          </Link>
          <Link href={user ? "/account" : "/login"} className={`${iconLink} hidden sm:inline-flex`} aria-label={user ? t("account") : t("signIn")}>
            <UserIcon />
          </Link>
          <Link href="/cart" className={`${iconLink} inline-flex`} aria-label={t("cartWithCount", { count: cart.itemCount })}>
            <CartIcon />
            {cart.itemCount > 0 ? (
              <span aria-hidden="true" className="ltr-nums absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-bold leading-5 text-on-primary">
                {cart.itemCount > 99 ? "99+" : cart.itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </Container>

      {/* Desktop navigation row: always visible from lg, never competes with the search box for space. */}
      <div className="hidden border-t border-border/70 lg:block">
        <Container className="relative flex items-center justify-center">
          <NavLinks items={items} label={t("mainNav")} />
          <div className="absolute inset-y-0 end-4 flex items-center gap-1 sm:end-6 lg:end-8">
            <LanguageSwitcher className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text" />
            <ThemeToggle initial={theme} className="inline-flex size-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text" />
          </div>
        </Container>
      </div>
    </header>
  );
}
