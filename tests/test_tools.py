"""Tool tests on synthetic characters (no character art): cut, lint, spec_migrate, provenance, track math."""
import copy
import json
import os
import subprocess
import sys

import numpy as np
import pytest
from PIL import Image, ImageDraw

TOOLS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "tools")
sys.path.insert(0, TOOLS)
import cut as C  # noqa: E402
import provenance  # noqa: E402
import rig_lint  # noqa: E402
import spec_migrate  # noqa: E402
import track  # noqa: E402

PY = sys.executable
INK, SKIN, SHIRT = (20, 12, 10), (240, 190, 160), (236, 234, 235)


def toy_image(path, W, H):
    """A front-view stick figure on white, outlined like cartoon art: arms out horizontally, legs apart.
    Geometry is defined on a 512x768 grid and scaled, so two sizes share one config (display_width = 512)."""
    s = W / 512
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    S = lambda *v: [x * s for x in v]
    w = max(2, int(4 * s))
    d.ellipse(S(196, 40, 316, 190), fill=SKIN, outline=INK, width=w)            # head
    d.rectangle(S(206, 190, 306, 450), fill=SHIRT, outline=INK, width=w)        # torso
    d.rectangle(S(120, 236, 206, 276), fill=SHIRT, outline=INK, width=w)        # left sleeve
    d.rectangle(S(40, 242, 122, 270), fill=SKIN, outline=INK, width=w)          # left forearm
    d.rectangle(S(306, 236, 392, 276), fill=SHIRT, outline=INK, width=w)        # right sleeve
    d.rectangle(S(390, 242, 472, 270), fill=SKIN, outline=INK, width=w)         # right forearm
    d.rectangle(S(212, 450, 252, 740), fill=(40, 50, 90), outline=INK, width=w)  # left leg
    d.rectangle(S(260, 450, 300, 740), fill=(40, 50, 90), outline=INK, width=w)  # right leg
    im.save(path)


def toy_config(src, flat=True, protect=True):
    return {
        "character_id": "toy",
        "source": src,
        "cut": {
            "display_width": 512,
            "background": {"seeds": [[0, 0], ["W-1", 0], [0, "H-1"], ["W-1", "H-1"]], "thresh": 38},
            "erode_px": 1,
            "polygons": {
                "head": [[180, 30], [332, 30], [332, 188], [180, 188]],
                "torso": [[200, 186], [312, 186], [312, 455], [200, 455]],
                "armL": [[118, 230], [206, 230], [206, 282], [118, 282]],
                "foreL": [[34, 236], [121, 236], [121, 276], [34, 276]],
                "legL": [[206, 452], [256, 452], [256, 748], [206, 748]],
            },
            "mirror_parts": [["armR", "armL"], ["foreR", "foreL"], ["legR", "legL"]],
            "joints": {"neck": [256, 188], "shoulderL": [206, 256], "elbowL": [122, 256], "hipL": [232, 452]},
            "mirror_joints": ["shoulder", "elbow", "hip"],
            "protect_regions": [{"id": "chest-logo", "method": "red_bbox", "window": [200, 190, 312, 450], "r_gt": 170, "g_lt": 90, "pad": 4, "enabled": protect}],
            "ball_joints": {
                "armL": {"joint": "shoulderL", "radius": 20, "cap_part": "capL", "outward": "left", "flat_fill": {"enabled": flat, "dx": 30}},
                "armR": {"joint": "shoulderR", "radius": 20, "cap_part": "capR", "outward": "right", "flat_fill": {"enabled": flat, "dx": -30}},
            },
            "caps": {"elbowL": {"joint": "elbowL", "r": 12, "sample": [100, 256]}},
        },
        "rig": {
            "rig_type": "cutout",
            "joint_parents": {"elbowL": "shoulderL", "elbowR": "shoulderR"},
            "channels": {
                "armL": {"kind": "rotate", "joint": "shoulderL", "default": 0}, "foreL": {"kind": "rotate", "joint": "elbowL", "default": 0},
                "armR": {"kind": "rotate", "joint": "shoulderR", "default": 0}, "foreR": {"kind": "rotate", "joint": "elbowR", "default": 0},
                "legL": {"kind": "rotate", "joint": "hipL", "default": 0}, "legR": {"kind": "rotate", "joint": "hipR", "default": 0},
                "head": {"kind": "rotate", "joint": "neck", "default": 0}, "lift": {"kind": "body_translate", "default": 0},
            },
            "part_joints": {"head": "neck", "torso": None, "capL": None, "armL": "shoulderL", "foreL": "elbowL", "legL": "hipL",
                            "capR": None, "armR": "shoulderR", "foreR": "elbowR", "legR": "hipR"},
            "groups": {},
            "variants": {"cutout": {"draw": [
                {"joint": "hipL", "children": [{"part": "legL"}]}, {"joint": "hipR", "children": [{"part": "legR"}]},
                {"part": "torso"}, {"part": "capL"}, {"part": "capR"},
                {"joint": "shoulderL", "children": [{"joint": "elbowL", "children": [{"cap": "elbowL"}, {"part": "foreL"}]}, {"part": "armL"}]},
                {"joint": "shoulderR", "children": [{"joint": "elbowR", "children": [{"part": "foreR"}]}, {"part": "armR"}]},
                {"joint": "neck", "children": [{"part": "head"}]},
            ]}},
        },
    }


@pytest.fixture(params=[(512, 768), (2048, 3072)], ids=["512x768", "2048x3072"])
def toy(tmp_path, request):
    W, H = request.param
    toy_image(tmp_path / "toy.png", W, H)
    return tmp_path, W, H


@pytest.mark.parametrize("flat,protect", [(True, True), (False, False)])
def test_cut_two_sizes_and_switches(toy, flat, protect):
    d, W, H = toy
    spec = C.cut(toy_config("toy.png", flat, protect), str(d), str(d / "out"), stamp=False)
    K = W / 512
    assert spec["coord_space"]["size"] == [W, H]
    assert spec["joints"]["shoulderL"]["pivot"] == [round(206 * K, 1), round(256 * K, 1)]
    assert spec["joints"]["shoulderR"]["mirror_of"] == "shoulderL"
    ids = [p["id"] for p in spec["parts"]]
    assert ids == ["head", "torso", "capL", "armL", "foreL", "legL", "capR", "armR", "foreR", "legR"]
    for p in spec["parts"]:  # each image matches its box; boxes sit inside the polygon (scaled)
        assert Image.open(d / "out" / p["asset"]).size == (p["bbox"][2] - p["bbox"][0], p["bbox"][3] - p["bbox"][1])
    fore = next(p for p in spec["parts"] if p["id"] == "foreL")["bbox"]
    assert fore[0] >= 34 * K - 1 and fore[2] <= 121 * K + 1
    assert spec["scale"]["source"].startswith("measured")  # no manual scale in config -> measured from alpha
    assert abs(spec["scale"]["ground_y"] - 740 * K) <= 3 * K
    assert spec["generator"] == "unstamped"
    assert rig_lint.lint(spec, str(d / "out")) == []


def run(*args):
    return subprocess.run([PY, *args], capture_output=True, text=True)


def test_lint_rejects_bad_and_accepts_good(tmp_path):
    toy_image(tmp_path / "toy.png", 512, 768)
    good = C.cut(toy_config("toy.png"), str(tmp_path), str(tmp_path / "out"), stamp=False)
    cases = {}
    b = copy.deepcopy(good); b["channels"]["foreL"]["joint"] = "wristL"; cases["channel-missing-joint"] = b
    b = copy.deepcopy(good); b["joints"]["shoulderR"]["pivot"][0] += 9; cases["mirror-mismatch"] = b
    b = copy.deepcopy(good); b["variants"]["cutout"]["draw"].append({"part": "foreR"}); cases["part-under-wrong-joint"] = b
    b = copy.deepcopy(good); b["joints"]["shoulderL"]["parent"] = "elbowL"; cases["parent-cycle"] = b
    b = copy.deepcopy(good); b["parts"][0]["bbox"] = [0, 0, 600, 10]; cases["bbox-outside"] = b
    for name, spec in {**cases, "good": good}.items():
        f = tmp_path / f"{name}.json"
        f.write_text(json.dumps(spec))
        r = run(os.path.join(TOOLS, "rig_lint.py"), str(f))
        assert (r.returncode == 0) == (name == "good"), (name, r.stdout)


def test_migrate_diff_catches_changes(tmp_path):
    toy_image(tmp_path / "toy.png", 512, 768)
    cfg = toy_config("toy.png")
    cfg["cut"]["scale"] = {"body_h_px": 700, "ground_y": 740, "source": "manual"}
    spec = C.cut(cfg, str(tmp_path), str(tmp_path / "out"), stamp=False)
    legacy = {"size": spec["coord_space"]["size"], "joints": {k: v["pivot"] for k, v in spec["joints"].items()},
              "parts": {p["id"]: p["bbox"] for p in spec["parts"]}, "caps": spec["caps"]}
    assert spec_migrate.coord_diff(spec_migrate.migrate(legacy, cfg), spec) == []
    legacy["parts"]["armL"] = [legacy["parts"]["armL"][0] + 1] + legacy["parts"]["armL"][1:]
    assert any("part armL" in x for x in spec_migrate.coord_diff(spec_migrate.migrate(legacy, cfg), spec))


def test_provenance_rules(tmp_path, monkeypatch):
    repo = tmp_path / "r"
    repo.mkdir()
    g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], check=True, capture_output=True, text=True).stdout.strip()
    g("init", "-q"); g("config", "user.email", "t@example.com"); g("config", "user.name", "t")
    (repo / "a").write_text("1"); g("add", "a"); g("commit", "-qm", "c")
    monkeypatch.setattr(provenance, "REPO", str(repo))
    sha = g("rev-parse", "HEAD")
    assert provenance.generator() == f"shining-rig@candidate+{sha}"
    g("tag", "v9.9.9")
    assert provenance.generator() == f"shining-rig@v9.9.9+{sha}"
    (repo / "a").write_text("2")
    with pytest.raises(provenance.DirtyRepo):
        provenance.generator()
    assert provenance.generator(stamp=False) == "unstamped"


def test_track_angles_from_keypoints():
    rest = np.zeros((17, 2), np.float32)
    rest[[5, 6]] = [[300, 200], [200, 200]]  # shoulders (viewer right, left)
    rest[[11, 12]] = [[280, 400], [220, 400]]  # hips
    rest[8], rest[10] = [140, 200], [80, 200]  # left elbow, wrist: arm straight out to the viewer's left
    rest[0] = [250, 120]
    kmap = {"armL": {"kind": "angle", "from": 6, "to": 8}, "foreL": {"kind": "angle", "from": 8, "to": 10, "parent": "armL"},
            "head": {"kind": "angle", "from": [5, 6], "to": 0}, "lift": {"kind": "lift", "hip": [11, 12]}}
    kp = rest.copy()
    rot = lambda p, c, deg: c + np.array([[np.cos(np.radians(deg)), -np.sin(np.radians(deg))], [np.sin(np.radians(deg)), np.cos(np.radians(deg))]]) @ (p - c)
    kp[8] = rot(rest[8], rest[6], 30)      # upper arm down by 30 (clockwise on screen)
    kp[10] = rot(rot(rest[10], rest[8], 20), rest[6], 30)  # forearm bent 20 more, carried by the upper arm
    p = track.pose_of(kp, rest, kmap, 1.0, 400.0, {"ground_y": 400.0, "body_h_px": 300.0})
    assert p["armL"] == pytest.approx(30, abs=1e-3)
    assert p["foreL"] == pytest.approx(20, abs=1e-3)  # relative to the parent bone, not absolute 50
    assert p["head"] == pytest.approx(0, abs=1e-6)
    assert p["lift"] == pytest.approx(0, abs=1e-6)
    kp2 = kp.copy(); kp2[[11, 12]] -= [0, 30]  # hips 30 px higher at scale 1 -> lift = 30 / body_h
    assert track.pose_of(kp2, rest, kmap, 1.0, 400.0, {"ground_y": 400.0, "body_h_px": 300.0})["lift"] == pytest.approx(0.1)
