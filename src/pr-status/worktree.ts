import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { isRepoShallow } from '@changesets/git'
import { exec } from 'tinyexec'
import { moveDisposable } from '@/utils'
import type { Result } from 'tinyexec'
import type { PullRequestContext } from '@/pr-context'
import type { WithAsyncDispose } from '@/utils'

type WorktreeInfo = {
  baseRef: string
  cwd: string
}

type TinyexecOptions = Parameters<typeof exec>[2]

const git = async (
  cwd: string,
  args: string[],
  opts: TinyexecOptions = {},
): Promise<Result> => exec('git', args, {
  nodeOptions: { cwd, ...opts.nodeOptions },
  throwOnError: true,
  ...opts,
})

interface Ref {
  fetchSource: string
  local: string
  remote: string
}

const getRefs = (context: PullRequestContext): Record<'base' | 'head', Ref> => {
  const suffix = `${context.number}-${randomUUID()}`
  return {
    base: {
      fetchSource: 'origin',
      local: `refs/changesets-action-pr-status/base/${suffix}`,
      remote: `refs/heads/${context.base.ref}`,
    },
    head: {
      fetchSource: context.head.repo.clone_url,
      local: `refs/changesets-action-pr-status/head/${suffix}`,
      remote: `refs/heads/${context.head.ref}`,
    },
  }
}

const deepenRef = async (cwd: string, ref: Ref, deepenBy: number): Promise<void> => {
  await git(cwd, [
    'fetch',
    '--no-tags',
    `--deepen=${deepenBy}`,
    ref.fetchSource,
    `${ref.remote}:${ref.local}`,
  ])
}

const ensureMergeBase = async (args: {
  cwd: string
  refs: ReturnType<typeof getRefs>
  deepenBy?: number
}): Promise<string> => {
  const { cwd, refs, deepenBy = 50 } = args

  const mergeBase = await git(cwd, ['merge-base', refs.base.local, 'HEAD'], {
    throwOnError: false,
  })

  if (mergeBase.exitCode === 0) {
    return mergeBase.stdout.trim()
  }

  if (!await isRepoShallow({ cwd })) {
    throw new Error(
      `Failed to find merge base between "${refs.base.local}" and HEAD, and the repository is no longer shallow.`,
    )
  }

  await deepenRef(cwd, refs.base, deepenBy)
  await deepenRef(cwd, refs.head, deepenBy)

  return ensureMergeBase({ cwd, refs, deepenBy })
}

const mkdtempDir = async (prefix: string): Promise<WithAsyncDispose<{ dir: string }>> => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix))

  return {
    dir,
    async [Symbol.asyncDispose](): Promise<void> {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

const tempRef = async (cwd: string, ref: Ref): Promise<WithAsyncDispose<Record<string, never>>> => {
  await git(cwd, [
    'fetch',
    '--no-tags',
    '--depth=1',
    ref.fetchSource,
    `${ref.remote}:${ref.local}`,
  ])
  return {
    async [Symbol.asyncDispose](): Promise<void> {
      await git(cwd, ['update-ref', '-d', ref.local], { throwOnError: false })
    },
  }
}

const tempWorktree = async (
  cwd: string,
  dir: string,
  ref: Ref,
): Promise<WithAsyncDispose<Record<string, never>>> => {
  await git(cwd, ['worktree', 'add', '--detach', dir, ref.local])

  return {
    async [Symbol.asyncDispose](): Promise<void> {
      await git(cwd, ['worktree', 'remove', '--force', dir], {
        throwOnError: false,
      })
    },
  }
}

export const getPullRequestWorktree = async (
  context: PullRequestContext,
  cwd: string = process.cwd(),
): Promise<WithAsyncDispose<WorktreeInfo>> => {
  await using stack = new AsyncDisposableStack()
  const worktreeDir = stack.use(
    await mkdtempDir('changesets-action-pr-status-'),
  ).dir

  const refs = getRefs(context)

  stack.use(await tempRef(cwd, refs.base))
  stack.use(await tempRef(cwd, refs.head))
  stack.use(await tempWorktree(cwd, worktreeDir, refs.head))

  await ensureMergeBase({
    cwd: worktreeDir,
    refs,
  })

  return moveDisposable(stack, {
    baseRef: refs.base.local,
    cwd: worktreeDir,
  })
}
