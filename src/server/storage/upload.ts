import "server-only";
import type { R2Bucket } from "@cloudflare/workers-types";
import {
  CONTENT_TYPES,
  SNIFF_BYTES,
  UPLOAD_RULES,
  extensionOf,
  imageDimensions,
  sanitizeFilename,
  sniffFile,
  storageKey,
  type UploadPurpose,
} from "./file-rules";

export type UploadError = "missing_length" | "too_large" | "bad_extension" | "type_mismatch" | "empty" | "failed";

export type StoredUpload = {
  key: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  contentType: string;
  width: number | null;
  height: number | null;
};

declare const FixedLengthStream:
  | (new (length: number) => { readable: ReadableStream; writable: WritableStream })
  | undefined;

/**
 * Streams a raw request body (the file itself, not multipart) into R2 after
 * validating size, extension and magic bytes. Streaming keeps memory flat for
 * large model files inside a 128 MB Worker isolate.
 */
export async function storeUploadFromRequest(
  request: Request,
  bucket: R2Bucket,
  purpose: UploadPurpose,
  rawFilename: string,
  keyPrefix: string,
): Promise<{ ok: true; file: StoredUpload } | { ok: false; error: UploadError }> {
  const rule = UPLOAD_RULES[purpose];
  const filename = sanitizeFilename(rawFilename);
  const ext = extensionOf(filename);
  if (!rule.extensions.includes(ext)) return { ok: false, error: "bad_extension" };

  const length = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(length) || length <= 0) return { ok: false, error: "missing_length" };
  if (length > rule.maxBytes) return { ok: false, error: "too_large" };
  if (!request.body) return { ok: false, error: "empty" };

  // Read just enough of the stream to sniff the file type.
  const reader = request.body.getReader();
  const headChunks: Uint8Array[] = [];
  let headLength = 0;
  while (headLength < SNIFF_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    headChunks.push(value);
    headLength += value.byteLength;
  }
  const head = concat(headChunks, headLength);
  if (head.byteLength > length) return { ok: false, error: "failed" };

  const sniff = sniffFile(ext, head, length);
  if (!sniff.ok) {
    await reader.cancel().catch(() => {});
    return { ok: false, error: sniff.error };
  }

  let received = head.byteLength;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      if (received > length) {
        controller.error(new Error("Body exceeds declared length"));
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      return reader.cancel();
    },
  });

  const key = storageKey(keyPrefix, ext);
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const httpMetadata = { contentType };
  const customMetadata = { filename: encodeURIComponent(filename) };

  try {
    if (typeof FixedLengthStream !== "undefined") {
      // Workers runtime: R2 needs a stream of known length; FixedLengthStream
      // also errors if the client sends more or fewer bytes than declared.
      const fixed = new FixedLengthStream(length);
      const piping = body.pipeTo(fixed.writable);
      await bucket.put(key, fixed.readable as never, { httpMetadata, customMetadata });
      await piping;
    } else {
      // Node (local dev / tests): buffer, then check the length ourselves.
      const buffer = await new Response(body).arrayBuffer();
      if (buffer.byteLength !== length) return { ok: false, error: "failed" };
      await bucket.put(key, buffer, { httpMetadata, customMetadata });
    }
  } catch {
    await bucket.delete(key).catch(() => {});
    return { ok: false, error: "failed" };
  }

  const dims = purpose === "PRODUCT_IMAGE" ? imageDimensions(ext, head) : null;
  return {
    ok: true,
    file: {
      key,
      filename,
      extension: ext,
      sizeBytes: length,
      contentType,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
    },
  };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Response headers for downloading a private file: never rendered inline. */
export function attachmentHeaders(filename: string, size: number): Headers {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Length": String(size),
    "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}
