import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { adminLogoutAction } from "@/server/actions/admin/auth";
import { requireAdminPage } from "@/server/auth/current";
import { hasPermission, type Permission } from "@/lib/permissions";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { Link } from "@/i18n/navigation";
import { AdminNav, type AdminNavGroup } from "@/components/admin/nav";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { LogoutIcon } from "@/components/ui/icons";
import { SubmitButton } from "@/components/ui/submit-button";

type Item = { href: string; key: string; icon: string; permission?: Permission };

// Grouped by job. Each entry is shown only when the role holds its permission;
// the page itself re-checks (requireAdminPage) and every action re-checks too.
const GROUPS: { key: string; items: Item[] }[] = [
  { key: "overview", items: [{ href: "/admin", key: "dashboard", icon: "grid", permission: "dashboard.view" }] },
  {
    key: "sales",
    items: [
      { href: "/admin/orders", key: "orders", icon: "receipt", permission: "orders.view" },
      { href: "/admin/payments", key: "payments", icon: "wallet", permission: "payments.manage" },
      { href: "/admin/custom-requests", key: "customRequests", icon: "printer", permission: "customRequests.manage" },
      { href: "/admin/discounts", key: "discounts", icon: "tag", permission: "discounts.manage" },
    ],
  },
  {
    key: "catalog",
    items: [
      { href: "/admin/products", key: "products", icon: "cube", permission: "products.view" },
      { href: "/admin/digital-files", key: "digitalFiles", icon: "file", permission: "digitalFiles.manage" },
      { href: "/admin/categories", key: "categories", icon: "layers", permission: "categories.edit" },
      { href: "/admin/inventory", key: "inventory", icon: "list", permission: "inventory.edit" },
    ],
  },
  {
    key: "people",
    items: [
      { href: "/admin/customers", key: "customers", icon: "users", permission: "customers.view" },
      { href: "/admin/messages", key: "messages", icon: "message", permission: "messages.view" },
    ],
  },
  {
    key: "operations",
    items: [
      { href: "/admin/delivery", key: "delivery", icon: "truck", permission: "delivery.edit" },
      { href: "/admin/notifications", key: "notifications", icon: "bell", permission: "notifications.manage" },
      { href: "/admin/analytics", key: "analytics", icon: "chart", permission: "analytics.view" },
    ],
  },
  {
    key: "site",
    items: [
      { href: "/admin/content", key: "content", icon: "pencil", permission: "content.edit" },
      { href: "/admin/settings", key: "settings", icon: "settings", permission: "settings.edit" },
    ],
  },
  {
    key: "security",
    items: [
      { href: "/admin/admins", key: "admins", icon: "shield", permission: "admins.manage" },
      { href: "/admin/audit-log", key: "audit", icon: "archive", permission: "audit.view" },
      { href: "/admin/security", key: "security", icon: "shield" },
    ],
  },
];

export default async function AdminPanelLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Enrollment is allowed here so the security page renders; every page
  // re-checks with requireAdminPage(permission), which forces enrollment.
  const admin = await requireAdminPage(locale, undefined, { allowEnrollment: true });
  const [t, tr] = await Promise.all([getTranslations("admin.nav"), getTranslations("admin.role")]);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const groups: AdminNavGroup[] = GROUPS.map((g) => ({
    key: g.key,
    items: g.items.filter((i) => !i.permission || hasPermission(admin.role, i.permission)).map(({ href, key, icon }) => ({ href, key, icon })),
  })).filter((g) => g.items.length > 0);

  const account = (
    <div className="space-y-1 border-t border-border pt-3 text-sm">
      <div className="flex items-center gap-1 px-1">
        <Link href="/" className="flex min-h-10 flex-1 items-center rounded-md px-2 text-muted hover:bg-surface-2 hover:text-text">{t("storefront")}</Link>
        <ThemeToggle initial={theme} className="inline-flex size-10 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text" />
      </div>
      <LanguageSwitcher className="flex min-h-10 items-center gap-2 rounded-md px-3 text-muted hover:bg-surface-2 hover:text-text" />
      <form action={adminLogoutAction}>
        <SubmitButton variant="ghost" size="sm" className="w-full justify-start text-muted">
          <LogoutIcon size={16} /> {t("signOut")}
        </SubmitButton>
      </form>
    </div>
  );

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[16.5rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-on-primary">
        {t("skipToContent")}
      </a>
      <aside className="border-b border-border bg-[var(--rn-admin-sidebar)] lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:border-b-0 lg:border-e">
        <div className="flex items-center justify-between gap-3 px-4 py-4 lg:block lg:px-5 lg:pt-6">
          <Link href="/admin" className="font-display text-lg font-extrabold tracking-tight" dir="ltr">
            RoboNest<span className="text-primary-text">.3D</span>
            <span className="ms-2 rounded border border-border px-1.5 py-0.5 align-middle text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{t("badge")}</span>
          </Link>
          <p className="truncate text-xs text-muted lg:mt-2">
            <span className="font-medium text-text">{admin.displayName}</span> · {tr(admin.role)}
          </p>
        </div>
        <AdminNav groups={groups} footer={account} />
      </aside>
      <main id="main" className="min-w-0 px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
