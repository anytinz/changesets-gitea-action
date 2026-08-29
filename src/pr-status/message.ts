import { getReleasePlan } from '@changesets/get-release-plan'
import { markdownTable } from 'markdown-table'
import { getNewChangesetTemplateContent, getNewChangesetUrl } from '@/pr-status/template'
import { withPullRequestWorktree } from '@/pr-status/worktree'
import type { ComprehensiveRelease, ReleasePlan, VersionType } from '@changesets/types'
import type { PullRequestContext } from '@/pr-context'

const getReleasePlanMessage = (releasePlan: ReleasePlan): string => {
  const publishableReleases = releasePlan.releases.filter(
    (r) => r.type !== 'none',
  ) as (ComprehensiveRelease & { type: Exclude<VersionType, 'none'> })[]

  const table = markdownTable([
    ['Name', 'Type'],
    ...publishableReleases.map((release) => [
      release.name,
      {
        major: 'Major',
        minor: 'Minor',
        patch: 'Patch',
      }[release.type],
    ]),
  ])

  let summary = 'This PR includes '
  if (releasePlan.changesets.length === 0) {
    summary += 'no changesets'
  } else {
    summary += `changesets to release ${publishableReleases.length} package`
    if (publishableReleases.length !== 1) {
      summary += 's'
    }
  }

  return `\
<details>
<summary>${summary}</summary>

${
  publishableReleases.length > 0
    ? table
    : "When changesets are added to this PR, you'll see the packages that this PR includes changesets for and the associated semver types"
}

</details>`
}

const getApproveMessage = (
  commitSha: string,
  newChangesetUrl: string,
  releasePlan: ReleasePlan,
): string => `\
### 🦋 Changeset detected

Latest commit: ${commitSha}

**The changes in this PR will be included in the next version bump.**

${getReleasePlanMessage(releasePlan)}

Not sure what this means? [Click here to learn what changesets are](https://changesets.dev/faq).

[Click here if you're a maintainer who wants to add another changeset to this PR](${newChangesetUrl})`

const getAbsentMessage = (
  commitSha: string,
  newChangesetUrl: string,
  releasePlan: ReleasePlan,
): string => `\
### ⚠️ No Changeset found

Latest commit: ${commitSha}

Merging this PR will not cause a version bump for any packages. If these changes should not result in a new version, you're good to go. **If these changes should result in a version bump, you need to add a changeset.**

${getReleasePlanMessage(releasePlan)}

[Click here to learn what changesets are, and how to add one](https://changesets.dev/faq).

[Click here if you're a maintainer who wants to add a changeset to this PR](${newChangesetUrl})`

export const getCommentMessage = async (context: PullRequestContext): Promise<string> => {
  return withPullRequestWorktree(context, async (worktree) => {
    const releasePlan = await getReleasePlan(worktree.cwd, worktree.baseRef)
    const templateContent = await getNewChangesetTemplateContent(
      worktree.cwd,
      worktree.baseRef,
      context.title,
    )

    const newChangesetUrl = getNewChangesetUrl(
      context.head.repo.html_url,
      context.head.ref,
      templateContent,
    )

    if (releasePlan.changesets.length > 0) {
      return getApproveMessage(context.head.sha, newChangesetUrl, releasePlan)
    }
    return getAbsentMessage(context.head.sha, newChangesetUrl, releasePlan)
  })
}
