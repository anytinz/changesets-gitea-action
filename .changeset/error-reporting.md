---
"changesets-gitea-action": patch
---

fix: report the request method, URL, status and response body when Gitea API requests fail

Previously a failed Gitea API request only produced
`Gitea API request failed with status 404`, which made it impossible to tell
which request failed and why. The error now includes the HTTP method, the
full request URL, the response status and the response body (the `message`
field of JSON error bodies, or a truncated raw body).
