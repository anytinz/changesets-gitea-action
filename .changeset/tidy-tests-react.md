---
"changesets-gitea-action": patch
---

Fix CI: drop explicit resource management (`AsyncDisposableStack`/`await using`) so tests pass on Node 22 without flags, and fix lint/type-check errors
