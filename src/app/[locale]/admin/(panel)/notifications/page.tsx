import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { getNotifierConfig } from "@/server/notify";
import { retryNotificationAction, sendTestNotificationAction } from "@/server/actions/admin/manage";
import { listNotificationEvents } from "@/server/services/notifications";
import { formatDate } from "@/lib/localize";
import { Link } from "@/i18n/navigation";
import { ActionForm } from "@/components/admin/action-form";
import { AdminPageHeader, Panel } from "@/components/admin/ui";
import { Alert, Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/notifications">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.notifications" }))("title") };
}

/** Maps a stored Telegram error to an actionable hint (see README → Telegram troubleshooting). */
function diagnose(error: string): "notConfigured" | "token" | "notStarted" | "chatNotFound" | "rateLimited" | "network" | "other" {
  if (/not configured/i.test(error)) return "notConfigured";
  if (/\b401\b|unauthorized/i.test(error)) return "token";
  if (/\b403\b|blocked|can't initiate|bot was/i.test(error)) return "notStarted";
  if (/chat not found|\b400\b/i.test(error)) return "chatNotFound";
  if (/\b429\b|too many/i.test(error)) return "rateLimited";
  if (/network|timeout|abort/i.test(error)) return "network";
  return "other";
}

export default async function NotificationsPage({ params }: PageProps<"/[locale]/admin/notifications">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "notifications.manage");
  const [t, lang] = await Promise.all([getTranslations("admin.notifications"), getLocale()]);
  const [config, events] = await Promise.all([getNotifierConfig(), listNotificationEvents(await getDb())]);
  return (
    <div className="space-y-6">
      <AdminPageHeader title={t("title")} description={t("description")} />
      <Panel title={t("config")} id="config">
        {/* Only whether secrets exist and how many chats: never their values. */}
        {config ? (
          <>
            <Alert tone="success">{t("configured", { count: config.chatIds.length })}</Alert>
            {config.chatIds.length < 2 ? <Alert tone="warning" className="mt-2">{t("fewerThanOwners")}</Alert> : null}
            {config.invalidChatIds ? <Alert tone="warning" className="mt-2">{t("invalidChatIds", { count: config.invalidChatIds })}</Alert> : null}
          </>
        ) : (
          <Alert tone="warning" title={t("notConfiguredTitle")}>{t("notConfiguredText")}</Alert>
        )}
        <div className="mt-4">
          <ActionForm action={sendTestNotificationAction} errorNamespace="admin.notifications" successText={t("testSent")}>
            <p className="text-sm text-muted">{t("testHint")}</p>
            <SubmitButton variant="secondary">{t("sendTest")}</SubmitButton>
          </ActionForm>
        </div>
      </Panel>
      <Panel title={t("events")} id="events">
        {events.length === 0 ? <p className="text-sm text-muted">{t("none")}</p> : null}
        <ul className="divide-y divide-border">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm">
              <div className="min-w-0 space-y-1">
                <p className="font-medium">
                  {t(`kind.${e.kind}`)}
                  {e.payload.orderNumber ? (
                    <>
                      {" · "}
                      {e.orderId ? <Link href={`/admin/orders/${e.orderId}`} className="ltr-nums underline">{String(e.payload.orderNumber)}</Link> : <span className="ltr-nums">{String(e.payload.orderNumber)}</span>}
                    </>
                  ) : null}
                </p>
                <p className="text-muted">
                  {formatDate(e.createdAt, lang, true)} · {t("attempts", { count: e.attempts })} · {t("deliveredOf", { count: Number(e.deliveredCount), total: config?.chatIds.length ?? 0 })}
                </p>
                {e.lastError ? (
                  <>
                    <p className="break-all text-danger">{e.lastError}</p>
                    <p className="text-muted">{t(`hint.${diagnose(e.lastError)}`)}</p>
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={e.status === "SENT" ? "success" : e.status === "FAILED" ? "danger" : "warning"}>{t(`status.${e.status}`)}</Badge>
                {e.status !== "SENT" ? (
                  <ActionForm action={retryNotificationAction} errorNamespace="admin.notifications" successText={t("testSent")} className="contents">
                    <input type="hidden" name="id" value={e.id} />
                    <SubmitButton size="sm" variant="secondary">{t("retry")}</SubmitButton>
                  </ActionForm>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
