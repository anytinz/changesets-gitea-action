# changesets-gitea-action/version

This action versions packages and creates or updates a pull request with the changes.

## Requirements

- A Gitea instance version **1.27 or newer** with [Actions enabled](https://docs.gitea.com/usage/actions/overview).
- Needs repo checked out and `@changesets/cli` installed
- [Job permissions][job-permissions]:
  - `contents: write`: to commit version changes
  - `pull-requests: write`: to create pull request
- [Workflow triggers][workflow-triggers]: _any_

## Usage

> [!TIP]
> Check out [the docs](https://changesets.dev/guide/automating#how-do-i-run-the-version-and-publish-commands) to learn how to set up the version and publish workflow.

## API

<!-- api-start -->

| Inputs              | Description                                                                                                                                                                                                                       |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gitea-token`       | The Gitea token to use for authentication. Defaults to the token provided by Gitea Actions. To use a custom token, pass it explicitly to this input.                                                                              |
| `script`            | The command to use to version packages                                                                                                                                                                                            |
| `commit-message`    | The commit message. Default to `Version Packages`                                                                                                                                                                                 |
| `pr-title`          | The pull request title. Default to `Version Packages`                                                                                                                                                                             |
| `pr-draft`          | Controls draft PR behavior. Use 'create' to create new version PRs as draft, or 'always' to also convert existing version PRs back to draft when updating them. Drafts are implemented by prefixing the PR title with `WIP: `.    |
| `pr-base-branch`    | Sets the base branch of the PR. Defaults to `gitea.ref_name`.                                                                                                                                                                    |
| `cwd`               | The working directory to execute Changesets in. Defaults to the root of the repository.                                                                                                                                           |

| Outputs     | Description                                         |
| ----------- | --------------------------------------------------- |
| `pr-number` | The pull request number that was created or updated |

<!-- api-end -->

[job-permissions]: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idpermissions
[workflow-triggers]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
