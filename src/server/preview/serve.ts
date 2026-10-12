import "server-only";
import type { R2Bucket } from "@cloudflare/workers-types";
import { inspectProxyGlb, sha256Hex } from "./proxy";

/**
 * Streams a stored preview proxy after re-checking the bytes: they must hash
 * to the value recorded at review time and still pass the proxy validator,
 * so a swapped or overwritten R2 object (for example an original copied over
 * the key) is refused instead of served.
 *
 * Caching is deliberate: browsers may keep a copy but must revalidate every
 * time (`no-cache` + ETag = the proxy's hash), so a withdrawn preview stops
 * being served at once, and shared caches/CDNs may not store it (`private`).
 */
export async function servePreviewObject(request: Request, bucket: R2Bucket, row: { r2Key: string; sha256: string }) {
  const etag = `"${row.sha256}"`;
  const base = {
    "Cache-Control": "private, no-cache",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Robots-Tag": "noindex",
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: base });
  const object = await bucket.get(row.r2Key);
  if (!object) return new Response("Not found", { status: 404 });
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256Hex(bytes)) !== row.sha256 || !inspectProxyGlb(bytes).ok) return new Response("Not found", { status: 404 });
  return new Response(bytes, {
    headers: { ...base, "Content-Type": "model/gltf-binary", "Content-Length": String(bytes.byteLength), "Content-Disposition": 'inline; filename="preview.glb"' },
  });
}
