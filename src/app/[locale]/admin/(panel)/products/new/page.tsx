import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdminPage } from "@/server/auth/current";
import { getDb } from "@/server/db/client";
import { categoryOptions } from "@/server/admin-categories";
import { ProductForm } from "@/components/admin/product-form";
import { AdminPageHeader } from "@/components/admin/ui";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/products/new">): Promise<Metadata> {
  const { locale } = await params;
  return { title: (await getTranslations({ locale, namespace: "admin.products" }))("newTitle") };
}

export default async function NewProductPage({ params }: PageProps<"/[locale]/admin/products/new">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdminPage(locale, "products.edit");
  const t = await getTranslations("admin.products");
  return (
    <div className="max-w-5xl">
      <AdminPageHeader title={t("newTitle")} />
      <ProductForm values={{ status: "DRAFT", availability: "MADE_TO_ORDER", productType: "PHYSICAL" }} categories={await categoryOptions(await getDb(), locale)} />
    </div>
  );
}
