---
"changesets-gitea-action": patch
---

fix: only match open pull requests when finding the existing version PR

Gitea's `/pulls/{base}/{head}` endpoint matches pull requests in any state
and does not guarantee which one is returned when several match. The action
could therefore find a closed or merged release PR and reopen it instead of
creating a fresh one. Open pull requests are now listed and filtered by
their base and head branches.
