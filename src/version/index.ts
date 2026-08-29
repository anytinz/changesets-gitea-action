import process from 'node:process'
import { setFailed, setOutput } from '@actions/core'
import { Git } from '@/git'
import { setupGitea } from '@/gitea'
import { runVersion } from '@/run'
import {
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
  const commitMessage = getRequiredInput('commit-message')
  const prTitle = getRequiredInput('pr-title')
  const prDraft = getOptionalInput('pr-draft')
  const prBaseBranch = getOptionalInput('pr-base-branch')

  // Validations
  if (prDraft !== undefined && prDraft !== 'always' && prDraft !== 'create') {
    throw new Error(`Invalid pr-draft input: ${prDraft}`)
  }
  const gitea = setupGitea(giteaToken)
  const git = new Git({
    cwd,
    giteaToken,
    gitea,
  })

  const { pullRequestNumber } = await runVersion({
    script,
    git,
    gitea,
    cwd,
    prTitle,
    commitMessage,
    // TODO: Use neutral message for PR description
    hasPublishScript: true,
    prDraft,
    branch: prBaseBranch,
  })

  setOutput('pr-number', String(pullRequestNumber))
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
