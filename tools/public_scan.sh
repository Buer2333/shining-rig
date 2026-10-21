#!/usr/bin/env bash
# public_scan.sh [<range>] — run before every push of this public repo. Exit 1 on any finding.
# Default range: everything not yet on origin (whole history when there is no origin yet).
# Scans every commit in the range: author/committer emails (must be noreply), added lines (local paths, hostnames,
# emails, key/token shapes, long base64 runs) and every object (non-text blobs outside the allow-list, blobs > 1 MB).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
if [ -n "${1:-}" ]; then RANGE="$1"
elif git rev-parse --verify -q origin/main >/dev/null; then RANGE="origin/main..HEAD"
else RANGE="HEAD"; fi
FIND=0
hit() { echo "FINDING $*"; FIND=$((FIND+1)); }

echo "scan range: ${RANGE} ($(git rev-list --count ${RANGE}) commits)"

while read -r sha ae ce; do
  for e in "$ae" "$ce"; do case "$e" in *@users.noreply.github.com|noreply@anthropic.com) ;; *) hit "commit ${sha}: email ${e}";; esac; done
done < <(git log --format='%h %ae %ce' ${RANGE})
while read -r line; do
  case "$line" in *noreply@anthropic.com*|*users.noreply.github.com*) ;; *) hit "trailer email: ${line}";; esac
done < <(git log --format='%B' ${RANGE} | grep -E '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}' || true)

PATTERNS='(/Users/|/home/[a-z]|C:\\Users|\.local\b|\b(sk|pk|rk)-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_|AKIA[0-9A-Z]{16}|xox[abpr]-|-----BEGIN [A-Z ]*PRIVATE KEY|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.(com|net|org|io|cn)\b|[A-Za-z0-9+/]{200,}={0,2})'
while IFS= read -r l; do
  case "$l" in *noreply*|*example.com*) continue;; esac
  hit "added line: ${l:0:160}"
done < <(git log -p --format='' ${RANGE} -- . ':!tools/public_scan.sh' | grep -E '^\+' | grep -v -E '^\+\+\+ ' | grep -E "${PATTERNS}" || true)  # the scanner's own pattern list would match itself; it is still covered by the object checks below

ALLOW='\.(ts|tsx|json|md|py|txt|lock|sh|yml|yaml)$|(^|/)(LICENSE|\.gitignore|package-lock\.json)$'
while read -r obj path; do
  [ -z "${path}" ] && continue
  [ "$(git cat-file -t "${obj}")" = "blob" ] || continue
  size=$(git cat-file -s "${obj}")
  [ "${size}" -gt 1048576 ] && hit "large object ${path} (${size} bytes)"
  if ! echo "${path}" | grep -q -E "${ALLOW}"; then hit "file type not allowed: ${path}"; fi
  nonul=$(git cat-file -p "${obj}" | LC_ALL=C tr -d '\000' | wc -c | tr -d ' ')
  [ "${nonul}" != "${size}" ] && hit "binary content (NUL bytes): ${path}"
done < <(git rev-list --objects ${RANGE} | awk 'NF==2')

echo "${FIND} findings"
[ "${FIND}" = 0 ]
