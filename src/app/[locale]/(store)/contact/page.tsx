import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getAppSecret } from "@/server/env";
import { contactFormToken } from "@/server/services/contact";
import { BUSINESS, businessWhatsappUrl } from "@/lib/business";
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
  const [t, tn] = await Promise.all([getTranslations("contact"), getTranslations("nav")]);
  const formToken = await contactFormToken(await getAppSecret());
  return (
    <Container className="space-y-8 py-10">
      <PageHeader title={t("title")} description={t("description")} />
      <div className="grid gap-8 lg:grid-cols-[1fr_20rem]">
        <Card as="section" aria-labelledby="contact-form" className="space-y-5 p-5 sm:p-8">
          <h2 id="contact-form" className="font-display text-xl font-semibold">{t("formTitle")}</h2>
          <ContactForm formToken={formToken} />
        </Card>
        <aside>
          <dl className="space-y-4 rounded-xl border border-border bg-surface p-5 text-sm">
            <div>
              <dt className="text-muted">{t("email")}</dt>
              <dd><a href={`mailto:${BUSINESS.email}`} className="inline-flex min-h-10 items-center font-semibold underline">{BUSINESS.email}</a></dd>
            </div>
            <div>
              <dt className="text-muted">{t("phoneLabel")}</dt>
              {BUSINESS.phones.map((p) => (
                <dd key={p.tel}><a href={`tel:${p.tel}`} className="ltr-nums inline-flex min-h-10 items-center font-semibold underline">{p.display}</a></dd>
              ))}
            </div>
            <div>
              <dt className="text-muted">{t("whatsapp")}</dt>
              <dd>
                <a
                  href={businessWhatsappUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={tn("whatsappChat", { number: BUSINESS.whatsapp.display })}
                  className="inline-flex min-h-10 items-center gap-2 font-semibold text-primary-text underline"
                >
                  <WhatsappIcon size={18} /> <span className="ltr-nums">{BUSINESS.whatsapp.display}</span>
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("hours")}</dt>
              <dd>{pickText(locale, BUSINESS.hours)}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </Container>
  );
}
