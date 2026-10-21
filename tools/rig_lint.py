"""Lint a rig spec v1 (rig.json) and, optionally, its part images.

usage: rig_lint.py <rig.json> [--assets <dir>]
exit 0 = clean, 1 = problems found (each printed on its own line).

Checks: spec version; every channel/part/mesh/group/draw reference resolves; every moving part hangs on a joint with a
pivot and is drawn under that joint; joint parents exist and form no cycles; pivots and part boxes lie inside the image;
mirrored joints sit at mirrored x with equal y (within 1 px); asset files exist and match their box size.
"""
import argparse
import json
import os
import sys


def walk(nodes, joints=()):
    for n in nodes:
        yield n, joints
        if "joint" in n:
            yield from walk(n["children"], joints + (n["joint"],))


def lint(spec, assets=None):
    errs = []
    if spec.get("spec_version") != 1:
        errs.append(f"spec_version {spec.get('spec_version')} is not 1")
    W, H = spec["coord_space"]["size"]
    J, C, caps, groups = spec["joints"], spec["channels"], spec.get("caps", {}), spec.get("groups", {})
    parts = {p["id"]: p for p in spec["parts"]}
    mesh = spec.get("mesh", {})
    for k, j in J.items():
        x, y = j["pivot"]
        if not (0 <= x <= W and 0 <= y <= H):
            errs.append(f"joint {k}: pivot {j['pivot']} outside image {W}x{H}")
        if j.get("parent") is not None and j["parent"] not in J:
            errs.append(f"joint {k}: parent {j['parent']} missing")
        seen, cur = set(), k
        while cur is not None and cur in J:
            if cur in seen:
                errs.append(f"joint {k}: parent cycle")
                break
            seen.add(cur)
            cur = J[cur].get("parent")
        m = j.get("mirror_of")
        if m:
            if m not in J:
                errs.append(f"joint {k}: mirror_of {m} missing")
            else:
                mx, my = J[m]["pivot"]
                if abs((W - mx) - x) > 1 or abs(my - y) > 1:
                    errs.append(f"joint {k}: not a mirror of {m} ({j['pivot']} vs mirrored {[W - mx, my]})")
    for k, c in C.items():
        if c["kind"] in ("rotate", "scaleY") and c.get("joint") not in J:
            errs.append(f"channel {k}: joint {c.get('joint')} missing")
    for p in spec["parts"]:
        x0, y0, x1, y1 = p["bbox"]
        if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
            errs.append(f"part {p['id']}: bbox {p['bbox']} outside image or empty")
        if p["joint"] is not None and p["joint"] not in J:
            errs.append(f"part {p['id']}: joint {p['joint']} missing")
        if assets:
            f = os.path.join(assets, p["asset"])
            if not os.path.exists(f):
                errs.append(f"part {p['id']}: asset {p['asset']} missing")
            else:
                from PIL import Image
                sz = Image.open(f).size
                if list(sz) != [x1 - x0, y1 - y0]:
                    errs.append(f"part {p['id']}: asset is {sz[0]}x{sz[1]}, bbox says {x1 - x0}x{y1 - y0}")
    for k, m in mesh.items():
        if m["part"] not in parts:
            errs.append(f"mesh {k}: part {m['part']} missing")
        for b in m["bones"]:
            if b not in J:
                errs.append(f"mesh {k}: bone {b} missing")

    def check(nodes, where):
        for n, joints in walk(nodes):
            if "part" in n:
                p = parts.get(n["part"])
                if not p:
                    errs.append(f"{where}: part {n['part']} missing")
                elif p["joint"] is not None and (not joints or joints[-1] != p["joint"]):
                    errs.append(f"{where}: part {n['part']} drawn under {joints[-1] if joints else 'root'}, declared on {p['joint']}")
            elif "cap" in n and n["cap"] not in caps:
                errs.append(f"{where}: cap {n['cap']} missing")
            elif "joint" in n and n["joint"] not in J:
                errs.append(f"{where}: joint {n['joint']} missing")
            elif "slot" in n and n["slot"] not in groups:
                errs.append(f"{where}: group {n['slot']} missing")
            elif "mesh" in n:
                errs.extend(f"{where}: mesh {m} missing" for m in n["mesh"] if m not in mesh)

    for k, g in groups.items():
        if g["front_when"]["channel"] not in C:
            errs.append(f"group {k}: channel {g['front_when']['channel']} missing")
        check(g["children"], f"group {k}")
    for k, v in spec["variants"].items():
        check(v["draw"], f"variant {k}")
    return errs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("rig")
    ap.add_argument("--assets")
    a = ap.parse_args()
    errs = lint(json.load(open(a.rig)), a.assets)
    for e in errs:
        print("LINT", e)
    print(f"{len(errs)} problems")
    sys.exit(1 if errs else 0)


if __name__ == "__main__":
    main()
