// Preview proxies: deliberately reduced 3D meshes for the public product viewer.
//
// Pure TypeScript (no Node or Worker APIs), so the same code runs in the
// Worker (admin "generate from file", validation at upload/approval) and in
// local scripts. Nothing here can read or publish an original file; callers
// pass bytes in and decide where results go.
//
// What a proxy is, by construction:
//   1. vertex clustering on a coarse grid (at most PROXY_GRID_MAX cells per
//      axis): fine detail, text, threads and small holes collapse, and every
//      coordinate snaps to a grid value;
//      the result keeps at most half of the original's triangles;
//   2. small disconnected parts (< 1 % of the triangles) are dropped;
//   3. the mesh is centred and scaled so its largest side is exactly 1, so the
//      real dimensions (mm) are not delivered;
//   4. no normals, textures, metadata or source names are written.
// A proxy still shows the overall shape and CAN be extracted by a visitor.
// It is a preview, not protection of the shape itself.

export type Vec3 = [number, number, number];
export type Mesh = { positions: Vec3[]; indices: number[] };

export const PROXY_TRIANGLE_LIMIT = 20_000;
export const PROXY_DEFAULT_TARGET = 6_000;
export const PROXY_GRID_MAX = 96;
export const PROXY_GRID_MIN = 6;
/** A proxy keeps at most this share of the original's triangles. */
export const PROXY_MAX_SOURCE_RATIO = 0.5;
export const PROXY_MAX_BYTES = 3 * 1024 * 1024;
/** Above this many distinct values on any axis, a mesh is not a grid-quantized proxy. */
export const PROXY_MAX_DISTINCT_PER_AXIS = PROXY_GRID_MAX + 1;

// ---------------------------------------------------------------------------
// Parsing source models (STL, OBJ, GLB)
// ---------------------------------------------------------------------------

export class ModelParseError extends Error {}

export function parseStl(bytes: Uint8Array): Mesh {
  const text = latin1(bytes.subarray(0, Math.min(bytes.length, 4096)));
  const ascii = /^\s*solid\b/.test(text) && /facet\s+normal/.test(text);
  const positions: Vec3[] = [];
  const indices: number[] = [];
  if (ascii) {
    const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
    const all = latin1(bytes);
    for (let m; (m = re.exec(all)); ) {
      indices.push(positions.length);
      positions.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    }
  } else {
    if (bytes.length < 84) throw new ModelParseError("not_stl");
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = view.getUint32(80, true);
    if (count === 0 || 84 + count * 50 > bytes.length) throw new ModelParseError("not_stl");
    for (let t = 0; t < count; t++) {
      const o = 84 + t * 50 + 12;
      for (let v = 0; v < 3; v++) {
        indices.push(positions.length);
        positions.push([view.getFloat32(o + v * 12, true), view.getFloat32(o + v * 12 + 4, true), view.getFloat32(o + v * 12 + 8, true)]);
      }
    }
  }
  return finite({ positions, indices });
}

export function parseObj(bytes: Uint8Array): Mesh {
  const positions: Vec3[] = [];
  const indices: number[] = [];
  for (const line of latin1(bytes).split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "v" && parts.length >= 4) positions.push([Number(parts[1]), Number(parts[2]), Number(parts[3])]);
    else if (parts[0] === "f" && parts.length >= 4) {
      const ids = parts.slice(1).map((p) => {
        const i = parseInt(p.split("/")[0], 10);
        return i < 0 ? positions.length + i : i - 1;
      });
      for (let k = 1; k + 1 < ids.length; k++) indices.push(ids[0], ids[k], ids[k + 1]);
    }
  }
  if (indices.some((i) => i < 0 || i >= positions.length)) throw new ModelParseError("not_obj");
  return finite({ positions, indices });
}

export type GlbInfo = {
  json: Record<string, unknown>;
  mesh: Mesh;
  /** Structural problems that disqualify a GLB as a public preview. */
  structural: string[];
  byteLength: number;
};

/** Parses a binary glTF 2.0 file into one triangle mesh (all primitives merged). */
export function parseGlb(bytes: Uint8Array): GlbInfo {
  if (bytes.length < 20) throw new ModelParseError("not_glb");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) throw new ModelParseError("not_glb");
  if (view.getUint32(8, true) !== bytes.length) throw new ModelParseError("not_glb");
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLength > bytes.length) throw new ModelParseError("not_glb");
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  } catch {
    throw new ModelParseError("not_glb");
  }
  let bin: Uint8Array | null = null;
  const binStart = 20 + jsonLength;
  if (binStart + 8 <= bytes.length) {
    const binLength = view.getUint32(binStart, true);
    if (view.getUint32(binStart + 4, true) !== 0x004e4942 || binStart + 8 + binLength > bytes.length) throw new ModelParseError("not_glb");
    bin = bytes.subarray(binStart + 8, binStart + 8 + binLength);
  }

  const structural: string[] = [];
  const arr = (k: string) => (Array.isArray(json[k]) ? (json[k] as Record<string, unknown>[]) : []);
  for (const k of ["images", "textures", "samplers", "animations", "skins", "cameras"]) if (arr(k).length) structural.push(`has_${k}`);
  if (arr("extensionsUsed").length || arr("extensionsRequired").length) structural.push("has_extensions");
  const buffers = arr("buffers");
  if (buffers.length !== 1 || buffers[0].uri !== undefined) structural.push("external_or_multiple_buffers");
  const meshes = arr("meshes");
  if (meshes.length !== 1) structural.push("not_single_mesh");

  const accessors = arr("accessors");
  const views = arr("bufferViews");
  const read = (index: number, comps: number): number[] => {
    const a = accessors[index];
    if (!a || !bin) throw new ModelParseError("bad_accessor");
    const bv = views[a.bufferView as number];
    if (!bv) throw new ModelParseError("bad_accessor");
    const count = Number(a.count);
    const type = Number(a.componentType);
    const size = type === 5126 || type === 5125 ? 4 : type === 5123 ? 2 : type === 5121 ? 1 : 0;
    if (!size || !Number.isInteger(count) || count < 0) throw new ModelParseError("bad_accessor");
    const stride = Number(bv.byteStride ?? size * comps);
    const start = Number(bv.byteOffset ?? 0) + Number(a.byteOffset ?? 0);
    if (start + (count - 1) * stride + size * comps > bin.length && count > 0) throw new ModelParseError("bad_accessor");
    const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
    const out: number[] = [];
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < comps; c++) {
        const o = start + i * stride + c * size;
        out.push(type === 5126 ? dv.getFloat32(o, true) : type === 5125 ? dv.getUint32(o, true) : type === 5123 ? dv.getUint16(o, true) : dv.getUint8(o));
      }
    }
    return out;
  };

  const positions: Vec3[] = [];
  const indices: number[] = [];
  for (const m of meshes) {
    for (const prim of (Array.isArray(m.primitives) ? m.primitives : []) as Record<string, unknown>[]) {
      if (prim.mode !== undefined && prim.mode !== 4) structural.push("not_triangles");
      const attrs = (prim.attributes ?? {}) as Record<string, number>;
      if (Object.keys(attrs).some((k) => k !== "POSITION" && k !== "NORMAL")) structural.push("extra_attributes");
      if (attrs.POSITION === undefined) throw new ModelParseError("no_positions");
      if (accessors[attrs.POSITION]?.componentType !== 5126) structural.push("non_float_positions");
      const pos = read(attrs.POSITION, 3);
      const base = positions.length;
      for (let i = 0; i < pos.length; i += 3) positions.push([pos[i], pos[i + 1], pos[i + 2]]);
      const idx = prim.indices !== undefined ? read(prim.indices as number, 1) : Array.from({ length: pos.length / 3 }, (_, i) => i);
      for (const i of idx) indices.push(base + i);
    }
  }
  return { json, mesh: finite({ positions, indices }), structural: [...new Set(structural)], byteLength: bytes.length };
}

// ---------------------------------------------------------------------------
// Building a proxy
// ---------------------------------------------------------------------------

export type ProxyStats = { triangles: number; vertices: number; grid: number; sourceTriangles: number };

export function buildProxy(source: Mesh, opts: { targetTriangles?: number } = {}): { mesh: Mesh; stats: ProxyStats } {
  const sourceTriangles = Math.floor(source.indices.length / 3);
  if (sourceTriangles === 0) throw new ModelParseError("empty_mesh");
  // Never more than half of the original's triangles, whatever was asked.
  const target = Math.min(opts.targetTriangles ?? PROXY_DEFAULT_TARGET, PROXY_TRIANGLE_LIMIT, Math.floor(sourceTriangles * PROXY_MAX_SOURCE_RATIO));
  if (target < 4) throw new ModelParseError("too_simple_to_reduce");
  for (let grid = PROXY_GRID_MAX; grid >= PROXY_GRID_MIN; grid = Math.min(grid - 1, Math.floor(grid * 0.85))) {
    const mesh = cluster(source, grid);
    const triangles = mesh.indices.length / 3;
    if (triangles > 0 && triangles <= target) return { mesh, stats: { triangles, vertices: mesh.positions.length, grid, sourceTriangles } };
  }
  throw new ModelParseError("too_simple_to_reduce");
}

function cluster(source: Mesh, grid: number): Mesh {
  const [min, max] = boundsOf(source.positions);
  const size = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  const cell = size / grid;
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const ids = new Map<string, number>();
  const cells: [number, number, number][] = [];
  const remap = source.positions.map((p) => {
    const c = [0, 1, 2].map((a) => Math.min(grid - 1, Math.max(0, Math.floor((p[a] - min[a]) / cell)))) as [number, number, number];
    const key = `${c[0]},${c[1]},${c[2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = cells.length;
      ids.set(key, id);
      cells.push(c);
    }
    return id;
  });

  const seen = new Set<string>();
  let tris: number[] = [];
  for (let t = 0; t + 2 < source.indices.length; t += 3) {
    const a = remap[source.indices[t]], b = remap[source.indices[t + 1]], c = remap[source.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((x, y) => x - y).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    tris.push(a, b, c);
  }
  tris = dropSmallParts(tris, cells.length);

  // Compact, centre and scale to unit size; positions sit on the grid.
  const used = new Map<number, number>();
  const positions: Vec3[] = [];
  const indices = tris.map((id) => {
    let n = used.get(id);
    if (n === undefined) {
      n = positions.length;
      used.set(id, n);
      const c = cells[id];
      positions.push([0, 1, 2].map((a) => round6((min[a] + (c[a] + 0.5) * cell - center[a]) / size)) as Vec3);
    }
    return n;
  });
  return { positions, indices };
}

function dropSmallParts(tris: number[], vertexCount: number): number[] {
  const parent = Array.from({ length: vertexCount }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (let t = 0; t < tris.length; t += 3) {
    const a = find(tris[t]);
    parent[find(tris[t + 1])] = a;
    parent[find(tris[t + 2])] = a;
  }
  const sizes = new Map<number, number>();
  for (let t = 0; t < tris.length; t += 3) sizes.set(find(tris[t]), (sizes.get(find(tris[t])) ?? 0) + 1);
  const largest = Math.max(...sizes.values());
  const keepFrom = Math.max(1, Math.ceil((tris.length / 3) * 0.01));
  const out: number[] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const n = sizes.get(find(tris[t])) ?? 0;
    if (n >= keepFrom || n === largest) out.push(tris[t], tris[t + 1], tris[t + 2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Writing and validating a proxy GLB
// ---------------------------------------------------------------------------

/** Minimal GLB: one mesh, POSITION + indices, one flat colour. No names, normals or metadata. */
export function writeProxyGlb(mesh: Mesh, color: [number, number, number] = [0.5, 0.34, 0.85]): Uint8Array {
  const pos = new Float32Array(mesh.positions.flat());
  const wide = mesh.positions.length > 65_535;
  const idx = wide ? new Uint32Array(mesh.indices) : new Uint16Array(mesh.indices);
  const posBytes = pos.byteLength;
  const idxOffset = posBytes;
  const bin = new Uint8Array(pad4(posBytes + idx.byteLength));
  bin.set(new Uint8Array(pos.buffer), 0);
  bin.set(new Uint8Array(idx.buffer), idxOffset);
  const [min, max] = boundsOf(mesh.positions);
  const json = {
    asset: { version: "2.0", generator: "RoboNest.3D preview proxy" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
    materials: [{ doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor: 0, roughnessFactor: 0.6 } }],
    buffers: [{ byteLength: bin.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: posBytes, target: 34962 },
      { buffer: 0, byteOffset: idxOffset, byteLength: idx.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: mesh.positions.length, type: "VEC3", min, max },
      { bufferView: 1, componentType: wide ? 5125 : 5123, count: mesh.indices.length, type: "SCALAR" },
    ],
  };
  let jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(pad4(jsonBytes.length)).fill(0x20);
  padded.set(jsonBytes);
  jsonBytes = padded;
  const total = 12 + 8 + jsonBytes.length + 8 + bin.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonBytes.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  v.setUint32(20 + jsonBytes.length, bin.length, true);
  v.setUint32(24 + jsonBytes.length, 0x004e4942, true);
  out.set(bin, 28 + jsonBytes.length);
  return out;
}

export type ProxyInspection = {
  ok: boolean;
  /** Why the file is NOT acceptable as a public preview (empty when ok). */
  reasons: string[];
  triangles: number;
  vertices: number;
  maxDistinctPerAxis: number;
  extent: number;
  byteLength: number;
};

/**
 * Decides from the actual bytes whether a GLB qualifies as a public preview
 * proxy. Extension and MIME type are irrelevant: the file must parse as GLB,
 * be a single plain mesh, stay under the triangle and size limits, be scaled
 * to unit size, and have grid-quantized coordinates (a raw CAD export or an
 * original model has thousands of distinct values per axis and real units).
 */
export function inspectProxyGlb(bytes: Uint8Array): ProxyInspection {
  const empty = { triangles: 0, vertices: 0, maxDistinctPerAxis: 0, extent: 0, byteLength: bytes.length };
  let info: GlbInfo;
  try {
    info = parseGlb(bytes);
  } catch (error) {
    return { ok: false, reasons: [error instanceof ModelParseError ? error.message : "not_glb"], ...empty };
  }
  const reasons = [...info.structural];
  const { positions, indices } = info.mesh;
  const triangles = Math.floor(indices.length / 3);
  const [min, max] = boundsOf(positions);
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const distinct = [0, 1, 2].map((a) => new Set(positions.map((p) => round6(p[a]))).size);
  const maxDistinctPerAxis = Math.max(...distinct);
  if (bytes.length > PROXY_MAX_BYTES) reasons.push("too_large");
  if (triangles === 0) reasons.push("empty_mesh");
  if (triangles > PROXY_TRIANGLE_LIMIT) reasons.push("too_many_triangles");
  if (maxDistinctPerAxis > PROXY_MAX_DISTINCT_PER_AXIS) reasons.push("not_quantized");
  if (!(extent > 0.5 && extent <= 1.0001)) reasons.push("not_normalized");
  return { ok: reasons.length === 0, reasons, triangles, vertices: positions.length, maxDistinctPerAxis, extent, byteLength: bytes.length };
}

/** Parses an original model of a supported format (for fingerprints and generation). */
export function parseModel(bytes: Uint8Array, format: string): Mesh {
  const f = format.toLowerCase();
  if (f === "stl") return parseStl(bytes);
  if (f === "obj") return parseObj(bytes);
  if (f === "glb") return parseGlb(bytes).mesh;
  throw new ModelParseError("unsupported_format");
}

// ---------------------------------------------------------------------------

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function boundsOf(positions: Vec3[]): [Vec3, Vec3] {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) for (let a = 0; a < 3; a++) {
    if (p[a] < min[a]) min[a] = p[a];
    if (p[a] > max[a]) max[a] = p[a];
  }
  return positions.length ? [min, max] : [[0, 0, 0], [0, 0, 0]];
}
function finite(mesh: Mesh): Mesh {
  if (mesh.indices.length < 3 || mesh.positions.some((p) => !p.every(Number.isFinite))) throw new ModelParseError("empty_mesh");
  return mesh;
}
function latin1(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 65_536) s += String.fromCharCode(...bytes.subarray(i, i + 65_536));
  return s;
}
const pad4 = (n: number) => n + ((4 - (n % 4)) % 4);
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
