import { realpath } from 'node:fs/promises'
import os from 'node:os'
import process from 'node:process'
import { getBooleanInput, setFailed, setOutput } from '@actions/core'
import { Git } from '@/git'
import { setupGitea } from '@/gitea'
import { runPublish } from '@/run'
import {
  downloadArtifact,
  getErrorMessage,
  getOptionalInput,
  getRequiredInput,
  validateChangesetsCliVersion,
} from '@/utils'

const main = async (): Promise<void> => {
  const cwd = getOptionalInput('cwd') ?? process.cwd()
  await validateChangesetsCliVersion(cwd)

  const giteaToken = getRequiredInput('gitea-token')
  const script = getOptionalInput('script')
  const packDirArtifactId = getOptionalInput('pack-dir-artifact-id')
  const createGiteaReleases = getBooleanInput('create-gitea-releases')
  const pushGitTags = getBooleanInput('push-git-tags')

  if (createGiteaReleases && !pushGitTags) {
    throw new Error(
      "The input 'create-gitea-releases' is set to true, but 'push-git-tags' is set to false. "
      + "Creating Gitea releases requires pushing git tags. Please set 'push-git-tags' to true "
      + "or set 'create-gitea-releases' to false.",
    )
  }

  const gitea = setupGitea(giteaToken)
  const git = new Git({
    cwd,
    giteaToken,
    gitea,
  })

  const fromPackDir = packDirArtifactId === undefined
    ? undefined
    : await downloadArtifact(
      process.env.RUNNER_TEMP ?? await realpath(os.tmpdir()),
      Number(packDirArtifactId),
      'changeset-pack',
    )

  const result = await runPublish({
    script,
    git,
    gitea,
    createGiteaReleases,
    pushGitTags,
    cwd,
    fromPackDir,
  })

  if (result.published) {
    setOutput('published', 'true')
    setOutput(
      'published-packages',
      JSON.stringify(result.publishedPackages),
    )
  } else {
    setOutput('published', 'false')
  }

  if (result.exitCode !== 0) {
    throw new Error(
      `Publish command exited with code ${result.exitCode}${
        result.published
          ? `, but some packages were published: ${result.publishedPackages
            .map((p) => `${p.name}@${p.version}`)
            .join(', ')}`
          : ''
      }`,
    )
  }
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
