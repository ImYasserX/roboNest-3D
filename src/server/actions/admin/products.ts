"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { formObject, withAdmin } from "@/server/admin-action";
import { getEnv } from "@/server/env";
import {
  archiveProduct,
  createProduct,
  deleteDigitalFile,
  deleteOption,
  deleteOptionValue,
  deleteProduct,
  deleteProductImage,
  moveImage,
  saveOption,
  saveOptionValue,
  setDigitalFileActive,
  setPreviewModel,
  updateImageAlt,
  updateInventory,
  updateProduct,
} from "@/server/services/product-admin";

export type ProductFormState = { ok?: boolean; error?: string; errors?: Record<string, string> } | null;
type State = { ok?: boolean; error?: string } | null;

const uuid = z.string().uuid();

export async function saveProductAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const data = formObject(formData);
  const id = data.id ? uuid.safeParse(data.id) : null;
  if (id && !id.success) return { error: "not_found" };
  data.isFeatured = formData.get("isFeatured") ? "on" : "";
  const res = await withAdmin("products.edit", ({ db, actor }) => (id ? updateProduct(db, id.data!, data, actor) : createProduct(db, data, actor)));
  if ("error" in res) return { error: res.error };
  if (!res.ok) return { error: "invalid_input", errors: res.errors };
  if (!id) redirect(`/${await getLocale()}/admin/products/${res.id}?created=1`);
  refresh();
  return { ok: true };
}

export async function archiveProductAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("products.edit", ({ db, actor }) => archiveProduct(db, id.data, actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function deleteProductAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("products.delete", async ({ db, actor }) => {
    const result = await deleteProduct(db, id.data, actor);
    if (result.ok) {
      const env = await getEnv();
      if (result.mediaKeys.length) await env.MEDIA.delete(result.mediaKeys);
      if (result.privateKeys.length) await env.PRIVATE_FILES.delete(result.privateKeys);
    }
    return result;
  });
  if (!res.ok) return { error: res.error };
  redirect(`/${await getLocale()}/admin/products?deleted=1`);
}

export async function saveOptionAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const data = formObject(formData);
  const productId = uuid.safeParse(data.productId);
  const optionId = data.optionId ? uuid.safeParse(data.optionId) : null;
  if (!productId.success || (optionId && !optionId.success)) return { error: "not_found" };
  data.isRequired = formData.get("isRequired") ? "on" : "";
  const res = await withAdmin("products.edit", ({ db, actor }) => saveOption(db, productId.data, optionId?.data ?? null, data, actor));
  if ("error" in res) return { error: res.error };
  if (!res.ok) return { error: "invalid_input", errors: res.errors };
  refresh();
  return { ok: true };
}

export async function deleteOptionAction(_prev: State, formData: FormData): Promise<State> {
  const p = z.object({ productId: uuid, optionId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "not_found" };
  const res = await withAdmin("products.edit", ({ db, actor }) => deleteOption(db, p.data.productId, p.data.optionId, actor));
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function saveOptionValueAction(_prev: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const data = formObject(formData);
  const p = z.object({ productId: uuid, optionId: uuid, valueId: uuid.optional().or(z.literal("")) }).safeParse(data);
  if (!p.success) return { error: "not_found" };
  data.isActive = formData.get("isActive") ? "on" : "";
  const res = await withAdmin("products.edit", ({ db, actor }) => saveOptionValue(db, p.data.productId, p.data.optionId, p.data.valueId || null, data, actor));
  if ("error" in res) return { error: res.error };
  if (!res.ok) return { error: "invalid_input", errors: res.errors };
  refresh();
  return { ok: true };
}

export async function deleteOptionValueAction(_prev: State, formData: FormData): Promise<State> {
  const p = z.object({ productId: uuid, optionId: uuid, valueId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "not_found" };
  const res = await withAdmin("products.edit", ({ db, actor }) => deleteOptionValue(db, p.data.productId, p.data.optionId, p.data.valueId, actor));
  if ("error" in res) return { error: res.error };
  refresh();
  return { ok: true };
}

export async function updateImageAltAction(_prev: State, formData: FormData): Promise<State> {
  const p = z.object({ productId: uuid, imageId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "not_found" };
  const res = await withAdmin("products.edit", ({ db }) => updateImageAlt(db, p.data.productId, p.data.imageId, { altEn: formData.get("altEn"), altAr: formData.get("altAr") }));
  if ("error" in res) return { error: res.error };
  return res.ok ? { ok: true } : { error: "invalid_input" };
}

export async function moveImageAction(formData: FormData): Promise<void> {
  const p = z.object({ productId: uuid, imageId: uuid, direction: z.enum(["up", "down", "primary"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withAdmin("products.edit", ({ db }) => moveImage(db, p.data.productId, p.data.imageId, p.data.direction));
  refresh();
}

export async function deleteImageAction(formData: FormData): Promise<void> {
  const p = z.object({ productId: uuid, imageId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withAdmin("products.edit", async ({ db, actor }) => {
    const res = await deleteProductImage(db, p.data.productId, p.data.imageId, actor);
    if (res.ok) await (await getEnv()).MEDIA.delete(res.key);
  });
  refresh();
}

export async function removePreviewAction(formData: FormData): Promise<void> {
  const productId = uuid.safeParse(formData.get("productId"));
  if (!productId.success) return;
  await withAdmin("products.edit", async ({ db, actor }) => {
    const res = await setPreviewModel(db, productId.data, null, actor);
    if (res.ok && res.previousKey) await (await getEnv()).MEDIA.delete(res.previousKey);
  });
  refresh();
}

export async function setDigitalFileActiveAction(formData: FormData): Promise<void> {
  const p = z.object({ productId: uuid, fileId: uuid, active: z.enum(["0", "1"]) }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withAdmin("digitalFiles.manage", ({ db, actor }) => setDigitalFileActive(db, p.data.productId, p.data.fileId, p.data.active === "1", actor));
  refresh();
}

/** Permanent removal of a file customers may have bought: Super Admin only. */
export async function deleteDigitalFileAction(formData: FormData): Promise<void> {
  const p = z.object({ productId: uuid, fileId: uuid }).safeParse(Object.fromEntries(formData));
  if (!p.success) return;
  await withAdmin("products.delete", async ({ db, actor }) => {
    const res = await deleteDigitalFile(db, p.data.productId, p.data.fileId, actor);
    if (res.ok) await (await getEnv()).PRIVATE_FILES.delete(res.key);
  });
  refresh();
}

export async function updateInventoryAction(_prev: State, formData: FormData): Promise<State> {
  const id = uuid.safeParse(formData.get("id"));
  if (!id.success) return { error: "not_found" };
  const res = await withAdmin("inventory.edit", ({ db, actor }) => updateInventory(db, id.data, { availability: formData.get("availability"), stockQuantity: formData.get("stockQuantity") }, actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}
