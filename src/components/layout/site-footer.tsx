import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/services/settings";
import { formatIraqiPhone, whatsappLink } from "@/lib/phone";
import { pickText } from "@/lib/localize";
import { Container } from "@/components/ui/misc";
import { WhatsappIcon } from "@/components/ui/icons";

export async function SiteFooter() {
  const [t, tn, tm, locale, db] = await Promise.all([getTranslations("footer"), getTranslations("nav"), getTranslations("meta"), getLocale(), getDb()]);
  const store = await getSetting(db, "store");
  const columns = [
    {
      title: t("shop"),
      links: [
        { href: "/products", label: tn("products") },
        { href: "/categories", label: tn("categories") },
        { href: "/models", label: tn("models") },
        { href: "/custom-printing", label: tn("customPrinting") },
      ],
    },
    {
      title: t("help"),
      links: [
        { href: "/track", label: t("trackOrder") },
        { href: "/delivery", label: t("delivery") },
        { href: "/returns", label: t("returns") },
        { href: "/faq", label: t("faq") },
        { href: "/contact", label: t("contact") },
      ],
    },
    {
      title: t("company"),
      links: [
        { href: "/about", label: tn("about") },
        { href: "/privacy", label: t("privacy") },
        { href: "/terms", label: t("terms") },
      ],
    },
  ];
  return (
    <footer className="mt-24 border-t border-border bg-surface">
      <Container className="grid gap-10 py-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-4">
          <p className="font-display text-xl font-extrabold" dir="ltr">
            RoboNest<span className="text-primary-text">.3D</span>
          </p>
          <p className="text-sm font-semibold text-primary-text">{tm("tagline")}</p>
          <p className="max-w-sm text-sm text-muted">{t("about")}</p>
          <p className="text-sm text-muted">{t("payment")}</p>
          {store.whatsapp ? (
            <a href={whatsappLink(store.whatsapp)} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium hover:bg-surface-2">
              <WhatsappIcon size={18} />
              <span>{tn("contact")}: </span>
              <span className="ltr-nums">{formatIraqiPhone(store.whatsapp)}</span>
            </a>
          ) : null}
        </div>
        {columns.map((col) => (
          <nav key={col.title} aria-label={col.title}>
            <h2 className="mb-3 text-sm font-semibold">{col.title}</h2>
            <ul className="space-y-1">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-muted hover:text-text hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <div className="border-t border-border">
        <Container className="flex flex-col gap-2 py-5 text-xs text-muted sm:flex-row sm:justify-between">
          <p>{t("rights", { year: new Date().getFullYear() })}</p>
          <p>{pickText(locale, store.address)}</p>
        </Container>
      </div>
    </footer>
  );
}
