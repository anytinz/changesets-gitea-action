import { info, setFailed, setOutput } from '@actions/core'
import { context } from '@actions/github'
import { isPullRequestContext } from '@/pr-context'
import { getCommentMessage } from '@/pr-status/message'
import { getErrorMessage } from '@/utils'
import type { PullRequestContext } from '@/pr-context'

const main = async (): Promise<void> => {
  const pullRequest = context.payload.pull_request
  if (!isPullRequestContext(pullRequest)) {
    throw new Error(
      'This action should only be run on `pull_request_target` or `pull_request` events',
    )
  }

  info('Creating comment message...')
  const commentBody = await getCommentMessage(pullRequest satisfies PullRequestContext)
  setOutput('comment-body', commentBody)
  info('Done!')
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
