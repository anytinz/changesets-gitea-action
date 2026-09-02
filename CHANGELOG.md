# changesets-gitea-action

## 0.2.3

### Patch Changes

- [#22](https://github.com/anytinz/changesets-gitea-action/pull/22) [`566d848`](https://github.com/anytinz/changesets-gitea-action/commit/566d848df330a8ca0f0a2cdb539d1c912fef3fd6) Thanks [@anytinz](https://github.com/anytinz)! - fix: use the `/api/v1` base URL for Gitea API requests
  
  All Gitea API requests were sent to the instance URL without the `/api/v1`
  prefix, so every request hit the web frontend and failed with an unhelpful
  `Gitea API request failed with status 404`.

- [#22](https://github.com/anytinz/changesets-gitea-action/pull/22) [`566d848`](https://github.com/anytinz/changesets-gitea-action/commit/566d848df330a8ca0f0a2cdb539d1c912fef3fd6) Thanks [@anytinz](https://github.com/anytinz)! - fix: report the request method, URL, status and response body when Gitea API requests fail
  
  Previously a failed Gitea API request only produced
  `Gitea API request failed with status 404`, which made it impossible to tell
  which request failed and why. The error now includes the HTTP method, the
  full request URL, the response status and the response body (the `message`
  field of JSON error bodies, or a truncated raw body).

- [#22](https://github.com/anytinz/changesets-gitea-action/pull/22) [`566d848`](https://github.com/anytinz/changesets-gitea-action/commit/566d848df330a8ca0f0a2cdb539d1c912fef3fd6) Thanks [@anytinz](https://github.com/anytinz)! - fix: only match open pull requests when finding the existing version PR
  
  Gitea's `/pulls/{base}/{head}` endpoint matches pull requests in any state
  and does not guarantee which one is returned when several match. The action
  could therefore find a closed or merged release PR and reopen it instead of
  creating a fresh one. Open pull requests are now listed and filtered by
  their base and head branches.

- [#22](https://github.com/anytinz/changesets-gitea-action/pull/22) [`566d848`](https://github.com/anytinz/changesets-gitea-action/commit/566d848df330a8ca0f0a2cdb539d1c912fef3fd6) Thanks [@anytinz](https://github.com/anytinz)! - fix: skip non-regular files when pushing changes via the contents API
  
  `git ls-files --others --exclude-standard` can list directory symlinks (e.g.
  `node_modules/@changesets/cli` created by bun installs). Reading them as
  files crashed the action with `EISDIR: illegal operation on a directory`.
  Non-regular files are now skipped with a warning.

## 0.2.2

### Patch Changes

- [#17](https://github.com/anytinz/changesets-gitea-action/pull/17) [`373b370`](https://github.com/anytinz/changesets-gitea-action/commit/373b370c81d36b84e1a0e7513a9429bc98a2de3c) Thanks [@anytinz](https://github.com/anytinz)! - build: bundle all deps

## 0.2.1

### Patch Changes

- [#13](https://github.com/anytinz/changesets-gitea-action/pull/13) [`9de4c6f`](https://github.com/anytinz/changesets-gitea-action/commit/9de4c6fbc9d6a675b59e7ce890558761f88faca7) Thanks [@anytinz](https://github.com/anytinz)! - fix: update dist

## 0.2.0

### Minor Changes

- [#10](https://github.com/anytinz/changesets-gitea-action/pull/10) [`d62eb39`](https://github.com/anytinz/changesets-gitea-action/commit/d62eb396fd200668fa6cf9470d513bf26a79ce4a) Thanks [@anytinz](https://github.com/anytinz)! - build: remove unused tsconfig options and update tsdown config for better output management

### Patch Changes

- [#10](https://github.com/anytinz/changesets-gitea-action/pull/10) [`d62eb39`](https://github.com/anytinz/changesets-gitea-action/commit/d62eb396fd200668fa6cf9470d513bf26a79ce4a) Thanks [@anytinz](https://github.com/anytinz)! - fix: remove `dist` in `.gitignore` to include artifacts

## 0.1.1

### Patch Changes

- [#3](https://github.com/anytinz/changesets-gitea-action/pull/3) [`512cfef`](https://github.com/anytinz/changesets-gitea-action/commit/512cfefccf2460d52d1f7b5eddf33b4f471e42f2) Thanks [@anytinz](https://github.com/anytinz)! - Fix CI: drop explicit resource management (`AsyncDisposableStack`/`await using`) so tests pass on Node 22 without flags, and fix lint/type-check errors
