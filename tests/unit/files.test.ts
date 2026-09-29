import { describe, expect, it } from "vitest";
import { extensionOf, imageDimensions, PUBLIC_MEDIA_KEY, sanitizeFilename, sniffFile, storageKey } from "@/server/storage/file-rules";

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);

describe("upload content sniffing", () => {
  it("accepts genuine file signatures", () => {
    expect(sniffFile("png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0), 100).ok).toBe(true);
    expect(sniffFile("jpg", bytes(0xff, 0xd8, 0xff, 0xe0), 100).ok).toBe(true);
    expect(sniffFile("glb", bytes(...text("glTF"), 2, 0, 0, 0), 100).ok).toBe(true);
    expect(sniffFile("3mf", bytes(0x50, 0x4b, 0x03, 0x04), 100).ok).toBe(true);
    expect(sniffFile("stl", text("solid part\nfacet normal 0 0 1\n"), 100).ok).toBe(true);
    const binStl = new Uint8Array(84);
    new DataView(binStl.buffer).setUint32(80, 2, true);
    expect(sniffFile("stl", binStl, 84 + 2 * 50).ok).toBe(true);
    expect(sniffFile("obj", text("# model\nv 0 0 0\nf 1 2 3\n"), 100).ok).toBe(true);
  });

  it("rejects renamed executables, HTML/SVG disguised as models, and size mismatches", () => {
    expect(sniffFile("png", bytes(0x4d, 0x5a, 0x90, 0x00), 100)).toEqual({ ok: false, error: "type_mismatch" }); // PE executable
    expect(sniffFile("obj", text("<html><script>alert(1)</script>"), 100).ok).toBe(false);
    expect(sniffFile("stl", text("<svg onload=alert(1)>"), 100).ok).toBe(false);
    expect(sniffFile("obj", bytes(0x7f, 0x45, 0x4c, 0x46, 0, 0), 100).ok).toBe(false); // ELF with NULs
    const binStl = new Uint8Array(84);
    new DataView(binStl.buffer).setUint32(80, 2, true);
    expect(sniffFile("stl", binStl, 5000).ok).toBe(false);
    expect(sniffFile("svg", text("<svg/>"), 10).ok).toBe(false);
    expect(sniffFile("png", new Uint8Array(0), 0)).toEqual({ ok: false, error: "empty" });
  });

  it("sanitizes filenames and never uses them as storage paths", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("C:\\Users\\x\\evil.stl")).toBe("evil.stl");
    expect(sanitizeFilename("photo\u202Egnp.stl")).toBe("photognp.stl");
    expect(sanitizeFilename("<script>.obj")).toBe("_script_.obj");
    expect(sanitizeFilename("قطعة غيار.STL")).toBe("قطعة غيار.stl");
    expect(extensionOf("model.tar.gz.exe")).toBe("exe");
    const key = storageKey("products", "webp", new Date("2026-03-05T00:00:00Z"));
    expect(key).toMatch(/^products\/2026\/03\/[0-9a-f-]{36}\.webp$/);
    expect(PUBLIC_MEDIA_KEY.test(key)).toBe(true);
    for (const bad of ["digital/2026/01/x.stl", "uploads/2026/01/a.stl", "products/../../secret", "products/2026/01/x.svg"]) {
      expect(PUBLIC_MEDIA_KEY.test(bad)).toBe(false);
    }
  });

  it("reads PNG dimensions for layout-stable images", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 1200);
    new DataView(png.buffer).setUint32(20, 800);
    expect(imageDimensions("png", png)).toEqual({ width: 1200, height: 800 });
  });
});
