import { pathToFileURL } from 'node:url'
import { getReleasePlan } from '@changesets/get-release-plan'
import { exec } from 'tinyexec'
import { describe, expect, it } from 'vitest'
import { withPullRequestWorktree } from '@/pr-status/worktree'
import { gitdir, shallowClone, testdir, withTestScope } from '../test-utils.js'
import type { PullRequestContext } from '@/pr-context'

const git = async (cwd: string, args: string[]): Promise<string> => {
  const output = await exec('git', args, {
    nodeOptions: { cwd },
    throwOnError: true,
  })
  return output.stdout.trim()
}

describe('withPullRequestWorktree', () => {
  it('fetches a PR branch into a detached worktree and keeps the main checkout untouched', async () => {
    await withTestScope(async (add) => {
      // Local source repo
      const sourceRepo = add(
        await gitdir({
          '.changeset/config.json': '{}',
          'package.json': JSON.stringify({
            name: 'repo',
            private: true,
            workspaces: ['packages/*'],
          }),
          'package-lock.json': '',
          'packages/pkg-a/package.json': JSON.stringify({
            name: 'pkg-a',
            version: '1.0.0',
          }),
        }),
        async (fixture) => fixture.rm(),
      ).path

      // Simulate remote bare git server
      const originBare = add(await testdir(), async (fixture) => fixture.rm()).path
      await git(originBare, [
        'clone',
        '--bare',
        pathToFileURL(sourceRepo).toString(),
        '.',
      ])

      // Simulate checkout PR in github action
      const checkoutRepo = add(
        await shallowClone(originBare),
        async (fixture) => fixture.rm(),
      ).path

      // Simulate remote fork bare git server
      const forkBare = add(await testdir(), async (fixture) => fixture.rm()).path
      await git(forkBare, [
        'clone',
        '--bare',
        pathToFileURL(originBare).toString(),
        '.',
      ])

      const forkRepoFixture = add(
        await shallowClone(forkBare),
        async (fixture) => fixture.rm(),
      )
      const forkRepo = forkRepoFixture.path
      await git(forkRepo, ['config', 'user.name', 'Test User'])
      await git(forkRepo, ['config', 'user.email', 'test@example.com'])
      await git(forkRepo, ['checkout', '-b', 'feature'])

      await forkRepoFixture.mkdir('packages/pkg-a/src')
      await forkRepoFixture.writeFile(
        'packages/pkg-a/src/index.ts',
        'export const value = 1;\n',
      )
      await forkRepoFixture.writeFile(
        '.changeset/add-pkg-a.md',
        `\
---
"pkg-a": patch
---

Add pkg-a
`,
      )

      await git(forkRepo, ['add', '.'])
      await git(forkRepo, ['commit', '-m', 'feature'])
      await git(forkRepo, ['push', 'origin', 'feature'])

      // Run tests
      const originalHead = await git(checkoutRepo, ['rev-parse', 'HEAD'])
      const context: PullRequestContext = {
        number: 123,
        title: 'Add pkg-a',
        base: {
          ref: 'main',
          repo: {
            name: 'repo',
            owner: {
              login: 'org',
            },
            html_url: `file://${originBare}`,
            clone_url: pathToFileURL(originBare).toString(),
          },
        },
        head: {
          ref: 'feature',
          sha: 'fake-sha',
          repo: {
            name: 'repo',
            html_url: `file://${forkBare}`,
            clone_url: pathToFileURL(forkBare).toString(),
            owner: {
              login: 'org',
            },
          },
        },
      }

      await withPullRequestWorktree(context, async (worktree) => {
        const releasePlan = await getReleasePlan(worktree.cwd, worktree.baseRef)

        const currentHead = await git(worktree.cwd, ['rev-parse', 'HEAD'])
        expect(currentHead).not.toBe(originalHead)

        const currentBranch = await git(worktree.cwd, ['branch', '--show-current'])
        expect(currentBranch).toBe('')

        const releases = releasePlan.releases.map((release) => ({
          name: release.name,
          type: release.type,
          newVersion: release.newVersion,
        }))
        expect(releases).toEqual([
          {
            name: 'pkg-a',
            type: 'patch',
            newVersion: '1.0.1',
          },
        ])
      }, checkoutRepo)

      expect(await git(checkoutRepo, ['rev-parse', 'HEAD'])).toBe(originalHead)
      expect(await git(checkoutRepo, ['branch', '--show-current'])).toBe('main')
    })
  })
})
