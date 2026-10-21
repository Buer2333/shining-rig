// Mesh-skinned limbs in one ThreeCanvas the size of the source image; sits inside RigFigure's body layer.
// Remotion three.js rules: pose comes only from the current frame (no useFrame); render with --gl=angle.
import React, { useEffect, useMemo, useState } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import * as THREE from "three";
import { buildLimbMesh, skinLimb, SkinOpts } from "../core/mesh";
import { channelsOf, Pose, RigSpec } from "../core/spec";

const Limb: React.FC<{ spec: RigSpec; id: string; tex: THREE.Texture; pose: Pose; body?: SkinOpts["body"] }> = ({ spec, id, tex, pose, body }) => {
  const limb = spec.mesh![id];
  const base = useMemo(() => buildLimbMesh(spec, limb), [spec, limb]);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(base.rest.length * 3), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(base.uv, 2));
    g.setIndex(base.index);
    return g;
  }, [base]);
  const [sh, el] = limb.bones;
  const up = channelsOf(spec, sh), lo = channelsOf(spec, el);
  const v = (ch: string | undefined, d: number) => (ch ? pose[ch] : d);
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  skinLimb(base, spec.joints[sh].pivot, spec.joints[el].pivot, v(up.rotate, 0), v(lo.rotate, 0), pos, { sy0: v(up.scale, 1), sy1: v(lo.scale, 1), body });
  pos.needsUpdate = true;
  return <mesh geometry={geo}><meshBasicMaterial map={tex} transparent depthTest={false} /></mesh>;
};

// While rendering, ThreeCanvas runs frameloop="never" and only advances on frame changes; textures arrive
// asynchronously, so draw once by hand before letting the frame be captured (else each worker's first frame is empty).
const Ready: React.FC<{ handle: number }> = ({ handle }) => {
  const { advance } = useThree();
  useEffect(() => { advance(performance.now()); continueRender(handle); }, [handle, advance]);
  return null;
};

// bodySy: scaleY accumulated by the joints this mesh sits under (a foreshortening torso). The limbs are unscaled about
// their root pivot's y so they keep their shape, and body-weighted vertices take the scale back (see SkinOpts.body).
export const MeshLimbs: React.FC<{ spec: RigSpec; ids: string[]; pose: Pose; assetBase: string; bodySy?: number }> = ({ spec, ids, pose, assetBase, bodySy = 1 }) => {
  const [IW, IH] = spec.coord_space.size;
  const y0 = spec.joints[spec.mesh![ids[0]].bones[0]].pivot[1];
  const body = bodySy === 1 ? undefined : { y: y0, sy: bodySy };
  const unscale = body ? { transformOrigin: `0px ${y0}px`, transform: `scaleY(${1 / bodySy})` } : {};
  const [handle] = useState(() => delayRender("MeshLimbs: textures"));
  const [tex, setTex] = useState<Record<string, THREE.Texture> | null>(null);
  useEffect(() => {
    const load = (id: string) => {
      const part = spec.parts.find((p) => p.id === spec.mesh![id].part)!;
      return new THREE.TextureLoader().loadAsync(staticFile(`${assetBase}/${part.asset}`)).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; return [id, t] as const;
      });
    };
    Promise.all(ids.map(load)).then((all) => setTex(Object.fromEntries(all))).catch((e) => cancelRender(e));
  }, [handle, ids, spec, assetBase]);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: IW, height: IH, ...unscale }}>
      <ThreeCanvas flat width={IW} height={IH} orthographic gl={{ antialias: true, premultipliedAlpha: false, alpha: true }}
        camera={{ position: [IW / 2, -IH / 2, 10], rotation: [0, 0, 0], zoom: 1, near: 0.1, far: 100 }}>
        {/* explicit rotation stops R3F from auto lookAt(0,0,0) */}
        {tex && <>{ids.map((id) => <Limb key={id} spec={spec} id={id} tex={tex[id]} pose={pose} body={body} />)}<Ready handle={handle} /></>}
      </ThreeCanvas>
    </div>
  );
};
