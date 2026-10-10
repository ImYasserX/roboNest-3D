import type { Metadata } from "next";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { setMessageStatusAction } from "@/server/actions/admin/manage";
import { listContactMessages } from "@/server/services/engagement";
import { CONTACT_STATUSES } from "@/lib/domain";
import { formatDate } from "@/lib/localize";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { AdminPageHeader, FilterBar } from "@/components/admin/ui";
import { Badge } from "@/components/ui/misc";
import { SubmitButton } from "@/components/ui/submit-button";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/messages">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.messages" }))("title") };
}

export default async function MessagesPage({ params, searchParams }: PageProps<"/[locale]/admin/messages">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "messages.view");
  const [t, tc, lang] = await Promise.all([getTranslations("admin.messages"), getTranslations("admin.common"), getLocale()]);
  const status = (await searchParams).status;
  const rows = await listContactMessages(await getDb(), typeof status === "string" ? status : undefined);
  return (
    <div className="max-w-4xl">
      <AdminPageHeader title={t("title")} />
      <FilterBar action={`/${locale}/admin/messages`} selects={[{ name: "status", label: tc("status"), value: typeof status === "string" ? status : undefined, options: CONTACT_STATUSES.map((s) => [s, t(s)]) }]} />
      {rows.length === 0 ? <p className="text-muted">{t("none")}</p> : null}
      <ul className="space-y-3">
        {rows.map((m) => (
          <li key={m.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{m.subject}</span>
              <Badge tone={m.status === "NEW" ? "warning" : "neutral"}>{t(m.status)}</Badge>
              <span className="text-xs text-muted">{formatDate(m.createdAt, lang, true)}</span>
            </div>
            <p className="mt-1 text-sm">
              {t("from")}: {m.name}
              {m.email ? <> · <a href={`mailto:${m.email}`} className="underline" dir="ltr">{m.email}</a></> : null}
              {m.phone ? <> · <a href={whatsappLink(m.phone)} target="_blank" rel="noopener noreferrer" className="ltr-nums underline">{formatIraqiPhone(m.phone)}</a></> : null}
            </p>
            {m.deliveryStatus ? (
              <p className="mt-1 text-xs">
                <Badge tone={m.deliveryStatus === "SENT" ? "success" : "danger"}>{t(`delivery_${m.deliveryStatus}`)}</Badge>
              </p>
            ) : null}
            <p className="mt-2 whitespace-pre-line text-sm">{m.message}</p>
            <div className="mt-3 flex gap-2">
              {m.status === "NEW" ? (
                <form action={setMessageStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="READ" /><SubmitButton variant="secondary" size="sm">{t("markRead")}</SubmitButton></form>
              ) : null}
              {m.status !== "ARCHIVED" ? (
                <form action={setMessageStatusAction}><input type="hidden" name="id" value={m.id} /><input type="hidden" name="status" value="ARCHIVED" /><SubmitButton variant="ghost" size="sm">{t("archive")}</SubmitButton></form>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
