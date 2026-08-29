import process from 'node:process'
import { error as coreError, getBooleanInput, getInput, info, setFailed, setOutput } from '@actions/core'
import { Git } from '@/git'
import { setupGitea } from '@/gitea'
import { readChangesetState } from '@/read-changeset-state'
import { runPublish, runVersion } from '@/run'
import {
  getErrorMessage,
  getOptionalInput,
  getRequiredInput,
  throwOnRenamedInputs,
  validateChangesetsCliVersion,
} from '@/utils'

const main = async (): Promise<void> => {
  const cwd = getOptionalInput('cwd') ?? process.cwd()
  await validateChangesetsCliVersion(cwd)

  throwOnRenamedInputs({
    publish: 'publish-script',
    version: 'version-script',
    commit: 'commit-message',
    title: 'pr-title',
    branch: 'pr-base-branch',
    prDraft: 'pr-draft',
    createGithubReleases: 'create-gitea-releases',
  })

  const giteaToken = getRequiredInput('gitea-token')
  if (process.env.GITEA_TOKEN !== undefined && process.env.GITEA_TOKEN !== giteaToken) {
    throw new Error(
      'The GITEA_TOKEN environment variable is set and does not match the "gitea-token" input. '
      + 'Please pass the custom Gitea token to the "gitea-token" input and '
      + 'remove the GITEA_TOKEN environment variable to avoid conflicts.',
    )
  }

  const prDraft = getOptionalInput('pr-draft')
  if (prDraft !== undefined && prDraft !== 'always' && prDraft !== 'create') {
    setFailed(`Invalid pr-draft: ${prDraft}`)
    return
  }
  const gitea = setupGitea(giteaToken)
  const git = new Git({
    cwd,
    giteaToken,
    gitea,
  })

  const { changesets } = await readChangesetState(cwd)

  const publishScript = getInput('publish-script')
  const hasChangesets = changesets.length > 0
  const hasNonEmptyChangesets = changesets.some(
    (changeset) => changeset.releases.length > 0,
  )
  const hasPublishScript = publishScript !== ''

  setOutput('published', 'false')
  setOutput('published-packages', '[]')
  setOutput('has-changesets', String(hasChangesets))

  if (!hasChangesets && !hasPublishScript) {
    info(
      'No changesets present or were removed by merging release PR. Not publishing because no publish script found.',
    )
    return
  }

  if (!hasChangesets && hasPublishScript) {
    info(
      'No changesets found. Attempting to publish any unpublished packages to npm',
    )

    const createGiteaReleases = getBooleanInput('create-gitea-releases')
    const pushGitTags = getBooleanInput('push-git-tags')
    if (createGiteaReleases && !pushGitTags) {
      throw new Error(
        "The input 'create-gitea-releases' is set to true, but 'push-git-tags' is set to false. "
        + "Creating Gitea releases requires pushing git tags. Please set 'push-git-tags' to true "
        + "or set 'create-gitea-releases' to false.",
      )
    }
    const result = await runPublish({
      script: publishScript,
      git,
      gitea,
      createGiteaReleases,
      pushGitTags,
      cwd,
    })

    if (result.published) {
      setOutput('published', 'true')
      setOutput(
        'published-packages',
        JSON.stringify(result.publishedPackages),
      )
    }

    if (result.exitCode !== 0) {
      coreError(
        `Publish command exited with code ${result.exitCode}${
          result.published
            ? `, but some packages were published: ${result.publishedPackages
              .map((p) => `${p.name}@${p.version}`)
              .join(', ')}`
            : ''
        }`,
      )
      throw new Error(`Publish command exited with code ${result.exitCode}`)
    }
    return
  }

  if (hasChangesets && !hasNonEmptyChangesets) {
    info('All changesets are empty; not creating PR')
    return
  }

  if (hasChangesets) {
    const { pullRequestNumber } = await runVersion({
      script: getOptionalInput('version-script'),
      git,
      gitea,
      cwd,
      prTitle: getOptionalInput('pr-title'),
      commitMessage: getOptionalInput('commit-message'),
      hasPublishScript,
      prDraft,
      branch: getOptionalInput('pr-base-branch'),
    })

    setOutput('pr-number', String(pullRequestNumber))
  }
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
