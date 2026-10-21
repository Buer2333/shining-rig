"""Generator stamp for every artifact the tools write.

Rules: the shining-rig checkout running the tool must be clean; HEAD exactly on a tag -> "shining-rig@<tag>+<sha>",
otherwise "shining-rig@candidate+<sha>". A candidate stamp is never rewritten later; releases bind tag -> sha
in the consuming project's version ledger instead. Tests pass stamp=False and get "unstamped" (not deliverable).
"""
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class DirtyRepo(RuntimeError):
    pass


def _git(*args):
    return subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True)


def generator(stamp=True):
    if not stamp:
        return "unstamped"
    st = _git("status", "--porcelain")
    if st.returncode != 0:
        raise DirtyRepo(f"not a git checkout: {REPO}")
    if st.stdout.strip():
        raise DirtyRepo("shining-rig working tree is dirty; commit or stash before generating artifacts:\n" + st.stdout)
    sha = _git("rev-parse", "HEAD").stdout.strip()
    tag = _git("describe", "--exact-match", "--tags", "HEAD")
    return f"shining-rig@{tag.stdout.strip()}+{sha}" if tag.returncode == 0 else f"shining-rig@candidate+{sha}"


def stamp_or_exit(stamp=True):
    try:
        return generator(stamp)
    except DirtyRepo as e:
        print(f"refusing to run: {e}", file=sys.stderr)
        sys.exit(2)
