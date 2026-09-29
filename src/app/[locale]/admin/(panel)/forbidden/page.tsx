import { getTranslations, setRequestLocale } from "next-intl/server";
import { Alert } from "@/components/ui/misc";

export default async function ForbiddenPage({ params }: PageProps<"/[locale]/admin/forbidden">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin.forbidden");
  return (
    <div className="max-w-xl space-y-4">
      <h1 className="font-display text-2xl font-bold">{t("title")}</h1>
      <Alert tone="warning">{t("text")}</Alert>
    </div>
  );
}
