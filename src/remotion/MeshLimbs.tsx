// Mesh-skinned limbs in one ThreeCanvas the size of the source image; sits inside RigFigure's body layer.
// Remotion three.js rules: pose comes only from the current frame (no useFrame); render with --gl=angle.
import React, { useEffect, useMemo, useState } from "react";
import { ThreeCanvas } from "@remotion/three";
import { useThree } from "@react-three/fiber";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";
import * as THREE from "three";
import { buildLimbMesh, skinLimb } from "../core/mesh";
import { channelsOf, Pose, RigSpec } from "../core/spec";

const Limb: React.FC<{ spec: RigSpec; id: string; tex: THREE.Texture; pose: Pose }> = ({ spec, id, tex, pose }) => {
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
  const upper = channelsOf(spec, sh).rotate, fore = channelsOf(spec, el).rotate;
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  skinLimb(base, spec.joints[sh].pivot, spec.joints[el].pivot, upper ? pose[upper] : 0, fore ? pose[fore] : 0, pos);
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

export const MeshLimbs: React.FC<{ spec: RigSpec; ids: string[]; pose: Pose; assetBase: string }> = ({ spec, ids, pose, assetBase }) => {
  const [IW, IH] = spec.coord_space.size;
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
    <div style={{ position: "absolute", left: 0, top: 0, width: IW, height: IH }}>
      <ThreeCanvas flat width={IW} height={IH} orthographic gl={{ antialias: true, premultipliedAlpha: false, alpha: true }}
        camera={{ position: [IW / 2, -IH / 2, 10], rotation: [0, 0, 0], zoom: 1, near: 0.1, far: 100 }}>
        {/* explicit rotation stops R3F from auto lookAt(0,0,0) */}
        {tex && <>{ids.map((id) => <Limb key={id} spec={spec} id={id} tex={tex[id]} pose={pose} />)}<Ready handle={handle} /></>}
      </ThreeCanvas>
    </div>
  );
};
