import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { auditLogs, digitalFiles, orderItems, previewModels, products, siteSettings } from "@/server/db/schema";
import { addToCart } from "@/server/services/cart";
import { authorizeDownload } from "@/server/services/downloads";
import { getProductBySlug, getProductCardsByIds } from "@/server/services/catalog";
import { placeOrder } from "@/server/services/orders";
import {
  approvePreview,
  auditLegacyPreview,
  generatePreviewFromFile,
  rejectPreview,
  uploadPreviewCandidate,
} from "@/server/services/previews";
import { buildProxy, inspectProxyGlb, parseGlb, parseStl, sha256Hex, writeProxyGlb } from "@/server/preview/proxy";
import { PUBLIC_MEDIA_KEY, UPLOAD_RULES } from "@/server/storage/file-rules";
import { hasPermission } from "@/lib/permissions";
import { GET as mediaRoute } from "@/app/media/[...key]/route";
import { GET as previewRoute } from "@/app/api/previews/[id]/route";
import * as M from "../../scripts/lib/mesh";
import { toGlb, toStl } from "../../scripts/lib/formats";
import { startPlatform, type TestPlatform } from "../support/platform";
import { confirmDue } from "../support/payments";
import { makeProduct, makeUser } from "../support/fixtures";

let p: TestPlatform;
const SECRET = "test-app-secret-at-least-32-characters-long";
const actor = { adminId: null as unknown as string, label: "test" };
beforeAll(async () => {
  p = await startPlatform();
});
afterAll(async () => p?.dispose());

const uuid = () => crypto.randomUUID();
const media = (key: string) => mediaRoute(new Request(`http://localhost/media/${key}`), { params: Promise.resolve({ key: key.split("/") }) } as never);
const preview = (id: string, headers: Record<string, string> = {}) =>
  previewRoute(new Request(`http://localhost/api/previews/${id}`, { headers }), { params: Promise.resolve({ id }) } as never);

/** A realistic "paid original": dense, real millimetre dimensions, fine detail. */
function originalMesh(): M.Mesh {
  const body = M.subdivide(M.cylinder(30, 12, 64), 20_000);
  const pin = M.translate(M.cylinder(1.2, 4, 12), [0, 12, 0]); // a fine feature
  return M.merge(body, pin);
}

async function digitalProductWithStl(status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", status });
  const stl = toStl(originalMesh(), "paid original");
  const key = `digital/2026/10/${uuid()}.stl`;
  await p.env.PRIVATE_FILES.put(key, stl);
  const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: key, filename: "paid.stl", format: "STL", sizeBytes: stl.byteLength }).returning();
  return { product, file, stl };
}

async function approvedPreview(status: "PUBLISHED" | "DRAFT" = "PUBLISHED") {
  const ctx = await digitalProductWithStl(status);
  const made = await generatePreviewFromFile(p.db, p.env, ctx.product.id, ctx.file.id, actor);
  if (!made.ok) throw new Error(made.error);
  const approved = await approvePreview(p.db, p.env, made.id, actor);
  if (!approved.ok) throw new Error(approved.error);
  const [row] = await p.db.select().from(previewModels).where(eq(previewModels.id, made.id));
  return { ...ctx, row };
}

describe("1. originals vs proxies: told apart by content, not by extension", () => {
  it("a raw original exported as GLB fails the proxy validator; the generated proxy passes", async () => {
    const raw = toGlb(originalMesh(), [0.5, 0.4, 0.9], "paid");
    const rawCheck = inspectProxyGlb(raw);
    expect(rawCheck.ok).toBe(false);
    expect(rawCheck.reasons).toEqual(expect.arrayContaining(["too_many_triangles", "not_quantized", "not_normalized"]));
    const proxy = writeProxyGlb(buildProxy(originalMesh()).mesh);
    expect(inspectProxyGlb(proxy)).toMatchObject({ ok: true, reasons: [] });
  });

  it("an STL, HTML or random bytes named .glb are rejected by content", () => {
    for (const bytes of [toStl(originalMesh(), "x"), new TextEncoder().encode("<html><script>alert(1)</script></html>"), crypto.getRandomValues(new Uint8Array(2048))]) {
      expect(inspectProxyGlb(bytes).ok).toBe(false);
    }
  });

  it("a GLB with textures, extensions or external buffers is rejected even when small", () => {
    const proxy = writeProxyGlb(buildProxy(originalMesh()).mesh);
    const { json } = parseGlb(proxy);
    const rebuild = (extra: Record<string, unknown>) => {
      const text = new TextEncoder().encode(JSON.stringify({ ...json, ...extra }).padEnd(Math.ceil(JSON.stringify({ ...json, ...extra }).length / 4) * 4, " "));
      const oldJsonLen = new DataView(proxy.buffer).getUint32(12, true);
      const bin = proxy.subarray(20 + oldJsonLen);
      const out = new Uint8Array(20 + text.length + bin.length);
      const v = new DataView(out.buffer);
      v.setUint32(0, 0x46546c67, true); v.setUint32(4, 2, true); v.setUint32(8, out.length, true);
      v.setUint32(12, text.length, true); v.setUint32(16, 0x4e4f534a, true);
      out.set(text, 20); out.set(bin, 20 + text.length);
      return out;
    };
    expect(inspectProxyGlb(rebuild({ images: [{ uri: "https://evil.example/x.png" }] })).reasons).toContain("has_images");
    expect(inspectProxyGlb(rebuild({ extensionsUsed: ["KHR_draco_mesh_compression"] })).reasons).toContain("has_extensions");
    expect(inspectProxyGlb(rebuild({ buffers: [{ byteLength: 10, uri: "../../digital/x.bin" }] })).reasons).toContain("external_or_multiple_buffers");
  });
});

describe("2. the generated proxy is a reduced, separate asset", () => {
  it("has a different hash, ≤ 50 % of the triangles, unit size (no mm dimensions) and quantized coordinates", async () => {
    const { file, stl, row } = await approvedPreview();
    const object = await p.env.MEDIA.get(row.r2Key);
    const glb = new Uint8Array(await object!.arrayBuffer());
    const source = parseStl(stl);
    const proxy = parseGlb(glb).mesh;
    expect(await sha256Hex(glb)).not.toBe(await sha256Hex(stl));
    expect(row.sha256).not.toBe((await p.db.select().from(digitalFiles).where(eq(digitalFiles.id, file.id)))[0].sha256);
    expect(proxy.indices.length / 3).toBeLessThanOrEqual((source.indices.length / 3) * 0.5);
    const extent = (m: M.Mesh) => Math.max(...[0, 1, 2].map((a) => m.positions.reduce((hi, q) => Math.max(hi, q[a]), -Infinity) - m.positions.reduce((lo, q) => Math.min(lo, q[a]), Infinity)));
    expect(extent(source)).toBeCloseTo(60, 0); // real size: 60 mm
    expect(extent(proxy)).toBeLessThanOrEqual(1.0001); // proxy: unit size
    expect(inspectProxyGlb(glb).maxDistinctPerAxis).toBeLessThanOrEqual(97);
    // Stored apart from the paid file, in MEDIA under its own prefix, with no source metadata.
    expect(row.r2Key).toMatch(/^preview-proxies\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.glb$/);
    expect(await p.env.PRIVATE_FILES.head(row.r2Key)).toBeNull();
    const text = new TextDecoder().decode(glb.subarray(0, 2000));
    expect(text).not.toMatch(/paid|\.stl|digital\/|"name"|extras/);
  });

  it("refuses to record a copy of a paid file as a preview (app check and database trigger)", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    // A paid file that happens to be small and proxy-shaped: its exact bytes can still never become the preview.
    const paidGlb = writeProxyGlb(buildProxy(originalMesh(), { targetTriangles: 3000 }).mesh);
    const key = `digital/2026/10/${uuid()}.glb`;
    await p.env.PRIVATE_FILES.put(key, paidGlb);
    await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: key, filename: "paid.glb", format: "GLB", sizeBytes: paidGlb.byteLength });
    expect(await uploadPreviewCandidate(p.db, p.env, product.id, paidGlb, actor)).toMatchObject({ ok: false, error: "matches_original" });
    expect(await p.db.$count(previewModels, eq(previewModels.productId, product.id))).toBe(0);
    await expect(
      p.db.insert(previewModels).values({ productId: product.id, r2Key: `preview-proxies/2026/10/${uuid()}.glb`, source: "UPLOADED", sha256: await sha256Hex(paidGlb), sizeBytes: 1, triangleCount: 1, vertexCount: 1 }),
    ).rejects.toThrow();
  });

  it("refuses an uploaded proxy that is not reduced relative to the paid original", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL" });
    const small = M.subdivide(M.box(20, 20, 20), 2_000); // a 3 072-triangle "original"
    const stl = toStl(small, "paid");
    const key = `digital/2026/10/${uuid()}.stl`;
    await p.env.PRIVATE_FILES.put(key, stl);
    await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: key, filename: "p.stl", format: "STL", sizeBytes: stl.byteLength });
    const tooDetailed = writeProxyGlb(buildProxy(originalMesh(), { targetTriangles: 6000 }).mesh); // > 50 % of 3 072
    expect(await uploadPreviewCandidate(p.db, p.env, product.id, tooDetailed, actor)).toMatchObject({ ok: false, error: "not_reduced" });
  });
});

describe("3. public preview route serves only approved proxies", () => {
  it("serves an approved proxy of a published product with deliberate cache headers", async () => {
    const { row } = await approvedPreview();
    const res = await preview(row.id);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    expect(res.headers.get("cache-control")).toBe("private, no-cache");
    expect(res.headers.get("etag")).toBe(`"${row.sha256}"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(inspectProxyGlb(new Uint8Array(await res.arrayBuffer())).ok).toBe(true);
    expect((await preview(row.id, { "if-none-match": `"${row.sha256}"` })).status).toBe(304);
  });

  it("pending, rejected and withdrawn previews, and previews of unpublished products, are 404", async () => {
    const ctx = await digitalProductWithStl();
    const made = await generatePreviewFromFile(p.db, p.env, ctx.product.id, ctx.file.id, actor);
    if (!made.ok) throw new Error(made.error);
    expect((await preview(made.id)).status).toBe(404); // pending review
    await rejectPreview(p.db, made.id, "too detailed", actor);
    expect((await preview(made.id)).status).toBe(404); // rejected

    const live = await approvedPreview();
    expect((await preview(live.row.id)).status).toBe(200);
    await rejectPreview(p.db, live.row.id, "", actor); // withdrawn: stops at once
    const gone = await preview(live.row.id);
    expect(gone.status).toBe(404);
    expect(gone.headers.get("cache-control")).toBe("no-store");

    const draft = await approvedPreview("DRAFT");
    expect((await preview(draft.row.id)).status).toBe(404);
    await p.db.update(products).set({ status: "ARCHIVED" }).where(eq(products.id, draft.product.id));
    expect((await preview(draft.row.id)).status).toBe(404);
  });

  it("ID manipulation and traversal never reach a stored object", async () => {
    const { row, file, product } = await approvedPreview();
    for (const id of [file.id, product.id, row.r2Key, encodeURIComponent(row.r2Key), file.r2Key, "../../digital/x.stl", "..%2F..%2Fdigital", `${row.id}/../x`, `${row.id}.glb`, row.id.toUpperCase(), "", "1 OR 1=1"]) {
      expect((await preview(id)).status, id).toBe(404);
    }
  });

  it("a stored object swapped for the original after approval is not served", async () => {
    const { row, stl } = await approvedPreview();
    await p.env.MEDIA.put(row.r2Key, stl); // someone overwrites the key with the paid file
    expect((await preview(row.id)).status).toBe(404);
    const raw = toGlb(originalMesh(), [0.5, 0.4, 0.9], "paid");
    await p.env.MEDIA.put(row.r2Key, raw); // or with a full-detail GLB
    expect((await preview(row.id)).status).toBe(404);
  });

  it("only one approved preview per product; approving a new one retires the old one", async () => {
    const first = await approvedPreview();
    const again = await generatePreviewFromFile(p.db, p.env, first.product.id, first.file.id, actor, { targetTriangles: 2500 });
    if (!again.ok) throw new Error(again.error);
    expect(await approvePreview(p.db, p.env, again.id, actor)).toEqual({ ok: true });
    const rows = await p.db.select().from(previewModels).where(eq(previewModels.productId, first.product.id));
    expect(rows.filter((r) => r.status === "APPROVED").map((r) => r.id)).toEqual([again.id]);
    expect(rows.find((r) => r.id === first.row.id)).toMatchObject({ status: "REJECTED", rejectReason: "replaced" });
    expect((await preview(first.row.id)).status).toBe(404);
  });
});

describe("4. public media never serves model geometry", () => {
  it("the /media allowlist accepts raster images only (no proxies, legacy GLBs or paid files)", () => {
    expect(PUBLIC_MEDIA_KEY.test(`products/2026/10/${uuid()}.png`)).toBe(true);
    for (const bad of [
      `preview-proxies/2026/10/${uuid()}.glb`,
      `previews/2026/10/${uuid()}.glb`,
      `products/2026/10/${uuid()}.glb`,
      `products/2026/10/${uuid()}.stl`,
      `products/2026/10/${uuid()}.obj`,
      `products/2026/10/${uuid()}.3mf`,
      `products/2026/10/${uuid()}.zip`,
      `digital/2026/10/${uuid()}.stl`,
      `uploads/2026/10/${uuid()}.stl`,
      `turntables/2026/10/${uuid()}.webp`,
      `products/../digital/2026/10/${uuid()}.webp`,
      `products/2026/10/${uuid()}.webp?x=.glb`,
    ]) expect(PUBLIC_MEDIA_KEY.test(bad), bad).toBe(false);
  });

  it("an approved proxy is not reachable through /media by its key", async () => {
    const { row } = await approvedPreview();
    expect((await media(row.r2Key)).status).toBe(404);
  });

  it("private bucket keys (paid files, customer uploads) are unreachable through /media", async () => {
    const paid = `digital/2026/10/${uuid()}.stl`;
    await p.env.PRIVATE_FILES.put(paid, new TextEncoder().encode("solid paid"));
    expect((await media(paid)).status).toBe(404);
    const lookalike = `products/2026/10/${uuid()}.webp`;
    await p.env.PRIVATE_FILES.put(lookalike, new TextEncoder().encode("solid paid"));
    expect((await media(lookalike)).status).toBe(404);
  });

  it("preview uploads are GLB-only and capped; the route validates the bytes, not the name", () => {
    expect(UPLOAD_RULES.PREVIEW_MODEL).toEqual({ extensions: ["glb"], maxBytes: 3 * 1024 * 1024 });
    const route = readFileSync("src/app/api/admin/uploads/route.ts", "utf8");
    expect(route).toContain("uploadPreviewCandidate(db, env, productId, bytes, actor)");
    expect(route).not.toContain("TURNTABLE_FRAME");
  });
});

describe("5. legacy GLBs", () => {
  it("are audited without being served, published, moved or deleted", async () => {
    const legacyKey = `previews/2026/09/${uuid()}.glb`;
    const legacy = toGlb(originalMesh(), [0.5, 0.4, 0.9], "old");
    await p.env.MEDIA.put(legacyKey, legacy, { httpMetadata: { contentType: "model/gltf-binary" } });
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", previewModelKey: legacyKey });
    expect((await media(legacyKey)).status).toBe(404);

    const result = await auditLegacyPreview(p.db, p.env, product.id, actor);
    expect(result.state).toBe("inspected");
    if (result.state === "inspected") expect(result.inspection.ok).toBe(false);
    expect(await p.db.$count(previewModels, eq(previewModels.productId, product.id))).toBe(0); // nothing published
    expect(await p.env.MEDIA.head(legacyKey)).not.toBeNull(); // not deleted
    const [after] = await p.db.select({ key: products.previewModelKey }).from(products).where(eq(products.id, product.id));
    expect(after.key).toBe(legacyKey); // not changed
    expect(await p.db.$count(auditLogs, eq(auditLogs.action, "preview.legacy_audited"))).toBeGreaterThan(0);
    const [card] = await getProductCardsByIds(p.db, [product.id]);
    expect(card.hasPreview).toBe(false);
  });
});

describe("6. storefront data and permissions", () => {
  it("product data exposes only /api/previews/<id>, never a storage key", async () => {
    const { product, row } = await approvedPreview();
    const data = await getProductBySlug(p.db, product.slug);
    expect(data?.preview).toEqual({ src: `/api/previews/${row.id}` });
    const [card] = await getProductCardsByIds(p.db, [product.id]);
    expect(card.hasPreview).toBe(true);
    expect(JSON.stringify(card)).not.toMatch(/preview-proxies\/|previews\/|\.glb|\.stl|digital\//);
  });

  it("approval needs previews.approve: Owners and Super Admins only", () => {
    expect(hasPermission("OWNER", "previews.approve")).toBe(true);
    expect(hasPermission("SUPER_ADMIN", "previews.approve")).toBe(true);
    expect(hasPermission("OPERATIONS", "previews.approve")).toBe(false);
    const actions = readFileSync("src/server/actions/admin/products.ts", "utf8");
    expect(actions).toMatch(/withAdmin\("previews\.approve", async \(\{ db, actor \}\) => approvePreview\(/);
    expect(actions).toMatch(/withAdmin\("previews\.approve", \(\{ db, actor \}\) => rejectPreview\(/);
    const review = readFileSync("src/app/api/admin/previews/[id]/route.ts", "utf8");
    expect(review).toContain('requireAdminAction("products.view")');
  });

  it("migration 0004 is additive (no DROP, DELETE or UPDATE of existing data)", () => {
    const sql = readFileSync("drizzle/migrations/0004_preview_proxies.sql", "utf8").replace(/--[^\n]*\n/g, "\n");
    expect(sql).not.toMatch(/\bDROP\b|\bDELETE\s+FROM\b|^\s*UPDATE\b|RENAME/im);
  });
});

describe("7. paid downloads require the purchase", () => {
  it("anonymous ids, strangers, unpaid buyers and manipulated ids are refused; paying buyers get only their file", async () => {
    const product = await makeProduct(p.db, { productType: "DIGITAL", availability: "DIGITAL", basePrice: 5_000 });
    const [file] = await p.db.insert(digitalFiles).values({ productId: product.id, r2Key: `digital/2026/10/${uuid()}.stl`, filename: "m.stl", format: "STL", sizeBytes: 84 }).returning();
    const buyer = await makeUser(p.db);
    const stranger = await makeUser(p.db);
    await addToCart(p.db, { userId: buyer.id }, { productId: product.id, quantity: 1, options: {} });
    const r = await placeOrder(p.db, { idempotencyKey: uuid(), fullName: "Buyer", phone: "07501234567", locale: "en" }, { owner: { userId: buyer.id }, userId: buyer.id, appSecret: SECRET });
    if (!r.ok) throw new Error(r.error);
    const [item] = await p.db.select().from(orderItems).where(eq(orderItems.orderId, r.orderId));

    expect(await authorizeDownload(p.db, buyer.id, item.id, file.id)).toEqual({ ok: false, error: "unpaid" });
    await confirmDue(p.db, r.orderId);
    expect(await authorizeDownload(p.db, stranger.id, item.id, file.id)).toEqual({ ok: false, error: "not_found" });
    expect(await authorizeDownload(p.db, buyer.id, uuid(), file.id)).toEqual({ ok: false, error: "not_found" });
    expect(await authorizeDownload(p.db, buyer.id, item.id, uuid())).toEqual({ ok: false, error: "not_found" });
    expect(await authorizeDownload(p.db, buyer.id, "../../etc", file.id)).toMatchObject({ ok: false });
    expect(await authorizeDownload(p.db, buyer.id, item.id, "digital/2026/10/x.stl")).toMatchObject({ ok: false });
    await p.db.update(digitalFiles).set({ isActive: false }).where(eq(digitalFiles.id, file.id));
    expect(await authorizeDownload(p.db, buyer.id, item.id, file.id)).toEqual({ ok: false, error: "not_found" });
    await p.db.update(digitalFiles).set({ isActive: true }).where(eq(digitalFiles.id, file.id));
    const ok = await authorizeDownload(p.db, buyer.id, item.id, file.id);
    expect(ok.ok && ok.file.r2Key).toBe(file.r2Key);
  });

  it("the download route never streams without a session and sends private, non-cacheable attachments", () => {
    const route = readFileSync("src/app/api/downloads/[itemId]/[fileId]/route.ts", "utf8");
    expect(route).toMatch(/const user = await getCurrentUser\(\);\s*if \(!user\) return Response\.redirect/);
    expect(route).toContain("PRIVATE_FILES.get(auth.file.r2Key)");
    const previews = readFileSync("src/app/api/previews/[id]/route.ts", "utf8");
    expect(previews).not.toMatch(/PRIVATE_FILES\./);
    const upload = readFileSync("src/server/storage/upload.ts", "utf8");
    expect(upload).toMatch(/"Cache-Control": "private, no-store"/);
    expect(upload).toMatch(/Content-Disposition": `attachment;/);
  });
});

describe("resin-printing claims", () => {
  it("migration 0003 removes a stored RESIN material and keeps everything else", async () => {
    const value = { materials: [{ code: "PLA", en: "PLA", ar: "PLA" }, { code: "RESIN", en: "Resin", ar: "ريزن" }], colors: [{ code: "BLACK", en: "Black", ar: "أسود" }] };
    await p.db.insert(siteSettings).values({ key: "customPrint", value }).onConflictDoUpdate({ target: siteSettings.key, set: { value } });
    const migration = readFileSync("drizzle/migrations/0003_turntable_previews_no_resin.sql", "utf8");
    await p.env.DB.prepare(migration.slice(migration.indexOf("UPDATE `site_settings`"))).run();
    const [row] = await p.db.select().from(siteSettings).where(eq(siteSettings.key, "customPrint"));
    expect(row.value).toEqual({ materials: [{ code: "PLA", en: "PLA", ar: "PLA" }], colors: [{ code: "BLACK", en: "Black", ar: "أسود" }] });
  });
});
