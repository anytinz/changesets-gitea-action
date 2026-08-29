# changesets-gitea-action/pr-status

This action generates a comment body presenting the changesets status of a pull request. Combine it with [changesets-gitea-action/pr-comment](../pr-comment/README.md) to post the body as a comment on the pull request.

## Requirements

- A Gitea instance version **1.27 or newer** with [Actions enabled](https://docs.gitea.com/usage/actions/overview).
- Needs repo checked out and `@changesets/cli` installed
- [Workflow triggers][workflow-triggers]: `pull_request` or `pull_request_target`

## Usage

> [!TIP]
> Check out [the docs](https://changesets.dev/guide/automating#how-do-i-run-the-version-and-publish-commands) to learn how to set up the version and publish workflow.

## API

<!-- api-start -->

| Outputs        | Description                                                     |
| -------------- | --------------------------------------------------------------- |
| `comment-body` | The generated comment body to present the changesets status in PRs. |

<!-- api-end -->

[workflow-triggers]: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows
