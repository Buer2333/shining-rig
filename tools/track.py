"""Pose tracks from video: 2D body keypoints per frame -> rig channel values.

  track.py rest <rig.json> <character image>          measure rest keypoints on the rig's own source image, store in rig.json
  track.py extract <rig.json> <frames dir> <out.json>  keypoints for every PNG (alpha composited on white) -> track v1
        [--fps-in 24] [--fps-out 30]
  track.py migrate <legacy track.json> <out.json>     wrap a POC track ({fps, keys, frames}) as track v1 (frames unchanged)

Rest keypoints and rig pivots are kept apart: pivots are rotation centres, keypoints are what the detector sees.
Channel recipes come from the spec's keypoint_map. Scale: video px per source px = median torso length ratio;
ground = lowest ankle over the clip; lift is zeroed on the first frame (clips start standing).
Needs: rtmlib + onnxruntime + opencv (first run downloads ~300MB of models to ~/.cache/rtmlib).
"""
import argparse
import hashlib
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from provenance import stamp_or_exit  # noqa: E402

DETECTOR = "rtmlib Wholebody(mode=balanced): yolox_m humanart + rtmw-dw-x-l"


def model():
    from rtmlib import Wholebody
    return Wholebody(mode="balanced", backend="onnxruntime", device="cpu")


def model_files():
    d = os.path.expanduser("~/.cache/rtmlib/hub/checkpoints")
    out = {}
    for f in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if f.endswith(".onnx"):
            out[f] = hashlib.md5(open(os.path.join(d, f), "rb").read()).hexdigest()
    return out


def detect(m, img):
    kp, sc = m(img)
    if not len(kp):
        return None
    i = int(np.argmax(sc[:, :17].mean(1)))
    return kp[i][:17], sc[i][:17]


def on_white(rgba):
    a = rgba[:, :, 3:4].astype(np.float32) / 255
    return (rgba[:, :, :3].astype(np.float32) * a + 255 * (1 - a)).astype(np.uint8)


ang = lambda v: math.degrees(math.atan2(v[1], v[0]))
wrap = lambda d: (d + 180) % 360 - 180


def pt(kp, ref):
    return np.mean([kp[i] for i in ref], axis=0) if isinstance(ref, list) else kp[ref]


def pose_of(kp, rest, kmap, scale, ground_y, spec_scale):
    """Channel values for one frame. kp/rest: arrays of 17 (x, y)."""
    out = {}
    for ch, e in kmap.items():  # parents before children: keypoint_map is ordered that way
        if e["kind"] == "angle":
            a = wrap(ang(pt(kp, e["to"]) - pt(kp, e["from"])) - ang(pt(rest, e["to"]) - pt(rest, e["from"])))
            out[ch] = wrap(a - out[e["parent"]]) if e.get("parent") else a
        elif e["kind"] == "length":
            r = np.linalg.norm(pt(rest, e["to"]) - pt(rest, e["from"]))
            out[ch] = float(np.clip(np.linalg.norm(pt(kp, e["to"]) - pt(kp, e["from"])) / scale / r, *e["clip"]))
        elif e["kind"] == "lift":
            hip, hip_r = pt(kp, e["hip"]), pt(rest, e["hip"])
            out[ch] = ((ground_y - hip[1]) / scale - (spec_scale["ground_y"] - hip_r[1])) / spec_scale["body_h_px"]
    return out


def torso(kp):
    return np.linalg.norm(pt(kp, [5, 6]) - pt(kp, [11, 12]))


def cmd_rest(a):
    import cv2
    spec = json.load(open(a.rig))
    m = model()
    d = detect(m, cv2.imread(a.image))
    if d is None:
        raise SystemExit("no person detected on the character image")
    spec["rest_keypoints"] = {
        "detector": DETECTOR,
        "model_md5": model_files(),
        "image_sha256": hashlib.sha256(open(a.image, "rb").read()).hexdigest(),
        "points": [[round(float(x), 3), round(float(y), 3)] for x, y in d[0]],
        "scores": [round(float(s), 3) for s in d[1]],
        "generator": stamp_or_exit(not a.no_stamp),
    }
    json.dump(spec, open(a.rig, "w"), indent=1)
    print("rest keypoints stored; mean score", round(float(d[1].mean()), 3))


def cmd_extract(a):
    import cv2
    gen = stamp_or_exit(not a.no_stamp)
    spec = json.load(open(a.rig))
    if "rest_keypoints" not in spec or "keypoint_map" not in spec:
        raise SystemExit("rig.json needs rest_keypoints (run `track.py rest`) and keypoint_map")
    rest = np.array(spec["rest_keypoints"]["points"], dtype=np.float32)
    kmap = spec["keypoint_map"]
    m = model()
    files = sorted(f for f in os.listdir(a.frames) if f.endswith(".png"))
    raw, conf = [], []
    for f in files:
        d = detect(m, on_white(cv2.imread(os.path.join(a.frames, f), cv2.IMREAD_UNCHANGED)))
        raw.append(d[0] if d else None)
        conf.append(float(d[1].mean()) if d else 0.0)
    ok = [k for k in raw if k is not None]
    if not ok:
        raise SystemExit("no person detected in any frame")
    scale = float(np.median([torso(k) for k in ok])) / torso(rest)
    ground = float(np.max([max(k[15][1], k[16][1]) for k in ok]))
    poses = [pose_of(k, rest, kmap, scale, ground, spec["scale"]) if k is not None else None for k in raw]
    lift_ch = [c for c, e in kmap.items() if e["kind"] == "lift"]
    first = next(p for p in poses if p)
    for c in lift_ch:  # clips start standing: first frame is the zero of lift
        f0 = first[c]
        for p in poses:
            if p:
                p[c] -= f0
    keys = list(first.keys())
    arr = np.array([[p[k] if p else np.nan for k in keys] for p in poses])
    for j in range(arr.shape[1]):  # fill missed frames linearly
        col = arr[:, j]
        miss = np.isnan(col)
        if miss.any():
            col[miss] = np.interp(np.flatnonzero(miss), np.flatnonzero(~miss), col[~miss])
    ker = np.array([1, 2, 3, 2, 1], float)
    ker /= ker.sum()  # light smoothing against detector jitter
    sm = np.array([np.convolve(np.pad(arr[:, j], 2, mode="edge"), ker, "valid") for j in range(arr.shape[1])]).T
    t_in = np.arange(len(sm)) / a.fps_in
    n_out = int(t_in[-1] * a.fps_out) + 1
    t_out = np.arange(n_out) / a.fps_out
    frames = [{k: round(float(np.interp(t, t_in, sm[:, j])), 3) for j, k in enumerate(keys)} for t in t_out]
    json.dump({
        "spec_version": 1, "fps": a.fps_out, "channels": keys, "frames": frames,
        "calib": {"scale_video_per_source": round(scale, 5), "ground_y_video": round(ground, 2), "lift_zero": "first frame",
                  "detect": {"frames": len(files), "missing": sum(1 for k in raw if k is None), "mean_conf": round(float(np.mean(conf)), 3)},
                  "source_frames": os.path.abspath(a.frames) if a.keep_paths else os.path.basename(os.path.normpath(a.frames)),
                  "rig_character": spec["character_id"], "model_md5": model_files()},
        "generator": gen,
    }, open(a.out, "w"), indent=0)
    print("frames in", len(files), "out", n_out, "missing", sum(1 for k in raw if k is None), "scale", round(scale, 3), "mean conf", round(float(np.mean(conf)), 3))


def cmd_migrate(a):
    gen = stamp_or_exit(not a.no_stamp)
    old = json.load(open(a.legacy))
    json.dump({"spec_version": 1, "fps": old["fps"], "channels": old["keys"], "frames": old["frames"],
               "calib": {"migrated_from": "POC track (frames copied unchanged)", "legacy_sha256": hashlib.sha256(open(a.legacy, "rb").read()).hexdigest(),
                         "detect": old.get("detect")}, "generator": gen},
              open(a.out, "w"), indent=0)
    print("migrated", len(old["frames"]), "frames")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("rest"); r.add_argument("rig"); r.add_argument("image"); r.add_argument("--no-stamp", action="store_true")
    e = sub.add_parser("extract"); e.add_argument("rig"); e.add_argument("frames"); e.add_argument("out")
    e.add_argument("--fps-in", type=float, default=24); e.add_argument("--fps-out", type=float, default=30)
    e.add_argument("--keep-paths", action="store_true"); e.add_argument("--no-stamp", action="store_true")
    g = sub.add_parser("migrate"); g.add_argument("legacy"); g.add_argument("out"); g.add_argument("--no-stamp", action="store_true")
    a = ap.parse_args()
    {"rest": cmd_rest, "extract": cmd_extract, "migrate": cmd_migrate}[a.cmd](a)


if __name__ == "__main__":
    main()
