"""Migrate a legacy POC rig.json ({size, joints, parts, caps, mesh}) to rig spec v1 using a character config's rig template.

usage: spec_migrate.py <legacy rig.json> <config.json> <out rig.json> [--diff <cut-produced rig.json>]

--diff compares every coordinate field (joint pivots, part boxes, caps, scale, size) of the migrated spec against a spec
produced by cut.py and exits 1 on any difference: proof that re-cutting with the library reproduces the legacy rig.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cut import build_spec  # noqa: E402


def migrate(legacy, cfg):
    scale = dict(cfg["cut"]["scale"]) if "scale" in cfg["cut"] else None
    if scale is None:
        raise SystemExit("legacy rigs carry no measured scale: put cut.scale in the config")
    spec = build_spec(cfg, legacy["size"], scale, legacy["joints"], legacy["parts"], legacy.get("caps", {}), "migrated-from-legacy", None)
    if "mesh" in legacy and "mesh" in spec:  # legacy kept one pair of left-limb bands; check they agree with the template
        for lid, limb in spec["mesh"].items():
            if limb["root"] != legacy["mesh"]["root"] or limb["elbow"] != legacy["mesh"]["elbow"]:
                raise SystemExit(f"mesh bands of {lid} differ from legacy: {limb} vs {legacy['mesh']}")
    return spec


def coord_diff(a, b):
    out = []
    if a["coord_space"]["size"] != b["coord_space"]["size"]:
        out.append(f"size {a['coord_space']['size']} != {b['coord_space']['size']}")
    for k in ("body_h_px", "ground_y"):
        if a["scale"][k] != b["scale"][k]:
            out.append(f"scale.{k} {a['scale'][k]} != {b['scale'][k]}")
    if list(a["joints"]) != list(b["joints"]):
        out.append(f"joint order {list(a['joints'])} != {list(b['joints'])}")
    for k in a["joints"]:
        if a["joints"][k]["pivot"] != b["joints"].get(k, {}).get("pivot"):
            out.append(f"joint {k} {a['joints'][k]['pivot']} != {b['joints'].get(k, {}).get('pivot')}")
    pa, pb = {p["id"]: p["bbox"] for p in a["parts"]}, {p["id"]: p["bbox"] for p in b["parts"]}
    if list(pa) != list(pb):
        out.append(f"part order {list(pa)} != {list(pb)}")
    for k in pa:
        if pa[k] != pb.get(k):
            out.append(f"part {k} {pa[k]} != {pb.get(k)}")
    if a["caps"] != b["caps"]:
        out.append(f"caps {a['caps']} != {b['caps']}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("legacy")
    ap.add_argument("config")
    ap.add_argument("out")
    ap.add_argument("--diff")
    a = ap.parse_args()
    spec = migrate(json.load(open(a.legacy)), json.load(open(a.config)))
    json.dump(spec, open(a.out, "w"), indent=1)
    if a.diff:
        d = coord_diff(spec, json.load(open(a.diff)))
        for line in d:
            print("DIFF", line)
        print(f"{len(d)} coordinate differences")
        sys.exit(1 if d else 0)


if __name__ == "__main__":
    main()
