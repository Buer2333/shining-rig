// Rig spec v1: the only contract between a character package (data + images) and the runtime.
// Coordinates are source-image pixels, y down; angles are degrees, clockwise positive (same as CSS rotate()).
// Binding chain: channel -> joint -> parts. Draw order (layering) is the order of `variants[*].draw`.

export type Vec2 = [number, number];
export type Box = [number, number, number, number]; // x0, y0, x1, y1

export type ChannelKind = "rotate" | "scaleY" | "body_translate" | "body_squash";
export interface ChannelSpec {
  kind: ChannelKind;
  joint?: string; // required for rotate / scaleY
  default: number;
}

export interface JointSpec {
  pivot: Vec2;
  parent: string | null;
  limits?: [number, number];
  mirror_of?: string;
}

export interface PartSpec {
  id: string;
  joint: string | null; // joint the part hangs on (null = body root)
  bbox: Box;
  asset: string; // file name under the character's asset folder
}

export interface CapSpec {
  at: Vec2;
  r: number;
  color: string;
}

// A limb drawn as one skinned mesh instead of rigid parts.
export interface MeshLimbSpec {
  part: string; // part whose image/bbox is the mesh texture
  bones: [string, string]; // [shoulder joint, elbow joint]
  mirror_x: boolean; // weight bands are given for the left limb; right limb mirrors x -> W - x
  root: [number, number]; // body -> upper-arm blend band (source px, left-limb coordinates)
  elbow: [number, number]; // upper-arm -> forearm blend band
  step: number; // grid spacing in source px
}

export type DrawNode =
  | { part: string }
  | { cap: string }
  | { joint: string; children: DrawNode[] }
  | { slot: string; when: "behind" | "front" }
  | { mesh: string[] }
  | { face: string };

// A group that switches between two slots (e.g. arm behind / in front of the torso) by a channel threshold.
export interface GroupSpec {
  front_when: { channel: string; op: ">" | "<"; value: number };
  children: DrawNode[];
}

export interface RestKeypoints {
  detector: string;
  model_md5: Record<string, string>; // model file -> md5
  image_sha256: string; // the character image they were measured on
  points: Vec2[]; // COCO-17 body order
  scores: number[];
  generator: string;
}
// How a channel is read off 2D keypoints (COCO-17 indices; an index list means the mean of those points).
// angle: direction of from->to relative to the rest pose (minus the parent channel's angle when parent is set);
// length: bone length relative to the rest pose (foreshortening), clipped; lift: hip-height change, see tools/track.py.
export type KpRef = number | number[];
export type KeypointMapEntry =
  | { kind: "angle"; from: KpRef; to: KpRef; parent?: string }
  | { kind: "length"; from: KpRef; to: KpRef; clip: [number, number] }
  | { kind: "lift"; hip: KpRef };

export interface RigSpec {
  spec_version: 1;
  character_id: string;
  rig_type: "cutout" | "mesh" | "hybrid";
  coord_space: { size: Vec2; y_down: true; deg_cw: true };
  scale: { body_h_px: number; ground_y: number; source: string };
  joints: Record<string, JointSpec>;
  channels: Record<string, ChannelSpec>;
  parts: PartSpec[];
  caps: Record<string, CapSpec>;
  mesh?: Record<string, MeshLimbSpec>;
  groups: Record<string, GroupSpec>;
  variants: Record<string, { draw: DrawNode[] }>;
  face?: { box: Box };
  rest_keypoints?: RestKeypoints;
  keypoint_map?: Record<string, KeypointMapEntry>;
  generator?: string;
}

export type Pose = Record<string, number>;

export class SpecError extends Error {}

const walk = (nodes: DrawNode[], fn: (n: DrawNode, joints: string[]) => void, joints: string[] = []) => {
  for (const n of nodes) {
    fn(n, joints);
    if ("joint" in n) walk(n.children, fn, [...joints, n.joint]);
  }
};

// Throws SpecError listing every broken reference; returns the spec unchanged when valid.
export const validateSpec = (spec: RigSpec): RigSpec => {
  const errs: string[] = [];
  const part = new Map(spec.parts.map((p) => [p.id, p]));
  if (spec.spec_version !== 1) errs.push(`spec_version ${spec.spec_version} is not 1`);
  for (const [id, j] of Object.entries(spec.joints)) {
    if (j.parent !== null && !spec.joints[j.parent]) errs.push(`joint ${id}: parent ${j.parent} missing`);
    if (j.mirror_of && !spec.joints[j.mirror_of]) errs.push(`joint ${id}: mirror_of ${j.mirror_of} missing`);
  }
  for (const [id, c] of Object.entries(spec.channels)) {
    if ((c.kind === "rotate" || c.kind === "scaleY") && (!c.joint || !spec.joints[c.joint])) errs.push(`channel ${id}: joint ${c.joint} missing`);
  }
  for (const p of spec.parts) if (p.joint !== null && !spec.joints[p.joint]) errs.push(`part ${p.id}: joint ${p.joint} missing`);
  for (const [id, m] of Object.entries(spec.mesh ?? {})) {
    if (!part.has(m.part)) errs.push(`mesh ${id}: part ${m.part} missing`);
    for (const b of m.bones) if (!spec.joints[b]) errs.push(`mesh ${id}: bone ${b} missing`);
  }
  const check = (nodes: DrawNode[], where: string) =>
    walk(nodes, (n, joints) => {
      if ("part" in n) {
        const p = part.get(n.part);
        if (!p) errs.push(`${where}: part ${n.part} missing`);
        else if (p.joint !== null && joints[joints.length - 1] !== p.joint) errs.push(`${where}: part ${n.part} drawn under ${joints[joints.length - 1] ?? "root"}, declared on ${p.joint}`);
      } else if ("cap" in n) {
        if (!spec.caps[n.cap]) errs.push(`${where}: cap ${n.cap} missing`);
      } else if ("joint" in n) {
        if (!spec.joints[n.joint]) errs.push(`${where}: joint ${n.joint} missing`);
      } else if ("slot" in n) {
        if (!spec.groups[n.slot]) errs.push(`${where}: group ${n.slot} missing`);
      } else if ("mesh" in n) {
        for (const m of n.mesh) if (!spec.mesh?.[m]) errs.push(`${where}: mesh ${m} missing`);
      }
    });
  for (const [id, g] of Object.entries(spec.groups)) {
    if (!spec.channels[g.front_when.channel]) errs.push(`group ${id}: channel ${g.front_when.channel} missing`);
    check(g.children, `group ${id}`);
  }
  for (const [id, v] of Object.entries(spec.variants)) check(v.draw, `variant ${id}`);
  if (errs.length) throw new SpecError(errs.join("\n"));
  return spec;
};

export const defaultPose = (spec: RigSpec): Pose => Object.fromEntries(Object.entries(spec.channels).map(([k, c]) => [k, c.default]));

// Rotate / scaleY channel ids driving a joint (first match wins).
export const channelsOf = (spec: RigSpec, joint: string) => {
  let rotate: string | undefined, scale: string | undefined;
  for (const [id, c] of Object.entries(spec.channels)) {
    if (c.joint !== joint) continue;
    if (c.kind === "rotate" && rotate === undefined) rotate = id;
    if (c.kind === "scaleY" && scale === undefined) scale = id;
  }
  return { rotate, scale };
};

export const bodyChannels = (spec: RigSpec) => {
  const find = (k: ChannelKind) => Object.entries(spec.channels).find(([, c]) => c.kind === k)?.[0];
  return { translate: find("body_translate"), squash: find("body_squash") };
};

export const inFront = (g: GroupSpec, pose: Pose) => {
  const v = pose[g.front_when.channel];
  return g.front_when.op === ">" ? v > g.front_when.value : v < g.front_when.value;
};
