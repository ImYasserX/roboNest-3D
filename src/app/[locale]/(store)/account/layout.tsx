import { getTranslations, setRequestLocale } from "next-intl/server";
import { logoutAction } from "@/server/actions/auth";
import { requireCustomerPage } from "@/server/auth/current";
import { AccountNav } from "@/components/account/account-nav";
import { LogoutIcon } from "@/components/ui/icons";
import { Container } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export default async function AccountLayout({ children, params }: LayoutProps<"/[locale]/account">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireCustomerPage(locale, "/account");
  const t = await getTranslations("account");
  return (
    <Container className="py-10">
      <div className="grid gap-8 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4">
          <p className="font-display text-lg font-semibold">{t("welcome", { name: user.name })}</p>
          <AccountNav />
          <form action={logoutAction}>
            <SubmitButton variant="ghost" size="sm" className="text-muted">
              <LogoutIcon size={16} />
              {t("signOut")}
            </SubmitButton>
          </form>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </Container>
  );
}
