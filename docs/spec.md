# Rig spec v1

One JSON file per character (`rig.json`), written by `tools/cut.py` from a character config. Coordinates are
source-image pixels with y pointing down; angles are degrees, clockwise positive (CSS `rotate()`).

## Binding: channels → joints → parts

| Field | Meaning |
|---|---|
| `channels.<id>` | `{kind, joint?, default}`. `rotate` / `scaleY` act on `joint`; `body_translate` (lift, fraction of body height) and `body_squash` act on the whole figure. A pose is `{channel: value}`. |
| `joints.<id>` | `{pivot, parent, limits?, mirror_of?}`. `pivot` is the rotation centre only — never a detector keypoint. |
| `parts[]` | `{id, joint, bbox, asset}`. The part hangs on `joint` (null = body root); `bbox` places the image back where it was cut from. |
| `caps.<id>` | Solid discs (`at`, `r`, `color`) drawn under a joint seam. |
| `groups.<id>` | Children that switch between a `behind` and a `front` slot by `front_when: {channel, op, value}` (e.g. an arm crossing in front of the torso once raised). |
| `variants.<id>.draw` | The draw tree. Order = layering. Nodes: `{part}`, `{cap}`, `{joint, children}`, `{slot, when}`, `{mesh: [limb ids]}`, `{face}`. A part must be drawn directly under the joint it declares. |
| `mesh.<id>` | Mesh-skinned limb: `{part, bones: [shoulder, elbow], mirror_x, root, elbow, step}`. `root` / `elbow` are blend bands in source x (left-limb coordinates; `mirror_x` mirrors them). |

## Scale and ground

`scale: {body_h_px, ground_y, source}` — figure height and sole line in source px. `cut.py` measures them from the
foreground alpha unless the config pins them; `source` says which.

## Keypoints (video → channels)

| Field | Meaning |
|---|---|
| `rest_keypoints` | COCO-17 points measured on the character image itself (`track.py rest`), with detector name, model file md5s, image sha256. Kept separate from pivots. |
| `keypoint_map.<channel>` | `angle {from, to, parent?}` (direction change vs rest; minus the parent channel), `length {from, to, clip}` (foreshortening ratio), `lift {hip}`. `from` / `to` may be a list = mean of points. Order matters: parents first. |

## Track (`track.py extract`)

`{spec_version, fps, channels[], frames[], calib, generator}`; `calib` records the video scale, ground line, detection
counts and model md5s. Frames past the end hold the last pose.

## Character config (input to `cut.py`)

`{character_id, source, cut, rig}`. Everything character-specific lives in `cut` and can be switched off: background
(flood fill from `seeds` with `thresh`, or `{"method": "alpha", "alpha_gt": 127}` for transparent PNG art), erosion, part and mesh polygons (display coordinates + `display_width`), mirrored parts/joints,
`protect_regions` (e.g. a chest logo the shoulder cap must not cover), `ball_joints` (`flat_fill.enabled`, sample offset,
kept top band), `caps` (colour sample points). `rig` is copied into the spec (channels, parents, groups, variants,
mesh limbs, face, keypoint map).

## Provenance

`generator`: `shining-rig@<tag>+<sha>` when the tool ran exactly on a tag, else `shining-rig@candidate+<sha>`; tools
refuse a dirty checkout. Candidate stamps are not rewritten after release; the consuming project's version ledger
binds tag → sha, and acceptance compares the sha.
