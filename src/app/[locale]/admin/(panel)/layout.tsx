import { getTranslations, setRequestLocale } from "next-intl/server";
import { adminLogoutAction } from "@/server/actions/admin/auth";
import { requireAdminPage } from "@/server/auth/current";
import { hasPermission, type Permission } from "@/lib/permissions";
import { Link } from "@/i18n/navigation";
import { AdminNav, type AdminNavItem } from "@/components/admin/nav";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { SubmitButton } from "@/components/ui/submit-button";

const NAV: (AdminNavItem & { permission: Permission })[] = [
  { href: "/admin", key: "dashboard", permission: "dashboard.view" },
  { href: "/admin/orders", key: "orders", permission: "orders.view" },
  { href: "/admin/custom-requests", key: "customRequests", permission: "customRequests.manage" },
  { href: "/admin/products", key: "products", permission: "products.view" },
  { href: "/admin/categories", key: "categories", permission: "categories.edit" },
  { href: "/admin/inventory", key: "inventory", permission: "inventory.edit" },
  { href: "/admin/digital-files", key: "digitalFiles", permission: "digitalFiles.manage" },
  { href: "/admin/customers", key: "customers", permission: "customers.view" },
  { href: "/admin/messages", key: "messages", permission: "messages.view" },
  { href: "/admin/delivery", key: "delivery", permission: "delivery.edit" },
  { href: "/admin/discounts", key: "discounts", permission: "discounts.manage" },
  { href: "/admin/analytics", key: "analytics", permission: "analytics.view" },
  { href: "/admin/content", key: "content", permission: "content.edit" },
  { href: "/admin/settings", key: "settings", permission: "settings.edit" },
  { href: "/admin/admins", key: "admins", permission: "admins.manage" },
  { href: "/admin/audit-log", key: "audit", permission: "audit.view" },
];

export default async function AdminPanelLayout({ children, params }: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Enrollment is allowed here so the security page renders; every page
  // re-checks with requireAdminPage(permission), which forces enrollment.
  const admin = await requireAdminPage(locale, undefined, { allowEnrollment: true });
  const [t, tr] = await Promise.all([getTranslations("admin.nav"), getTranslations("admin.role")]);
  const items = NAV.filter((i) => hasPermission(admin.role, i.permission)).map(({ href, key }) => ({ href, key }));
  items.push({ href: "/admin/security", key: "security" });

  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[15rem_1fr]">
      <aside className="border-b border-border bg-surface p-4 lg:border-b-0 lg:border-e">
        <div className="mb-4 flex items-center justify-between gap-2 lg:block">
          <Link href="/admin" className="font-display text-lg font-extrabold" dir="ltr">
            RoboNest<span className="text-primary-text">.3D</span>
          </Link>
          <p className="text-xs text-muted lg:mt-1">
            {admin.displayName} · {tr(admin.role)}
          </p>
        </div>
        <AdminNav items={items} />
        <div className="mt-6 space-y-1 border-t border-border pt-4 text-sm">
          <Link href="/" className="flex min-h-10 items-center rounded-md px-3 hover:bg-surface-2">{t("storefront")}</Link>
          <LanguageSwitcher className="flex min-h-10 items-center gap-2 rounded-md px-3 hover:bg-surface-2" />
          <form action={adminLogoutAction}>
            <SubmitButton variant="ghost" size="sm" className="w-full justify-start">{t("signOut")}</SubmitButton>
          </form>
        </div>
      </aside>
      <main id="main" className="min-w-0 p-4 sm:p-6 lg:p-8">{children}</main>
    </div>
  );
}
