import Image from "next/image";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { getCartOwner } from "@/server/cart-owner";
import { getDb } from "@/server/db/client";
import { getCartView } from "@/server/services/cart";
import { getSetting } from "@/server/services/settings";
import { pickText } from "@/lib/localize";
import { CartIcon, HeartIcon, SearchIcon, UserIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/misc";
import { LanguageSwitcher } from "./language-switcher";
import { MobileNav } from "./mobile-nav";

export async function SiteHeader() {
  const [t, locale, user, owner, db] = await Promise.all([
    getTranslations("nav"),
    getLocale(),
    getCurrentUser(),
    getCartOwner({ create: false }),
    getDb(),
  ]);
  const [cart, homepage] = await Promise.all([getCartView(db, owner), getSetting(db, "homepage")]);
  const announcement = pickText(locale, homepage.announcement);

  const items = [
    { href: "/products", label: t("products") },
    { href: "/categories", label: t("categories") },
    { href: "/models", label: t("models") },
    { href: "/custom-printing", label: t("customPrinting") },
    { href: "/about", label: t("about") },
    { href: "/contact", label: t("contact") },
  ];
  const secondary = [
    { href: user ? "/account" : "/login", label: user ? t("account") : t("signIn") },
    { href: "/wishlist", label: t("wishlist") },
    { href: "/track", label: t("trackOrder") },
  ];
  const iconLink = "relative inline-flex size-10 sm:size-11 items-center justify-center rounded-md hover:bg-surface-2";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80">
      {announcement ? (
        <p className="bg-primary px-4 py-1.5 text-center text-xs font-medium text-on-primary sm:text-sm">{announcement}</p>
      ) : null}
      <Container className="flex h-16 items-center gap-1.5 sm:gap-3">
        <MobileNav items={items} secondary={secondary} />
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md" aria-label="RoboNest.3D">
          <Image src="/brand/robonest-mark-256.png" alt="" width={36} height={36} priority unoptimized className="size-8 sm:size-9" />
          <span className="font-display text-base font-extrabold tracking-tight sm:text-lg" dir="ltr">
            RoboNest<span className="text-primary-text">.3D</span>
          </span>
        </Link>

        <nav aria-label={t("mainNav")} className="ms-2 hidden lg:block">
          <ul className="flex items-center gap-1">
            {items.map((item, i) => (
              <li key={item.href} className={i >= 4 ? "hidden xl:block" : undefined}>
                <Link href={item.href} className="whitespace-nowrap rounded-md px-3 py-2 text-sm font-medium text-muted hover:bg-surface-2 hover:text-text">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <form action={`/${locale}/search`} method="get" role="search" className="relative hidden xl:block">
            <label htmlFor="header-search" className="sr-only">
              {t("search")}
            </label>
            <input
              id="header-search"
              name="q"
              type="search"
              maxLength={100}
              placeholder={t("searchPlaceholder")}
              className="h-10 w-60 rounded-md border border-border-strong bg-surface ps-9 pe-3 text-sm placeholder:text-muted/80 xl:w-72"
            />
            <SearchIcon size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted" />
          </form>
          <Link href="/search" className={`${iconLink} xl:hidden`} aria-label={t("search")}>
            <SearchIcon />
          </Link>
          <LanguageSwitcher className="hidden min-h-11 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium hover:bg-surface-2 sm:inline-flex" />
          <Link href="/wishlist" className={`${iconLink} hidden sm:inline-flex`} aria-label={t("wishlist")}>
            <HeartIcon />
          </Link>
          <Link href={user ? "/account" : "/login"} className={`${iconLink} hidden sm:inline-flex`} aria-label={user ? t("account") : t("signIn")}>
            <UserIcon />
          </Link>
          <Link href="/cart" className={iconLink} aria-label={t("cartWithCount", { count: cart.itemCount })}>
            <CartIcon />
            {cart.itemCount > 0 ? (
              <span aria-hidden="true" className="ltr-nums absolute -end-0.5 -top-0.5 min-w-5 rounded-full bg-primary px-1 text-center text-xs font-bold leading-5 text-on-primary">
                {cart.itemCount > 99 ? "99+" : cart.itemCount}
              </span>
            ) : null}
          </Link>
        </div>
      </Container>
    </header>
  );
}
