---
"changesets-gitea-action": patch
---

fix: skip non-regular files when pushing changes via the contents API

`git ls-files --others --exclude-standard` can list directory symlinks (e.g.
`node_modules/@changesets/cli` created by bun installs). Reading them as
files crashed the action with `EISDIR: illegal operation on a directory`.
Non-regular files are now skipped with a warning.
