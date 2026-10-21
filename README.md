# shining-rig

2D character rig for [Remotion](https://www.remotion.dev): cut a single front-view character drawing into parts,
animate it with keyframe clips or with pose tracks extracted from video, and render limbs either as rigid cutout
parts or as mesh-skinned sheets that bend without seams.

Built for one cartoon IP character, written so the character is data: the library holds no character constants.
No character art lives in this repository — rigs are JSON, images stay with the project that owns the character.

## Layers

| Layer | Path | What it does |
|---|---|---|
| Rig spec | `src/core/spec.ts`, [docs/spec.md](docs/spec.md) | The contract: channels → joints → parts, draw order, mesh limbs, keypoint recipes |
| Engine | `src/core/` | Pure TypeScript: pose sampling and easing, linear blend skinning, spec validation |
| Remotion | `src/remotion/` | `<RigFigure>` (cutout parts, outline pass, front/behind groups), `<MeshLimbs>` (three.js) |
| Actions | `src/actions/` | Keyframe clips (`jump.json`); per-frame tracks share the `Track` format |
| Tools | `tools/` | `cut.py` (image → parts + rig.json), `track.py` (video → track), `rig_lint.py`, `spec_migrate.py` |

## Compatibility

Pinned to the consuming project: Remotion **4.0.440**, React 19, three 0.186.1, @react-three/fiber 9.8.1
(`peerDependencies`). Mesh limbs use WebGL: render with `--gl=angle`. Frame rate always comes from `useVideoConfig()`.

## Use

```tsx
import { useCurrentFrame, useVideoConfig } from "remotion";
import { RigFigure, clipPose, validateSpec, type Clip, type RigSpec } from "./vendor/shining-rig";
import RIG from "../public/rig/<character>/rig.json";
import JUMP from "./vendor/shining-rig/actions/jump.json";

const spec = validateSpec(RIG as RigSpec);
export const Jump = () => {
  const f = useCurrentFrame(), { fps } = useVideoConfig();
  return <RigFigure spec={spec} pose={clipPose(spec, JUMP as Clip, f / fps)} assetBase="rig/<character>" variant="mesh" />;
};
```

The consuming project copies `src/` in at a tagged release (read-only, see [docs/releasing.md](docs/releasing.md));
Remotion's bundler then compiles it like any other source file.

## Tools

```bash
python3 -m venv .venv && .venv/bin/pip install -r tools/requirements.lock
.venv/bin/python tools/cut.py <character>/config.json <out dir> [--debug cut.jpg]
.venv/bin/python tools/rig_lint.py <out dir>/rig.json --assets <out dir>
.venv/bin/python tools/track.py rest <out dir>/rig.json <character image>
.venv/bin/python tools/track.py extract <out dir>/rig.json <keyed png frames dir> <track.json> --fps-in 24
```

Every artifact carries a `generator` stamp (`shining-rig@<tag>+<sha>` or `shining-rig@candidate+<sha>`); tools refuse
to run from a dirty checkout.

## Test

```bash
npm ci && npx tsc --noEmit && npx vitest run
.venv/bin/python -m pytest tests
```

Tests use synthetic characters drawn in code.

## Credits

Field ideas (part parents, joint limits, named poses, QA verdicts) were informed by reading OpenMontage's
character-rigging design; no code from it is included. The ball-joint cap and layer-switching approach come from
classic cutout animation practice.

MIT License.
