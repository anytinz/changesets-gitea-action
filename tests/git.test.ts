import { rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { exec } from 'tinyexec'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Git } from '@/git'
import { gitdir, withTestScope } from './test-utils.js'
import type { components } from '@/generated/gitea-schema'
import type { GiteaClient } from '@/gitea'

const githubContext = vi.hoisted(() => ({
  repo: {
    owner: 'changesets',
    repo: 'action',
  },
  sha: 'base-sha',
}))

vi.mock('@actions/github', () => ({
  context: githubContext,
}))

type ChangeFilesRequest = {
  params: {
    path: {
      owner: string
      repo: string
    }
  }
  body: {
    branch: string
    new_branch: string
    force_push: boolean
    message: string
    files: components['schemas']['ChangeFileOperation'][]
  }
}

const post = vi.fn<(url: string, init: ChangeFilesRequest) => Promise<object>>()

const createGit = (cwd: string): Git => new Git({
  cwd,
  // The test only exercises the POST method used by branch updates.
  // eslint-disable-next-line ts/no-unsafe-type-assertion
  gitea: { POST: post } as unknown as GiteaClient,
  giteaToken: 'token',
  serverUrl: 'https://gitea.example.com',
})

const getHead = async (cwd: string): Promise<string> => {
  const result = await exec('git', ['rev-parse', 'HEAD'], {
    nodeOptions: { cwd },
    throwOnError: true,
  })
  return result.stdout.trim()
}

beforeEach(() => {
  vi.clearAllMocks()
  githubContext.sha = 'base-sha'
})

describe('Git.pushChanges', () => {
  it('force-updates the release branch with all file changes in one commit request', async () => {
    await withTestScope(async (add) => {
      const fixture = add(
        await gitdir({
          'deleted.txt': 'delete me\n',
          'updated.txt': 'before\n',
        }),
        async (value) => value.rm(),
      )
      const cwd = fixture.path
      githubContext.sha = await getHead(cwd)

      await Promise.all([
        rm(path.join(cwd, 'deleted.txt')),
        writeFile(path.join(cwd, 'new.txt'), 'created\n'),
        writeFile(path.join(cwd, 'updated.txt'), 'after\n'),
        symlink('updated.txt', path.join(cwd, 'linked.txt')),
      ])

      await createGit(cwd).pushChanges({
        base: 'main',
        branch: 'changeset-release/main',
        message: 'Version Packages',
      })

      expect(post).toHaveBeenCalledOnce()
      expect(post).toHaveBeenCalledWith(
        '/repos/{owner}/{repo}/contents',
        {
          params: {
            path: {
              owner: 'changesets',
              repo: 'action',
            },
          },
          body: {
            branch: 'main',
            new_branch: 'changeset-release/main',
            force_push: true,
            message: 'Version Packages',
            files: [
              {
                operation: 'delete',
                path: 'deleted.txt',
              },
              {
                operation: 'upload',
                path: 'updated.txt',
                content: Buffer.from('after\n').toString('base64'),
              },
              {
                operation: 'upload',
                path: 'new.txt',
                content: Buffer.from('created\n').toString('base64'),
              },
            ],
          },
        },
      )
    })
  })

  it('does not create an empty commit when there are no file changes', async () => {
    await withTestScope(async (add) => {
      const fixture = add(
        await gitdir({ 'unchanged.txt': 'same\n' }),
        async (value) => value.rm(),
      )
      githubContext.sha = await getHead(fixture.path)

      await expect(createGit(fixture.path).pushChanges({
        base: 'main',
        branch: 'changeset-release/main',
        message: 'Version Packages',
      })).rejects.toThrow('did not produce any regular file changes')
      expect(post).not.toHaveBeenCalled()
    })
  })
})
