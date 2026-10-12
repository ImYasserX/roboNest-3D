// Builds a preview PROXY from a model on your computer, for upload in
// admin → Products → 3D preview → "Upload a proxy GLB". Use it for originals
// too large to process on the server (over 25 MB) or formats it cannot read.
//
//   npm run preview:proxy -- model.stl [out.glb] [--triangles 6000]
//
// Reads STL, OBJ or GLB. The result is reduced (at most half the original's
// triangles, coarse grid), scaled to unit size, without textures or metadata.
// The original file is only read. The output is checked with the same
// validator the server uses; the server checks it again on upload.
import { readFileSync, writeFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { buildProxy, inspectProxyGlb, parseModel, writeProxyGlb } from "../src/server/preview/proxy";

const args = process.argv.slice(2);
const flag = args.indexOf("--triangles");
const triangles = flag >= 0 ? Number(args.splice(flag, 2)[1]) : undefined;
const [input, output = `${basename(input ?? "model", extname(input ?? ""))}.preview.glb`] = args;
if (!input) {
  console.error("Usage: npm run preview:proxy -- model.stl [out.glb] [--triangles 6000]");
  process.exit(1);
}
if (output === input) {
  console.error("Refusing to overwrite the input file.");
  process.exit(1);
}
const mesh = parseModel(new Uint8Array(readFileSync(input)), extname(input).slice(1));
const { mesh: proxy, stats } = buildProxy(mesh, { targetTriangles: triangles });
const glb = writeProxyGlb(proxy);
const check = inspectProxyGlb(glb);
if (!check.ok) {
  console.error(`The proxy failed validation: ${check.reasons.join(", ")}`);
  process.exit(1);
}
writeFileSync(output, glb, { flag: "wx" });
console.log(`${stats.sourceTriangles} → ${stats.triangles} triangles (grid ${stats.grid}), ${(glb.byteLength / 1024).toFixed(0)} KB → ${output}`);
console.log("Review it in admin before approving: a visitor can download this preview.");
