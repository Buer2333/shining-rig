import { describe, expect, it } from "vitest";
import { buildLimbMesh, rotateAbout, skinLimb, smoothstep } from "../src/core/mesh";
import { Clip, easeInOutCubic, sampleClip, trackPose, Track } from "../src/core/pose";
import { channelsOf, defaultPose, inFront, SpecError, validateSpec } from "../src/core/spec";
import JUMP from "../src/actions/jump.json";
import { toySpec } from "./fixtures";

const collect = (n: number) => {
  const xy: [number, number][] = Array.from({ length: n }, () => [0, 0]);
  return { xy, out: { setXYZ: (i: number, x: number, y: number) => { xy[i] = [x, y]; } } };
};

describe("spec", () => {
  it("accepts the toy rig", () => expect(() => validateSpec(toySpec())).not.toThrow());

  it("reports a channel bound to a missing joint", () => {
    const s = toySpec();
    s.channels.foreL.joint = "wristL";
    expect(() => validateSpec(s)).toThrow(SpecError);
    expect(() => validateSpec(s)).toThrow(/channel foreL: joint wristL missing/);
  });

  it("reports a part drawn under the wrong joint", () => {
    const s = toySpec();
    s.variants.cutout.draw.push({ part: "foreL" }); // foreL hangs on elbowL, drawn at root here
    expect(() => validateSpec(s)).toThrow(/part foreL drawn under root, declared on elbowL/);
  });

  it("reports a slot without a group and a mesh without a limb", () => {
    const s = toySpec();
    s.variants.mesh.draw.push({ slot: "armR", when: "front" }, { mesh: ["legL"] });
    expect(() => validateSpec(s)).toThrow(/group armR missing[\s\S]*mesh legL missing/);
  });

  it("binds channels to joints and resolves front/behind", () => {
    const s = toySpec();
    expect(channelsOf(s, "elbowL")).toEqual({ rotate: "foreL", scale: undefined });
    const g = s.groups.armL;
    expect(inFront(g, { ...defaultPose(s), armL: -10 })).toBe(false); // strict
    expect(inFront(g, { ...defaultPose(s), armL: -9.9 })).toBe(true);
  });
});

describe("pose", () => {
  it("eases from 0 to 1 symmetrically", () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 12);
  });

  it("hits keys exactly and falls back to defaults", () => {
    const clip = JUMP as Clip;
    const d = { ...defaultPose(toySpec()), thighL: 0, shinL: 0, tsL: 1 };
    const at = sampleClip(clip, 1.3, d);
    expect(at.armL).toBe(48);
    expect(at.lift).toBe(0.3);
    expect(sampleClip(clip, 0, d).squash).toBe(1); // not in the first key -> default
    expect(sampleClip(clip, 99, d).armR).toBe(-38); // past the end holds the last key
  });

  it("holds the last track frame", () => {
    const t: Track = { spec_version: 1, fps: 30, channels: ["armL"], frames: [{ armL: 1 }, { armL: 2 }] };
    expect(trackPose(t, 5, { armL: 0, head: 0 })).toEqual({ armL: 2, head: 0 });
  });
});

describe("mesh skinning", () => {
  const s = toySpec();
  const L = buildLimbMesh(s, s.mesh!.meshL), R = buildLimbMesh(s, s.mesh!.meshR);

  it("weights sum to 1 and stay in [0, 1]", () => {
    for (const w of [...L.weights, ...R.weights]) {
      expect(w[0] + w[1] + w[2]).toBeCloseTo(1, 12);
      for (const v of w) expect(v >= 0 && v <= 1).toBe(true);
    }
  });

  it("zero angles reproduce the rest grid (y flipped for three.js)", () => {
    const { xy, out } = collect(L.rest.length);
    skinLimb(L, s.joints.shoulderL.pivot, s.joints.elbowL.pivot, 0, 0, out);
    L.rest.forEach((p, k) => { expect(xy[k][0]).toBeCloseTo(p[0], 9); expect(xy[k][1]).toBeCloseTo(-p[1], 9); });
  });

  it("mirrors left and right limbs", () => {
    const W = s.coord_space.size[0], { root, elbow } = s.mesh!.meshL;
    const left = (x: number) => { const r = smoothstep(root[0], root[1], x), f = 1 - smoothstep(elbow[0], elbow[1], x); return [r, Math.max(0, 1 - r - f), f]; };
    // every right-limb vertex at x carries the left-limb weights for W - x
    R.rest.forEach((p, k) => expect(R.weights[k]).toEqual(left(W - p[0])));
    // and the bands are not degenerate: the right limb has pure body, pure upper and pure forearm vertices
    for (const i of [0, 1, 2]) expect(R.weights.some((w) => w[i] === 1)).toBe(true);
  });

  it("a fully rotated forearm vertex follows both joints", () => {
    const k = L.rest.findIndex((q) => q[0] <= 72 && q[1] === 260);
    const { xy, out } = collect(L.rest.length);
    skinLimb(L, s.joints.shoulderL.pivot, s.joints.elbowL.pivot, 30, 45, out);
    const want = rotateAbout(rotateAbout(L.rest[k], s.joints.elbowL.pivot, 45), s.joints.shoulderL.pivot, 30);
    expect(L.weights[k][2]).toBe(1);
    expect(xy[k][0]).toBeCloseTo(want[0], 9);
    expect(xy[k][1]).toBeCloseTo(-want[1], 9);
  });
});
