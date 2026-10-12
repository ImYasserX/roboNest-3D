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
  clearTurntable,
  updateImageAlt,
  updateInventory,
  updateProduct,
} from "@/server/services/product-admin";
import { bulkDeleteDigitalFiles, bulkSetDigitalFilesActive, renameDigitalFile } from "@/server/services/digital-file-admin";
import { bulkDeleteProducts, bulkUpdateProducts, previewBulkDelete, type BulkProblem } from "@/server/services/product-bulk";
import { approvePreview, auditLegacyPreview, deletePreview, generatePreviewFromFile, rejectPreview, type LegacyAudit } from "@/server/services/previews";

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

/** Removes the turntable frames (rendered images) of a product. Never touches models. */
export async function clearTurntableAction(formData: FormData): Promise<void> {
  const productId = uuid.safeParse(formData.get("productId"));
  if (!productId.success) return;
  await withAdmin("products.edit", async ({ db, actor }) => {
    const res = await clearTurntable(db, productId.data, actor);
    const media = (await getEnv()).MEDIA;
    for (const key of res.keys) if (key.startsWith("turntables/")) await media.delete(key);
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Interactive 3D preview proxies
// ---------------------------------------------------------------------------

export type PreviewState = { ok?: boolean; error?: string; reasons?: string[]; triangles?: number; sourceTriangles?: number } | null;

/** Builds a reduced proxy from a paid file (server side). Lands as "pending review". */
export async function generatePreviewAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const p = z
    .object({ productId: uuid, fileId: uuid, detail: z.enum(["low", "medium", "high"]).catch("medium") })
    .safeParse(Object.fromEntries(formData));
  if (!p.success) return { error: "not_found" };
  const targetTriangles = { low: 2_500, medium: 6_000, high: 12_000 }[p.data.detail];
  const res = await withAdmin("products.edit", async ({ db, actor }) => generatePreviewFromFile(db, await getEnv(), p.data.productId, p.data.fileId, actor, { targetTriangles }));
  if (!res.ok) return { error: res.error, reasons: "reasons" in res ? res.reasons : undefined };
  refresh();
  return { ok: true, triangles: res.triangles, sourceTriangles: res.sourceTriangles };
}

export async function approvePreviewAction(_prev: PreviewState, formData: FormData): Promise<PreviewState> {
  const previewId = uuid.safeParse(formData.get("previewId"));
  if (!previewId.success) return { error: "not_found" };
  const res = await withAdmin("previews.approve", async ({ db, actor }) => approvePreview(db, await getEnv(), previewId.data, actor));
  if (!res.ok) return { error: res.error, reasons: "reasons" in res ? res.reasons : undefined };
  refresh();
  return { ok: true };
}

/** Rejects a candidate or withdraws the live preview. */
export async function rejectPreviewAction(formData: FormData): Promise<void> {
  const previewId = uuid.safeParse(formData.get("previewId"));
  if (!previewId.success) return;
  await withAdmin("previews.approve", ({ db, actor }) => rejectPreview(db, previewId.data, String(formData.get("reason") ?? ""), actor));
  refresh();
}

export async function deletePreviewAction(formData: FormData): Promise<void> {
  const previewId = uuid.safeParse(formData.get("previewId"));
  if (!previewId.success) return;
  await withAdmin("products.edit", async ({ db, actor }) => deletePreview(db, (await getEnv()).MEDIA, previewId.data, actor));
  refresh();
}

/** Inspects the legacy GLB (never serves, publishes, moves or deletes it). */
export async function auditLegacyPreviewAction(_prev: { result?: LegacyAudit; error?: string } | null, formData: FormData) {
  const productId = uuid.safeParse(formData.get("productId"));
  if (!productId.success) return { error: "not_found" };
  const res = await withAdmin("products.edit", async ({ db, actor }) => ({ ok: true as const, result: await auditLegacyPreview(db, await getEnv(), productId.data, actor) }));
  if (!res.ok) return { error: res.error };
  return { result: res.result };
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

// ---------------------------------------------------------------------------
// Bulk product management. The client sends WHICH products (ids, or the
// current filters for "all matching") and WHAT to change; the server resolves
// the selection, validates everything and re-checks permissions.
// ---------------------------------------------------------------------------

export type BulkState = {
  ok?: boolean;
  error?: string;
  problems?: BulkProblem[];
  selected?: number;
  updated?: number;
  unchanged?: number;
  results?: { id: string; name: string; outcome: string; error?: string }[];
  plan?: { id: string; name: string; status: string; orders: number; paidOrders: number; files: number; previews: number; action: string }[];
} | null;

function json(formData: FormData, key: string): unknown {
  try {
    return JSON.parse(String(formData.get(key) ?? "null"));
  } catch {
    return null;
  }
}

export async function bulkUpdateProductsAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const res = await withAdmin("products.edit", ({ db, actor }) => bulkUpdateProducts(db, json(formData, "selection"), json(formData, "edit"), actor));
  if (!res.ok) return { error: res.error, problems: "problems" in res ? res.problems : undefined, selected: "selected" in res ? res.selected : undefined };
  refresh();
  return { ok: true, selected: res.selected, updated: res.updated, unchanged: res.unchanged };
}

/** Read-only: what a bulk delete would do (shown before confirming). */
export async function previewBulkDeleteAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const res = await withAdmin("products.delete", ({ db }) => previewBulkDelete(db, json(formData, "selection")));
  if (!res.ok) return { error: res.error };
  return { ok: true, plan: res.items };
}

export async function bulkDeleteProductsAction(_prev: BulkState, formData: FormData): Promise<BulkState> {
  if (String(formData.get("confirmText") ?? "").trim() !== "DELETE") return { error: "confirm_required" };
  const res = await withAdmin("products.delete", async ({ db, actor }) => {
    const result = await bulkDeleteProducts(db, json(formData, "selection"), actor);
    if (result.ok) {
      // Storage cleanup only after the database rows are gone (reference check done in the service).
      const env = await getEnv();
      for (let i = 0; i < result.mediaKeys.length; i += 1000) await env.MEDIA.delete(result.mediaKeys.slice(i, i + 1000));
      for (let i = 0; i < result.privateKeys.length; i += 1000) await env.PRIVATE_FILES.delete(result.privateKeys.slice(i, i + 1000));
    }
    return result;
  });
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true, results: res.results };
}

// ---------------------------------------------------------------------------
// Digital files (original paid files). Never made public by any of these.
// ---------------------------------------------------------------------------

export type FileBulkState = { ok?: boolean; error?: string; changed?: number; unchanged?: number; deleted?: number; kept?: { id: string; filename: string; orders: number }[]; buyers?: number } | null;

export async function bulkSetFilesActiveAction(_prev: FileBulkState, formData: FormData): Promise<FileBulkState> {
  const active = formData.get("active") === "1";
  const res = await withAdmin("digitalFiles.manage", ({ db, actor }) => bulkSetDigitalFilesActive(db, json(formData, "ids"), active, formData.get("acknowledge") === "on", actor));
  if (!res.ok) return { error: res.error, buyers: "buyers" in res ? res.buyers : undefined };
  refresh();
  return { ok: true, changed: res.changed, unchanged: res.unchanged };
}

/** Permanent deletion of unreferenced paid files: same permission as deleting a single file (products.delete). */
export async function bulkDeleteFilesAction(_prev: FileBulkState, formData: FormData): Promise<FileBulkState> {
  if (String(formData.get("confirmText") ?? "").trim() !== "DELETE") return { error: "confirm_required" };
  const res = await withAdmin("products.delete", async ({ db, actor }) => {
    const result = await bulkDeleteDigitalFiles(db, json(formData, "ids"), actor);
    if (result.ok && result.keys.length) await (await getEnv()).PRIVATE_FILES.delete(result.keys);
    return result;
  });
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true, deleted: res.deleted, kept: res.kept };
}

export async function renameDigitalFileAction(_prev: FileBulkState, formData: FormData): Promise<FileBulkState> {
  const fileId = String(formData.get("fileId") ?? "");
  const res = await withAdmin("digitalFiles.manage", ({ db, actor }) => renameDigitalFile(db, fileId, formData.get("filename"), actor));
  if (!res.ok) return { error: res.error };
  refresh();
  return { ok: true };
}
