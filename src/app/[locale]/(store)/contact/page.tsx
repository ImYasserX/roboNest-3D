import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/services/settings";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { pickText } from "@/lib/localize";
import { alternates } from "@/lib/seo";
import { ContactForm } from "@/components/layout/contact-form";
import { Card, Container, PageHeader } from "@/components/ui/misc";
import { WhatsappIcon } from "@/components/ui/icons";

export async function generateMetadata({ params }: PageProps<"/[locale]/contact">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "contact" });
  return { title: t("title"), description: t("description"), alternates: alternates(locale, "/contact") };
}

export default async function ContactPage({ params }: PageProps<"/[locale]/contact">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("contact");
  const store = await getSetting(await getDb(), "store");
  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <Card as="section" aria-labelledby="contact-form" className="space-y-5 p-5 sm:p-8">
          <h2 id="contact-form" className="font-display text-xl font-semibold">{t("formTitle")}</h2>
          <ContactForm />
        </Card>
        <aside>
          <dl className="space-y-4 rounded-xl border border-border bg-surface p-5 text-sm">
            {store.whatsapp ? (
              <div>
                <dt className="text-muted">{t("whatsapp")}</dt>
                <dd>
                  <a href={whatsappLink(store.whatsapp)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 font-semibold text-primary-text underline">
                    <WhatsappIcon size={18} /> <span className="ltr-nums">{formatIraqiPhone(store.whatsapp)}</span>
                  </a>
                </dd>
              </div>
            ) : null}
            {store.phone ? (
              <div>
                <dt className="text-muted">{t("phoneLabel")}</dt>
                <dd><a href={`tel:${store.phone}`} className="ltr-nums font-semibold underline">{formatIraqiPhone(store.phone)}</a></dd>
              </div>
            ) : null}
            {store.email ? (
              <div>
                <dt className="text-muted">{t("email")}</dt>
                <dd><a href={`mailto:${store.email}`} className="font-semibold underline">{store.email}</a></dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">{t("hours")}</dt>
              <dd>{pickText(locale, store.hours)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("address")}</dt>
              <dd>{pickText(locale, store.address)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </Container>
  );
}
