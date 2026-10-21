// Renders a rig at one pose: stage (ground shadow, placement), body transform (lift, squash), outline pass,
// then the variant's draw list. Every part sits in a source-image-sized layer; joints are nested layers that
// rotate about their pivot (and scaleY for foreshortening), so children follow their parents.
import React from "react";
import { AbsoluteFill, Img, staticFile, useVideoConfig } from "remotion";
import { bodyChannels, channelsOf, DrawNode, inFront, Pose, RigSpec } from "../core/spec";
import { MeshLimbs } from "./MeshLimbs";

export interface Stage {
  bodyFrac: number; // figure height as a fraction of frame height
  feetFrac: number; // ground line as a fraction of frame height
  background: string;
  shadow: { w: number; h: number; dy: number; color: string; opacity: number }; // source px
}
export interface Outline { px: number; ink: string; id: string }

const STAGE: Stage = { bodyFrac: 0.5, feetFrac: 0.873, background: "#f3eee3", shadow: { w: 460, h: 60, dy: 24, color: "#141a4d", opacity: 0.14 } };
const OUTLINE: Outline = { px: 2, ink: "#140a08", id: "rig2d-outline" };

interface Ctx { spec: RigSpec; pose: Pose; assetBase: string; face?: (box: [number, number, number, number], id: string) => React.ReactNode }

const Draw: React.FC<{ nodes: DrawNode[]; c: Ctx }> = ({ nodes, c }) => {
  const [IW, IH] = c.spec.coord_space.size;
  return (
    <>
      {nodes.map((n, i) => {
        if ("part" in n) {
          const p = c.spec.parts.find((q) => q.id === n.part)!;
          const [x0, y0, x1, y1] = p.bbox;
          return <Img key={i} src={staticFile(`${c.assetBase}/${p.asset}`)} style={{ position: "absolute", left: x0, top: y0, width: x1 - x0, height: y1 - y0 }} />;
        }
        if ("cap" in n) {
          const k = c.spec.caps[n.cap];
          return <div key={i} style={{ position: "absolute", left: k.at[0] - k.r, top: k.at[1] - k.r, width: k.r * 2, height: k.r * 2, borderRadius: "50%", background: k.color }} />;
        }
        if ("joint" in n) {
          const [x, y] = c.spec.joints[n.joint].pivot, ch = channelsOf(c.spec, n.joint);
          const deg = ch.rotate ? c.pose[ch.rotate] : 0, sy = ch.scale ? c.pose[ch.scale] : 1;
          return (
            <div key={i} style={{ position: "absolute", left: 0, top: 0, width: IW, height: IH, transformOrigin: `${x}px ${y}px`, transform: `rotate(${deg}deg) scaleY(${sy})` }}>
              <Draw nodes={n.children} c={c} />
            </div>
          );
        }
        if ("slot" in n) {
          const g = c.spec.groups[n.slot];
          return (n.when === "front") === inFront(g, c.pose) ? <Draw key={i} nodes={g.children} c={c} /> : null;
        }
        if ("mesh" in n) return <MeshLimbs key={i} spec={c.spec} ids={n.mesh} pose={c.pose} assetBase={c.assetBase} />;
        if ("face" in n) return c.face && c.spec.face ? <React.Fragment key={i}>{c.face(c.spec.face.box, n.face)}</React.Fragment> : null;
        return null;
      })}
    </>
  );
};

export const RigFigure: React.FC<{
  spec: RigSpec;
  pose: Pose;
  assetBase: string; // public/ folder holding the character's part images
  variant?: string;
  stage?: Partial<Stage>;
  outline?: Partial<Outline>;
  face?: Ctx["face"]; // draws expressions on the blank face; the library never imports project code
}> = ({ spec, pose, assetBase, variant = "cutout", stage, outline, face }) => {
  const { width, height } = useVideoConfig();
  const st = { ...STAGE, ...stage }, ol = { ...OUTLINE, ...outline };
  const [IW, IH] = spec.coord_space.size;
  const bodyH = spec.scale.body_h_px, feetSrc = spec.scale.ground_y;
  const body = bodyChannels(spec);
  const lift = body.translate ? pose[body.translate] : 0, squash = body.squash ? pose[body.squash] : 1;
  const S = (height * st.bodyFrac) / bodyH;
  const feetY = height * st.feetFrac;
  const liftPx = lift * bodyH;
  const shrink = 1 - Math.min(0.5, Math.max(0, lift));
  return (
    <AbsoluteFill style={{ background: st.background }}>
      {/* contact shadow: smaller and fainter the higher the figure */}
      <div style={{ position: "absolute", left: width / 2 - (st.shadow.w / 2) * S * shrink, top: feetY - st.shadow.dy * S, width: st.shadow.w * S * shrink, height: st.shadow.h * S, borderRadius: "50%",
        background: st.shadow.color, opacity: st.shadow.opacity - Math.min(0.09, Math.max(0, lift) * 0.25) }} />
      <div style={{ position: "absolute", left: width / 2 - (IW / 2) * S, top: feetY - feetSrc * S, width: IW, height: IH, transformOrigin: "0 0",
        transform: `scale(${S}) translateY(${-liftPx}px)` }}>
        {/* outline: silhouette dilated by px (source px) filled with ink, under the art */}
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={ol.id} x="-5%" y="-5%" width="110%" height="110%" colorInterpolationFilters="sRGB">
            <feMorphology in="SourceAlpha" operator="dilate" radius={ol.px} result="fat" />
            <feFlood floodColor={ol.ink} /><feComposite in2="fat" operator="in" result="ink" />
            <feMerge><feMergeNode in="ink" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </svg>
        {/* whole-body squash about the feet */}
        <div style={{ position: "absolute", left: 0, top: 0, width: IW, height: IH, transformOrigin: `${IW / 2}px ${feetSrc}px`, transform: `scale(${1 / Math.sqrt(squash)}, ${squash})`, filter: `url(#${ol.id})` }}>
          <Draw nodes={spec.variants[variant].draw} c={{ spec, pose, assetBase, face }} />
        </div>
      </div>
    </AbsoluteFill>
  );
};
