import { getInput, info, setFailed, setOutput } from '@actions/core'
import { context } from '@actions/github'
import { getData, setupGitea } from '@/gitea'
import { isPullRequestContext } from '@/pr-context'
import { getErrorMessage, getRequiredInput } from '@/utils'
import type { PullRequestContext } from '@/pr-context'

type CommentParams = {
  owner: string
  repo: string
  index: number
  body: string
}

const getCommentMarker = (updateId: string): string => {
  const prefix = 'changesets-action-pr-comment'
  return prefix === updateId
    ? `<!-- ${prefix} -->`
    : `<!-- ${prefix}:${updateId} -->`
}

const createOrUpdateComment = async (prContext: PullRequestContext): Promise<void> => {
  const giteaToken = getRequiredInput('gitea-token')
  const body = getRequiredInput('body')
  const updateId = getInput('update-id') || undefined

  const commentMarker = updateId === undefined ? null : getCommentMarker(updateId)
  const commentBody = commentMarker === null ? body : `${commentMarker}\n\n${body}`
  const commentParam: CommentParams = {
    repo: prContext.base.repo.name,
    owner: prContext.base.repo.owner.login,
    index: prContext.number,
    body: commentBody,
  }

  const gitea = setupGitea(giteaToken)

  if (commentMarker === null) {
    info('Creating new comment...')
    const result = await gitea.POST('/repos/{owner}/{repo}/issues/{index}/comments', {
      params: {
        path: {
          owner: commentParam.owner,
          repo: commentParam.repo,
          index: commentParam.index,
        },
      },
      body: { body: commentBody },
    })
    setOutput('comment-id', String(getData(result).id))
    info('Done!')
    return
  }

  info('Checking for existing comment...')
  const comments = getData(await gitea.GET('/repos/{owner}/{repo}/issues/{index}/comments', {
    params: {
      path: {
        owner: commentParam.owner,
        repo: commentParam.repo,
        index: commentParam.index,
      },
    },
  }))
  const existingComment = comments.find(
    (c) => c.body?.includes(commentMarker) === true,
  )

  if (existingComment?.id === undefined) {
    info('Creating new comment...')
    const result = await gitea.POST('/repos/{owner}/{repo}/issues/{index}/comments', {
      params: {
        path: {
          owner: commentParam.owner,
          repo: commentParam.repo,
          index: commentParam.index,
        },
      },
      body: { body: commentBody },
    })
    setOutput('comment-id', String(getData(result).id))
  } else {
    info(`Updating existing comment (id: ${existingComment.id})...`)
    await gitea.PATCH('/repos/{owner}/{repo}/issues/comments/{id}', {
      params: {
        path: {
          owner: commentParam.owner,
          repo: commentParam.repo,
          id: existingComment.id,
        },
      },
      body: { body: commentBody },
    })
    setOutput('comment-id', existingComment.id)
  }

  info('Done!')
}

const main = async (): Promise<void> => {
  const pullRequest = context.payload.pull_request
  if (!isPullRequestContext(pullRequest)) {
    throw new Error(
      'This action should only be run on `pull_request_target` or `pull_request` events',
    )
  }

  await createOrUpdateComment(pullRequest)
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
