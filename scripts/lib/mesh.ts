// Minimal procedural geometry for development seed data. Produces indexed
// triangle meshes (Y-up, millimetres) used to write GLB previews, binary STL
// downloads, and rendered product images, all from the same shapes.

export type Vec3 = [number, number, number];
export type Mesh = { positions: Vec3[]; indices: number[] };

export function merge(...meshes: Mesh[]): Mesh {
  const out: Mesh = { positions: [], indices: [] };
  for (const m of meshes) {
    const offset = out.positions.length;
    out.positions.push(...m.positions);
    out.indices.push(...m.indices.map((i) => i + offset));
  }
  return out;
}

export function translate(m: Mesh, [x, y, z]: Vec3): Mesh {
  return { positions: m.positions.map(([a, b, c]) => [a + x, b + y, c + z]), indices: m.indices };
}

export function rotateY(m: Mesh, angle: number): Mesh {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { positions: m.positions.map(([x, y, z]) => [x * c + z * s, y, -x * s + z * c]), indices: m.indices };
}

export function rotateX(m: Mesh, angle: number): Mesh {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { positions: m.positions.map(([x, y, z]) => [x, y * c - z * s, y * s + z * c]), indices: m.indices };
}

export function scale(m: Mesh, k: number | Vec3): Mesh {
  const [sx, sy, sz] = typeof k === "number" ? [k, k, k] : k;
  return { positions: m.positions.map(([x, y, z]) => [x * sx, y * sy, z * sz]), indices: m.indices };
}

/** Axis-aligned box centred on the origin in X/Z, sitting on y=0. */
export function box(w: number, h: number, d: number): Mesh {
  const x = w / 2;
  const z = d / 2;
  const p: Vec3[] = [
    [-x, 0, -z], [x, 0, -z], [x, h, -z], [-x, h, -z],
    [-x, 0, z], [x, 0, z], [x, h, z], [-x, h, z],
  ];
  const faces = [
    [4, 5, 6, 7], [1, 0, 3, 2], [0, 4, 7, 3], [5, 1, 2, 6], [3, 7, 6, 2], [0, 1, 5, 4],
  ];
  const indices: number[] = [];
  for (const [a, b, c, d2] of faces) indices.push(a, b, c, a, c, d2);
  return { positions: p, indices };
}

/**
 * Extrudes a star-shaped (visible from its centroid) outline in the XZ plane
 * from y=0 to y=height. Fan triangulation from the centre handles gears and
 * regular polygons.
 */
export function extrudeStar(outline: [number, number][], height: number): Mesh {
  const n = outline.length;
  const positions: Vec3[] = [];
  const indices: number[] = [];
  positions.push([0, 0, 0], [0, height, 0]);
  for (const [x, z] of outline) positions.push([x, 0, z], [x, height, z]);
  const bottom = (i: number) => 2 + 2 * (i % n);
  const top = (i: number) => 3 + 2 * (i % n);
  for (let i = 0; i < n; i++) {
    indices.push(0, bottom(i + 1), bottom(i)); // bottom cap
    indices.push(1, top(i), top(i + 1)); // top cap
    indices.push(bottom(i), bottom(i + 1), top(i + 1), bottom(i), top(i + 1), top(i)); // wall
  }
  return { positions, indices };
}

export function gearOutline(teeth: number, rOuter: number, rInner: number): [number, number][] {
  const pts: [number, number][] = [];
  const step = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    for (const [f, r] of [[0, rInner], [0.18, rOuter], [0.5, rOuter], [0.68, rInner]] as const) {
      pts.push([Math.cos(a + f * step) * r, Math.sin(a + f * step) * r]);
    }
  }
  return pts;
}

export function polygonOutline(sides: number, r: number, phase = 0): [number, number][] {
  return Array.from({ length: sides }, (_, i) => {
    const a = phase + (i / sides) * Math.PI * 2;
    return [Math.cos(a) * r, Math.sin(a) * r] as [number, number];
  });
}

/** Surface of revolution around Y from a (radius, y) profile, bottom to top. */
export function lathe(profile: [number, number][], segments = 48): Mesh {
  const positions: Vec3[] = [];
  const indices: number[] = [];
  const rows = profile.length;
  for (let s = 0; s <= segments; s++) {
    const a = (s / segments) * Math.PI * 2;
    for (const [r, y] of profile) positions.push([Math.cos(a) * r, y, Math.sin(a) * r]);
  }
  for (let s = 0; s < segments; s++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = s * rows + j;
      const b = (s + 1) * rows + j;
      indices.push(a, a + 1, b + 1, a, b + 1, b);
    }
  }
  // Caps where the profile does not close onto the axis.
  const [r0, y0] = profile[0];
  const [r1, y1] = profile[rows - 1];
  if (r0 > 0.001) {
    const c = positions.push([0, y0, 0]) - 1;
    for (let s = 0; s < segments; s++) indices.push(c, (s + 1) * rows, s * rows);
  }
  if (r1 > 0.001) {
    const c = positions.push([0, y1, 0]) - 1;
    for (let s = 0; s < segments; s++) indices.push(c, s * rows + rows - 1, (s + 1) * rows + rows - 1);
  }
  return { positions, indices };
}

export function cylinder(r: number, h: number, segments = 40): Mesh {
  return lathe([[r, 0], [r, h]], segments);
}

export function sphere(r: number, rings = 20): Mesh {
  const profile: [number, number][] = Array.from({ length: rings + 1 }, (_, i) => {
    const t = -Math.PI / 2 + (i / rings) * Math.PI;
    return [Math.max(0, Math.cos(t) * r), Math.sin(t) * r + r];
  });
  profile[0] = [0, 0];
  profile[rings] = [0, 2 * r];
  return lathe(profile, rings * 2);
}

export function bounds(m: Mesh) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of m.positions) for (let i = 0; i < 3; i++) {
    min[i] = Math.min(min[i], p[i]);
    max[i] = Math.max(max[i], p[i]);
  }
  return { min, max };
}

/** Flat per-face normals (for STL and faceted rendering). */
export function faceNormal(a: Vec3, b: Vec3, c: Vec3): Vec3 {
  const u: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n: Vec3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(...n) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

/** Non-indexed copy with per-face normals, as GLB needs for crisp faceting. */
export function flatten(m: Mesh) {
  const positions: number[] = [];
  const normals: number[] = [];
  for (let i = 0; i < m.indices.length; i += 3) {
    const a = m.positions[m.indices[i]];
    const b = m.positions[m.indices[i + 1]];
    const c = m.positions[m.indices[i + 2]];
    const n = faceNormal(a, b, c);
    positions.push(...a, ...b, ...c);
    normals.push(...n, ...n, ...n);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}
