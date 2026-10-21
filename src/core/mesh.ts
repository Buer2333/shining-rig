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
    const lx = mx(x), root = smoothstep(r0, r1, lx), fore = 1 - smoothstep(e0, e1, lx);
    weights.push([root, Math.max(0, 1 - root - fore), fore]);
  }
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
    index.push(a, c, b, b, c, d);
  }
  return { rest, uv, weights, index, box: [x0, y0, x1, y1] };
};

// Writes skinned positions into out (x, -y, 0 per vertex: three.js is y-up).
export const skinLimb = (mesh: LimbMesh, shoulder: Vec2 | number[], elbow: Vec2 | number[], upperDeg: number, foreDeg: number, out: { setXYZ: (i: number, x: number, y: number, z: number) => unknown }) => {
  mesh.rest.forEach((p, k) => {
    const up = rotateAbout(p, shoulder, upperDeg), fo = rotateAbout(rotateAbout(p, elbow, foreDeg), shoulder, upperDeg), [wr, wu, wf] = mesh.weights[k];
    out.setXYZ(k, wr * p[0] + wu * up[0] + wf * fo[0], -(wr * p[1] + wu * up[1] + wf * fo[1]), 0);
  });
};
