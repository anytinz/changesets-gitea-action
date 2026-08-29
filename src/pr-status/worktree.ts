import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { isRepoShallow } from '@changesets/git'
import { exec } from 'tinyexec'
import type { Result } from 'tinyexec'
import type { PullRequestContext } from '@/pr-context'

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

const fetchRef = async (cwd: string, ref: Ref): Promise<void> => {
  await git(cwd, [
    'fetch',
    '--no-tags',
    '--depth=1',
    ref.fetchSource,
    `${ref.remote}:${ref.local}`,
  ])
}

const removeRef = async (cwd: string, ref: Ref): Promise<void> => {
  await git(cwd, ['update-ref', '-d', ref.local], { throwOnError: false })
}

const addWorktree = async (cwd: string, dir: string, ref: Ref): Promise<void> => {
  await git(cwd, ['worktree', 'add', '--detach', dir, ref.local])
}

const removeWorktree = async (cwd: string, dir: string): Promise<void> => {
  await git(cwd, ['worktree', 'remove', '--force', dir], {
    throwOnError: false,
  })
}

export const withPullRequestWorktree = async <T>(
  context: PullRequestContext,
  fn: (worktree: WorktreeInfo) => Promise<T>,
  cwd: string = process.cwd(),
): Promise<T> => {
  const worktreeDir = await mkdtemp(path.join(os.tmpdir(), 'changesets-action-pr-status-'))
  const refs = getRefs(context)
  const cleanup: (() => Promise<void>)[] = []

  try {
    cleanup.push(async () => rm(worktreeDir, { recursive: true, force: true }))
    await fetchRef(cwd, refs.base)
    cleanup.push(async () => removeRef(cwd, refs.base))
    await fetchRef(cwd, refs.head)
    cleanup.push(async () => removeRef(cwd, refs.head))
    await addWorktree(cwd, worktreeDir, refs.head)
    cleanup.push(async () => removeWorktree(cwd, worktreeDir))

    await ensureMergeBase({
      cwd: worktreeDir,
      refs,
    })

    return await fn({
      baseRef: refs.base.local,
      cwd: worktreeDir,
    })
  } finally {
    await cleanup.toReversed().reduce(
      async (previous, dispose) => {
        await previous
        await dispose()
      },
      Promise.resolve(),
    )
  }
}
