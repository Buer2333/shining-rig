// A small synthetic character (512x768, no art) used by the tests.
import { RigSpec } from "../src/core/spec";

export const toySpec = (): RigSpec => ({
  spec_version: 1,
  character_id: "toy",
  rig_type: "hybrid",
  coord_space: { size: [512, 768], y_down: true, deg_cw: true },
  scale: { body_h_px: 700, ground_y: 740, source: "synthetic" },
  joints: {
    neck: { pivot: [256, 200], parent: null },
    shoulderL: { pivot: [200, 260], parent: null },
    elbowL: { pivot: [140, 260], parent: "shoulderL" },
    shoulderR: { pivot: [312, 260], parent: null, mirror_of: "shoulderL" },
    elbowR: { pivot: [372, 260], parent: "shoulderR", mirror_of: "elbowL" },
  },
  channels: {
    armL: { kind: "rotate", joint: "shoulderL", default: 0 },
    foreL: { kind: "rotate", joint: "elbowL", default: 0 },
    armR: { kind: "rotate", joint: "shoulderR", default: 0 },
    foreR: { kind: "rotate", joint: "elbowR", default: 0 },
    head: { kind: "rotate", joint: "neck", default: 0 },
    lift: { kind: "body_translate", default: 0 },
    squash: { kind: "body_squash", default: 1 },
  },
  parts: [
    { id: "torso", joint: null, bbox: [200, 200, 312, 500], asset: "torso.png" },
    { id: "head", joint: "neck", bbox: [180, 40, 332, 210], asset: "head.png" },
    { id: "armL", joint: "shoulderL", bbox: [140, 240, 210, 280], asset: "armL.png" },
    { id: "foreL", joint: "elbowL", bbox: [60, 240, 150, 280], asset: "foreL.png" },
    { id: "meshL", joint: "shoulderL", bbox: [60, 236, 230, 284], asset: "meshL.png" },
    { id: "meshR", joint: "shoulderR", bbox: [282, 236, 452, 284], asset: "meshR.png" },
  ],
  caps: { elbowL: { at: [140, 260], r: 12, color: "#f0c0a0" } },
  mesh: {
    meshL: { part: "meshL", bones: ["shoulderL", "elbowL"], mirror_x: false, root: [190, 220], elbow: [135, 150], step: 6 },
    meshR: { part: "meshR", bones: ["shoulderR", "elbowR"], mirror_x: true, root: [190, 220], elbow: [135, 150], step: 6 },
  },
  groups: {
    armL: { front_when: { channel: "armL", op: ">", value: -10 }, children: [{ joint: "shoulderL", children: [{ joint: "elbowL", children: [{ cap: "elbowL" }, { part: "foreL" }] }, { part: "armL" }] }] },
  },
  variants: {
    cutout: { draw: [{ slot: "armL", when: "behind" }, { part: "torso" }, { slot: "armL", when: "front" }, { joint: "neck", children: [{ part: "head" }, { face: "main" }] }] },
    mesh: { draw: [{ part: "torso" }, { mesh: ["meshL", "meshR"] }, { joint: "neck", children: [{ part: "head" }] }] },
  },
  face: { box: [200, 80, 112, 100] },
});
