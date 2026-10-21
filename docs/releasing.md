# Releasing and syncing

1. Change the library on a local **candidate commit** (no tag, no push).
2. Sync that sha into the consuming project (read-only copy of `src/`, with a `VERSION` file holding
   `candidate <sha>`), regenerate any artifacts with the tools at that sha, run the project's parity and regression checks.
3. Only then request a release: run the public scan (whole push range, every non-text object), tag **the same sha**,
   push the tag and the branch.
4. Re-sync from the tag (`VERSION` becomes `<tag> <sha>`; the sha must not change) and record `tag → sha` in the
   project's version ledger. Artifacts generated at the candidate keep their candidate stamp.

Rules: tags are never moved or recreated. The sync refuses a dirty or mismatched library checkout, never touches
unrelated files in the target project, and stops if the vendored copy differs from the archive of the sha it was
last synced from (someone edited it by hand).
