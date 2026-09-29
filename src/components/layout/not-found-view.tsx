import { useTranslations } from "next-intl";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/misc";

export function NotFoundView() {
  const t = useTranslations("errors");
  const tn = useTranslations("nav");
  return (
    <Container className="flex min-h-[60vh] flex-col items-center justify-center gap-5 py-16 text-center">
      <p className="ltr-nums font-display text-6xl font-extrabold text-primary-text">404</p>
      <h1 className="font-display text-3xl font-bold">{t("notFoundTitle")}</h1>
      <p className="max-w-md text-muted">{t("notFoundText")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <ButtonLink href="/">{t("goHome")}</ButtonLink>
        <ButtonLink href="/products" variant="outline">{tn("products")}</ButtonLink>
      </div>
    </Container>
  );
}
