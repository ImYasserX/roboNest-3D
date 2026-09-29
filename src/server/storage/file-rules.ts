// Upload policy: which file kinds are accepted for which purpose, and
// content sniffing so a renamed executable/HTML/SVG cannot slip through on
// its extension alone. Uploaded files are never executed or parsed beyond the
// few header bytes read here.

export type UploadPurpose =
  | "PRODUCT_IMAGE"
  | "PREVIEW_MODEL"
  | "DIGITAL_FILE"
  | "CUSTOM_PRINT"
  | "PRODUCT_OPTION";

type Rule = { extensions: readonly string[]; maxBytes: number };

const MB = 1024 * 1024;

export const UPLOAD_RULES: Record<UploadPurpose, Rule> = {
  // SVG is deliberately excluded: it can carry script.
  PRODUCT_IMAGE: { extensions: ["jpg", "jpeg", "png", "webp", "avif"], maxBytes: 8 * MB },
  PREVIEW_MODEL: { extensions: ["glb"], maxBytes: 30 * MB },
  // Cloudflare's request body limit is 100 MB on Free/Pro plans.
  DIGITAL_FILE: { extensions: ["stl", "3mf", "obj", "glb", "zip"], maxBytes: 95 * MB },
  CUSTOM_PRINT: { extensions: ["stl", "3mf", "obj", "zip"], maxBytes: 50 * MB },
  PRODUCT_OPTION: { extensions: ["stl", "3mf", "obj", "zip", "png", "jpg", "jpeg", "webp"], maxBytes: 20 * MB },
};

export const CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  glb: "model/gltf-binary",
  stl: "model/stl",
  "3mf": "model/3mf",
  obj: "model/obj",
  zip: "application/zip",
};

/** Bytes of the file start needed by sniffFile. */
export const SNIFF_BYTES = 4096;

export function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Display-safe filename: basename only, no path separators, control or
 * bidi-override characters, bounded length. Never used as a storage path.
 */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const ext = extensionOf(base);
  const stem = (ext ? base.slice(0, -(ext.length + 1)) : base)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[.\s]+/, "")
    .trim()
    .slice(0, 80);
  return `${stem || "file"}${ext ? `.${ext}` : ""}`;
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0) {
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, Math.min(bytes.length, SNIFF_BYTES - 4)));
    return true;
  } catch {
    return false;
  }
}

function looksLikeMarkup(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return head.startsWith("<") || head.includes("<script") || head.includes("<html") || head.includes("<svg");
}

export type SniffResult = { ok: true; contentType: string } | { ok: false; error: "type_mismatch" | "empty" };

/** Checks the leading bytes match the claimed extension. */
export function sniffFile(ext: string, head: Uint8Array, totalSize: number): SniffResult {
  if (totalSize <= 0 || head.length === 0) return { ok: false, error: "empty" };
  const ct = CONTENT_TYPES[ext];
  let ok = false;
  switch (ext) {
    case "jpg":
    case "jpeg":
      ok = startsWith(head, [0xff, 0xd8, 0xff]);
      break;
    case "png":
      ok = startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      break;
    case "webp":
      ok = ascii(head, 0, 4) === "RIFF" && ascii(head, 8, 12) === "WEBP";
      break;
    case "avif":
      ok = ascii(head, 4, 8) === "ftyp" && ["avif", "avis"].includes(ascii(head, 8, 12));
      break;
    case "glb":
      // "glTF" magic, container version 2.
      ok = ascii(head, 0, 4) === "glTF" && head[4] === 2 && head[5] === 0;
      break;
    case "zip":
    case "3mf":
      ok = startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
      break;
    case "stl": {
      const text = new TextDecoder().decode(head.subarray(0, 5)).toLowerCase();
      if (text === "solid" && looksLikeText(head) && !looksLikeMarkup(head)) {
        ok = true;
      } else if (head.length >= 84) {
        const triangles = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(80, true);
        ok = totalSize === 84 + triangles * 50;
      }
      break;
    }
    case "obj":
      ok = looksLikeText(head) && !looksLikeMarkup(head);
      break;
  }
  return ok && ct ? { ok: true, contentType: ct } : { ok: false, error: "type_mismatch" };
}

/** Reads pixel dimensions from PNG/JPEG/WebP/AVIF headers (best effort). */
export function imageDimensions(ext: string, bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    if (ext === "png" && bytes.length >= 24) {
      return { width: view.getUint32(16), height: view.getUint32(20) };
    }
    if ((ext === "jpg" || ext === "jpeg") && bytes.length > 4) {
      let i = 2;
      while (i + 9 < bytes.length) {
        if (bytes[i] !== 0xff) {
          i++;
          continue;
        }
        const marker = bytes[i + 1];
        const len = view.getUint16(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: view.getUint16(i + 5), width: view.getUint16(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (ext === "webp" && bytes.length >= 30) {
      const chunk = ascii(bytes, 12, 16);
      if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
      if (chunk === "VP8L") {
        const b = view.getUint32(21, true);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === "VP8X") {
        const w = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
        const h = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
        return { width: w, height: h };
      }
    }
    if (ext === "avif") {
      for (let i = 0; i + 20 < bytes.length; i++) {
        if (ascii(bytes, i, i + 4) === "ispe") return { width: view.getUint32(i + 8), height: view.getUint32(i + 12) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/** Storage keys are random and never derived from user input. */
export function storageKey(prefix: string, ext: string, now = new Date()): string {
  const month = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${prefix}/${month}/${crypto.randomUUID()}.${ext}`;
}

/** Only keys this app generated can be served from the public media route. */
export const PUBLIC_MEDIA_KEY = /^(products|previews|categories)\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|avif|glb)$/;
