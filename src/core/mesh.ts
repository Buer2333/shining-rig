// Mesh-skinned limbs: one grid over the limb image, each vertex blended between body, upper-arm and forearm
// transforms (linear blend skinning). Coordinates in source px, y down, CSS-clockwise angles.
import { MeshLimbSpec, RigSpec, Vec2 } from "./spec";

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// CSS rotate(deg) about c.
export const rotateAbout = (p: Vec2, c: Vec2 | number[], deg: number): Vec2 => {
  const r = (deg * Math.PI) / 180, dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * Math.cos(r) - dy * Math.sin(r), c[1] + dx * Math.sin(r) + dy * Math.cos(r)];
};

export interface LimbMesh {
  rest: Vec2[];
  uv: number[];
  weights: [number, number, number][]; // body, upper, fore
  index: number[];
  box: [number, number, number, number];
}

export const buildLimbMesh = (spec: RigSpec, limb: MeshLimbSpec): LimbMesh => {
  const part = spec.parts.find((p) => p.id === limb.part);
  if (!part) throw new Error(`mesh part ${limb.part} missing`);
  const [x0, y0, x1, y1] = part.bbox;
  const W = spec.coord_space.size[0];
  const mx = (x: number) => (limb.mirror_x ? W - x : x);
  const [r0, r1] = limb.root, [e0, e1] = limb.elbow, STEP = limb.step;
  const nx = Math.ceil((x1 - x0) / STEP), ny = Math.ceil((y1 - y0) / STEP);
  const rest: Vec2[] = [], uv: number[] = [], weights: [number, number, number][] = [], index: number[] = [];
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const x = Math.min(x1, x0 + i * STEP), y = Math.min(y1, y0 + j * STEP);
    rest.push([x, y]);
    uv.push((x - x0) / (x1 - x0), 1 - (y - y0) / (y1 - y0));
    const lx = limb.axis === "y" ? y : mx(x), root = smoothstep(r0, r1, lx), fore = 1 - smoothstep(e0, e1, lx);
    weights.push([root, Math.max(0, 1 - root - fore), fore]);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  return { rest, uv, weights, index, box: [x0, y0, x1, y1] };
};

// CSS `rotate(deg) scaleY(sy)` about c: scale in the joint's own frame first, then rotate (same as RigFigure's joints).
export const jointAbout = (p: Vec2, c: Vec2 | number[], deg: number, sy = 1): Vec2 => rotateAbout([p[0], c[1] + (p[1] - c[1]) * sy], c, deg);

export interface SkinOpts {
  sy0?: number; sy1?: number; // scaleY of the two bones (leg length channels); arms leave them at 1
  body?: { y: number; sy: number }; // the limb layer is unscaled about y while the torso it hangs on is scaled by sy:
  // body-weighted vertices take that scale back so they stay glued to the torso
}

// Writes skinned positions into out (x, -y, 0 per vertex: three.js is y-up). With no opts this is the rotate-only skin.
export const skinLimb = (mesh: LimbMesh, shoulder: Vec2 | number[], elbow: Vec2 | number[], upperDeg: number, foreDeg: number, out: { setXYZ: (i: number, x: number, y: number, z: number) => unknown }, o: SkinOpts = {}) => {
  const sy0 = o.sy0 ?? 1, sy1 = o.sy1 ?? 1;
  mesh.rest.forEach((p, k) => {
    const up = jointAbout(p, shoulder, upperDeg, sy0), fo = jointAbout(jointAbout(p, elbow, foreDeg, sy1), shoulder, upperDeg, sy0), [wr, wu, wf] = mesh.weights[k];
    const b: Vec2 = o.body ? [p[0], o.body.y + (p[1] - o.body.y) * o.body.sy] : p;
    out.setXYZ(k, wr * b[0] + wu * up[0] + wf * fo[0], -(wr * b[1] + wu * up[1] + wf * fo[1]), 0);
  });
};
