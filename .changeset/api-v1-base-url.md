---
"changesets-gitea-action": patch
---

fix: use the `/api/v1` base URL for Gitea API requests

All Gitea API requests were sent to the instance URL without the `/api/v1`
prefix, so every request hit the web frontend and failed with an unhelpful
`Gitea API request failed with status 404`.
