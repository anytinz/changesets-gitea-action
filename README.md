# Changesets Gitea Action

This repo contains a collection of [Gitea Actions](https://docs.gitea.com/usage/actions) for
[Changesets](https://changesets.dev). It is a port of the official
[`changesets/action`](https://github.com/changesets/action) that replaces all GitHub API
interactions with the [Gitea API](https://docs.gitea.com/development/api-usage). The client is
generated at install time from the Gitea **1.27** OpenAPI spec
(`https://docs.gitea.com/openapi3-27.json`) using
[`openapi-typescript`](https://openapi-ts.dev) and [`openapi-fetch`](https://openapi-ts.dev/openapi-fetch).
Check out the [Automating Changesets](https://changesets.dev/guide/automating) guide to learn how
to use these actions to automate your workflow.

- [changesets-gitea-action](./README.md): (This README. See below for details.)
- [changesets-gitea-action/select-mode](./select-mode/README.md): Select the mode to run a Changesets workflow.
- [changesets-gitea-action/version](./version/README.md): Version packages and create or update a pull request with the changes.
- [changesets-gitea-action/pack](./pack/README.md): Pack publishable packages into tarballs.
- [changesets-gitea-action/publish](./publish/README.md): Publish packages to npm.
- [changesets-gitea-action/pr-status](./pr-status/README.md): Generate changeset status in PRs.
- [changesets-gitea-action/pr-comment](./pr-comment/README.md): Create or update comments on PRs.

## changesets-gitea-action

This action handles versioning and publishing of packages. It's the equivalent of setting up the
`changesets-gitea-action/select-mode`, `changesets-gitea-action/version`, and
`changesets-gitea-action/publish` actions in a workflow, but with the required permissions
combined.

### Requirements

- A Gitea instance version **1.27 or newer** with [Actions enabled](https://docs.gitea.com/usage/actions/overview).
- Needs repo checked out and `@changesets/cli` installed
- The instance URL is read from the `GITHUB_SERVER_URL` environment variable,
  which Gitea Actions sets automatically (see the
  [documented variables](https://docs.gitea.com/usage/actions/actions-variables)).
- A token with `write` permissions for the repository. Gitea provides a
  built-in job token automatically, available as `${{ gitea.token }}` (or
  `${{ secrets.GITEA_TOKEN }}`), see
  [Actions job token permissions](https://docs.gitea.com/usage/actions/token-permissions).
- [Job permissions][job-permissions]:
  - `contents: write`: to commit version changes
  - `pull-requests: write`: to create pull request
- [Workflow triggers][workflow-triggers]: _any_

### Usage

> [!TIP]
> Check out [the docs](https://changesets.dev/guide/automating#how-do-i-run-the-version-and-publish-commands)
> to learn how to set up the version and publish workflow.

> [!IMPORTANT]
> To use a custom Gitea token, pass it explicitly through the `gitea-token` input:
>
> ```yaml
> with:
>   gitea-token: ${{ secrets.CUSTOM_GITEA_TOKEN }}
> ```
>
> By default the action uses the built-in job token (`${{ gitea.token }}`).
> Setting a `GITEA_TOKEN` environment variable on the job does not configure
> the action.

```yaml
name: Release

on:
  push:
    branches:
      - main

permissions:
  contents: write
  pull-requests: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup pnpm and Node.js
        uses: pnpm/action-setup@v4

      - name: Create release PR or publish
        uses: anytinz/changesets-gitea-action@main
        with:
          publish-script: pnpm changeset publish
```

### API

<!-- api-start -->

| Inputs                   | Description                                                                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitea-token`            | The Gitea token to use for authentication. Defaults to the token provided by Gitea Actions. To use a custom token, pass it explicitly to this input.                                                                                                       |
| `publish-script`         | The command to use to build and publish packages                                                                                                                                                                                                           |
| `version-script`         | The command to update version, edit CHANGELOG, read and delete changesets. Default to `changeset version` if not provided                                                                                                                                  |
| `commit-message`         | The commit message. Default to `Version Packages`                                                                                                                                                                                                          |
| `pr-title`               | The pull request title. Default to `Version Packages`                                                                                                                                                                                                      |
| `pr-draft`               | Controls draft PR behavior. Use 'create' to create new version PRs as draft, or 'always' to also convert existing version PRs back to draft when updating them. Drafts are implemented by prefixing the PR title with `WIP: `.                            |
| `pr-base-branch`         | Sets the base branch of the PR. Defaults to `gitea.ref_name`.                                                                                                                                                                                             |
| `create-gitea-releases`  | Whether to create Gitea releases after publish                                                                                                                                                                                                             |
| `push-git-tags`          | Whether to create git tags after publish. If `create-gitea-releases` is set to `true`, this option will also always be `true`.                                                                                                                             |
| `cwd`                    | The working directory to execute Changesets in. Defaults to the root of the repository.                                                                                                                                                                    |

| Outputs              | Description                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `published`          | A "true" or "false" string value to indicate whether a publishing is happened or not                                                             |
| `published-packages` | A JSON array to present the published packages. The format is `[{"name": "@xx/xx", "version": "1.2.0"}, {"name": "@xx/xy", "version": "0.8.9"}]` |
| `has-changesets`     | A "true" or "false" string value about whether there were changesets. Useful if you want to create your own publishing functionality.            |
| `pr-number`          | The pull request number that was created or updated                                                                                              |

<!-- api-end -->

[job-permissions]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions
[workflow-triggers]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
