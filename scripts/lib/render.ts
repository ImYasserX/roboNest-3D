import sharp from "sharp";
import { bounds, faceNormal, type Mesh, type Vec3 } from "./mesh";

// Tiny z-buffered software rasterizer: renders a mesh as a clean studio shot
// (three-quarter view, soft key + rim light) for seed product images.

type RenderOptions = { size?: number; color: [number, number, number]; yaw?: number; pitch?: number; background?: [string, string] };

export async function renderMesh(mesh: Mesh, opts: RenderOptions): Promise<Buffer> {
  const size = opts.size ?? 1000;
  const ss = 2; // supersampling for anti-aliasing
  const W = size * ss;
  const { min, max } = bounds(mesh);
  const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const radius = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2;
  const yaw = opts.yaw ?? -0.65;
  const pitch = opts.pitch ?? 0.5;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const toView = ([x, y, z]: Vec3): Vec3 => {
    const px = x - center[0], py = y - center[1], pz = z - center[2];
    const x1 = px * cy + pz * sy;
    const z1 = -px * sy + pz * cy;
    const y2 = py * cp - z1 * sp;
    const z2 = py * sp + z1 * cp;
    return [x1, y2, z2];
  };
  const dist = radius * 4;
  const focal = (W * 0.62) / (radius / dist) / 2.2;
  const project = ([x, y, z]: Vec3): Vec3 => {
    const d = dist - z;
    return [W / 2 + (x * focal) / d, W / 2 - (y * focal) / d + W * 0.02, d];
  };

  const zbuf = new Float32Array(W * W).fill(Infinity);
  const rgb = new Uint8ClampedArray(W * W * 4);
  const light: Vec3 = normalize([-0.4, 0.8, 0.9]);
  const rim: Vec3 = normalize([0.7, 0.3, -0.6]);
  const [cr, cg, cb] = opts.color;

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const va = toView(mesh.positions[mesh.indices[t]]);
    const vb = toView(mesh.positions[mesh.indices[t + 1]]);
    const vc = toView(mesh.positions[mesh.indices[t + 2]]);
    let n = faceNormal(va, vb, vc);
    if (n[2] < 0) n = [-n[0], -n[1], -n[2]]; // two-sided
    const diffuse = Math.max(0, dot(n, light));
    const rimL = Math.pow(Math.max(0, dot(n, rim)), 2) * 0.35;
    const shade = 0.28 + diffuse * 0.72 + rimL;
    const color = [cr * shade * 255, cg * shade * 255, cb * shade * 255].map((v) => Math.min(255, v + rimL * 60));
    const a = project(va), b = project(vb), c = project(vc);
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(W - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = edge(a, b, c);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const p: Vec3 = [x + 0.5, y + 0.5, 0];
        const w0 = edge(b, c, p) / area, w1 = edge(c, a, p) / area, w2 = edge(a, b, p) / area;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = w0 * a[2] + w1 * b[2] + w2 * c[2];
        const i = y * W + x;
        if (depth >= zbuf[i]) continue;
        zbuf[i] = depth;
        rgb[i * 4] = color[0];
        rgb[i * 4 + 1] = color[1];
        rgb[i * 4 + 2] = color[2];
        rgb[i * 4 + 3] = 255;
      }
    }
  }

  const [bg1, bg2] = opts.background ?? ["#221c33", "#0f0c18"];
  const backdrop = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></radialGradient><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#c79bff" stroke-opacity="0.05"/></pattern></defs><rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#p)"/><ellipse cx="50%" cy="80%" rx="30%" ry="5%" fill="#000" fill-opacity="0.35"/></svg>`,
  );
  const object = await sharp(Buffer.from(rgb.buffer), { raw: { width: W, height: W, channels: 4 } }).resize(size, size).png().toBuffer();
  return sharp(backdrop).composite([{ input: object }]).webp({ quality: 86 }).toBuffer();
}

function edge(a: Vec3, b: Vec3, c: Vec3) {
  return (c[0] - a[0]) * (b[1] - a[1]) - (c[1] - a[1]) * (b[0] - a[0]);
}
function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(...v);
  return [v[0] / l, v[1] / l, v[2] / l];
}
