// Regenerates favicon/app icons from the existing brand mark
// (public/brand/robonest-mark-256.png). Run: node scripts/generate-icons.mjs
// The source is 256 px; the 512 px icon is an upscale. Replace the source with
// a larger original (or SVG) when available and re-run.
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const SRC = "public/brand/robonest-mark-256.png";
const png = (size) => sharp(SRC).resize(size, size, { kernel: "lanczos3" }).png({ compressionLevel: 9 }).toBuffer();

// ICO container holding PNG images (supported by every current browser).
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.data)]);
}

const sizes = [16, 32, 48];
writeFileSync("src/app/favicon.ico", ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size) })))));
writeFileSync("src/app/icon.png", await png(192));
writeFileSync("src/app/apple-icon.png", await sharp(SRC).resize(180, 180).flatten({ background: "#0c0a14" }).png().toBuffer());
writeFileSync("public/brand/icon-192.png", await png(192));
writeFileSync("public/brand/icon-512.png", await png(512));
// Maskable: the mark inside the 80% safe zone on the brand background.
const inner = await sharp(SRC).resize(400, 400).png().toBuffer();
writeFileSync(
  "public/brand/icon-maskable-512.png",
  await sharp({ create: { width: 512, height: 512, channels: 4, background: "#0c0a14" } }).composite([{ input: inner, gravity: "center" }]).png().toBuffer(),
);
console.log("icons written");
