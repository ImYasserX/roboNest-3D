import { bounds, faceNormal, flatten, type Mesh } from "./mesh";

/** Binary glTF 2.0 with one mesh and one PBR material (double-sided). */
export function toGlb(mesh: Mesh, color: [number, number, number], name: string): Uint8Array {
  // glTF is in metres; our meshes are millimetres.
  const flat = flatten({ positions: mesh.positions.map(([x, y, z]) => [x / 1000, y / 1000, z / 1000]), indices: mesh.indices });
  const { min, max } = bounds({ positions: mesh.positions.map(([x, y, z]) => [x / 1000, y / 1000, z / 1000]), indices: [] });
  const posBytes = flat.positions.byteLength;
  const bin = new Uint8Array(posBytes + flat.normals.byteLength);
  bin.set(new Uint8Array(flat.positions.buffer), 0);
  bin.set(new Uint8Array(flat.normals.buffer), posBytes);
  const count = flat.positions.length / 3;
  const json = {
    asset: { version: "2.0", generator: "RoboNest.3D seed" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, material: 0 }] }],
    materials: [{ name: "print", doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.55 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: posBytes, byteLength: flat.normals.byteLength, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5126, count, type: "VEC3" },
    ],
  };
  const pad = (n: number) => (4 - (n % 4)) % 4;
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  jsonBytes = concat([jsonBytes, new Uint8Array(pad(jsonBytes.length)).fill(0x20)]);
  const binPadded = concat([bin, new Uint8Array(pad(bin.length))]);
  const total = 12 + 8 + jsonBytes.length + 8 + binPadded.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  view.setUint32(binStart, binPadded.length, true);
  view.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  out.set(binPadded, binStart + 8);
  return out;
}

/** Binary STL (millimetres, Z-up as slicers expect). */
export function toStl(mesh: Mesh, header = "RoboNest.3D sample model"): Uint8Array {
  const triangles = mesh.indices.length / 3;
  const out = new Uint8Array(84 + triangles * 50);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(header.slice(0, 80)), 0);
  view.setUint32(80, triangles, true);
  const zUp = (p: [number, number, number]): [number, number, number] => [p[0], -p[2], p[1]];
  for (let t = 0; t < triangles; t++) {
    const a = zUp(mesh.positions[mesh.indices[t * 3]]);
    const b = zUp(mesh.positions[mesh.indices[t * 3 + 1]]);
    const c = zUp(mesh.positions[mesh.indices[t * 3 + 2]]);
    const n = faceNormal(a, b, c);
    const o = 84 + t * 50;
    [...n, ...a, ...b, ...c].forEach((v, i) => view.setFloat32(o + i * 4, v, true));
    view.setUint16(o + 48, 0, true);
  }
  return out;
}

function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
