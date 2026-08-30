import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { info, warning } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { context } from '@actions/github'
import { getData, getGiteaServerUrl, isNotFound } from '@/gitea'
import type { GiteaClient } from '@/gitea'

const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export class Git {
  public readonly gitea: GiteaClient

  public readonly cwd: string

  public readonly giteaToken: string

  public readonly serverUrl: string

  public constructor(args: {
    gitea: GiteaClient
    cwd: string
    giteaToken: string
    serverUrl?: string
  }) {
    this.gitea = args.gitea
    this.cwd = args.cwd
    this.giteaToken = args.giteaToken
    this.serverUrl = (args.serverUrl ?? getGiteaServerUrl()).replace(/\/+$/u, '')
  }

  public getToken(): string {
    return this.giteaToken
  }

  public async ensureGitUser(): Promise<void> {
    const authorIdentity = await getExecOutput(
      'git',
      ['-c', 'user.useConfigOnly=true', 'var', 'GIT_AUTHOR_IDENT'],
      {
        cwd: this.cwd,
        ignoreReturnCode: true,
        silent: true,
      },
    )
    const committerIdentity = await getExecOutput(
      'git',
      ['-c', 'user.useConfigOnly=true', 'var', 'GIT_COMMITTER_IDENT'],
      {
        cwd: this.cwd,
        ignoreReturnCode: true,
        silent: true,
      },
    )
    if (authorIdentity.exitCode === 0 && committerIdentity.exitCode === 0) {
      return
    }
    info('Setting Git user to gitea-actions[bot]')
    await exec('git', ['config', 'user.name', '"gitea-actions[bot]"'], {
      cwd: this.cwd,
    })
    await exec(
      'git',
      [
        'config',
        'user.email',
        '"gitea-actions[bot]@users.noreply.gitea"',
      ],
      {
        cwd: this.cwd,
      },
    )
  }

  public async pushTag(tag: string): Promise<void> {
    await this.gitea.POST('/repos/{owner}/{repo}/tags', {
      params: {
        path: {
          owner: context.repo.owner,
          repo: context.repo.repo,
        },
      },
      body: {
        tag_name: tag,
        target: context.sha,
      },
    })
      .catch((error: unknown) => {
        // Assuming tag was manually pushed in custom publish script
        warning(`Failed to create tag ${tag}: ${getErrorMessage(error)}`)
      })
  }

  public async pushChanges({ branch, message }: { branch: string; message: string }): Promise<void> {
    await this.pushChangesViaApi({ branch, message })
  }

  /**
   * Push the working directory changes to a branch via the Gitea contents API.
   *
   * This emulates the behavior of `git add .` + `git commit` + `git push`.
   */
  private async pushChangesViaApi({
    branch,
    message,
  }: {
    branch: string
    message: string
  }): Promise<void> {
    const { owner, repo } = context.repo
    const { stdout: repoRootOutput } = await getExecOutput('git', ['rev-parse', '--show-toplevel'], {
      cwd: this.cwd,
    })
    const repoRoot = repoRootOutput.trim()

    await this.ensureBranch({ owner, repo, branch })

    const changes = new Map<string, 'create' | 'update' | 'delete'>()

    const { stdout: diffOutput } = await getExecOutput(
      'git',
      ['diff', '--name-status', '--no-renames', '--relative', context.sha],
      { cwd: this.cwd, ignoreReturnCode: true },
    )
    diffOutput.split('\n').forEach((line) => {
      const [status, filepath] = line.split('\t')
      if (filepath === undefined) {
        return
      }
      let type: 'create' | 'update' | 'delete' = 'update'
      if (status === 'D') {
        type = 'delete'
      } else if (status === 'A') {
        type = 'create'
      }
      changes.set(filepath, type)
    })

    const { stdout: untrackedOutput } = await getExecOutput(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: this.cwd },
    )
    untrackedOutput.split('\n').forEach((filepath) => {
      if (filepath !== '') {
        changes.set(filepath, 'create')
      }
    })

    await [...changes].reduce<Promise<void>>(async (previous, [filepath, type]) => {
      await previous
      // File paths relative to the git repository root, as expected by the API
      const apiPath = path.relative(repoRoot, path.resolve(this.cwd, filepath)).split(path.sep).join('/')

      if (type === 'delete') {
        const sha = await this.getFileSha({ owner, repo, branch, apiPath })
        if (sha !== undefined) {
          await this.gitea.DELETE('/repos/{owner}/{repo}/contents/{filepath}', {
            params: {
              path: {
                owner,
                repo,
                filepath: apiPath,
              },
            },
            body: { branch, sha, message },
          })
        }
        return
      }

      const filePath = path.join(this.cwd, filepath)
      const stats = await lstat(filePath)
      if (!stats.isFile()) {
        // Skip non-regular files (e.g. directory symlinks created by pnpm or
        // bun installs), they cannot be represented in the contents API.
        warning(`Skipping non-regular file: ${filepath}`)
        return
      }

      const fileContents = await readFile(filePath)
      const content = fileContents.toString('base64')
      const sha = await this.getFileSha({ owner, repo, branch, apiPath })

      await (sha === undefined
        ? this.gitea.POST('/repos/{owner}/{repo}/contents/{filepath}', {
          params: {
            path: {
              owner,
              repo,
              filepath: apiPath,
            },
          },
          body: { branch, content, message },
        })
        : this.gitea.PUT('/repos/{owner}/{repo}/contents/{filepath}', {
          params: {
            path: {
              owner,
              repo,
              filepath: apiPath,
            },
          },
          body: { branch, sha, content, message },
        }))
    }, Promise.resolve())
  }

  private async ensureBranch({
    owner,
    repo,
    branch,
  }: {
    owner: string
    repo: string
    branch: string
  }): Promise<void> {
    try {
      await this.gitea.GET('/repos/{owner}/{repo}/branches/{branch}', {
        params: {
          path: { owner, repo, branch },
        },
      })
    } catch (error) {
      if (isNotFound(error)) {
        await this.gitea.POST('/repos/{owner}/{repo}/branches', {
          params: {
            path: { owner, repo },
          },
          body: {
            new_branch_name: branch,
            old_ref_name: context.sha,
          },
        })
        return
      }
      throw error
    }
  }

  private async getFileSha({
    owner,
    repo,
    branch,
    apiPath,
  }: {
    owner: string
    repo: string
    branch: string
    apiPath: string
  }): Promise<string | undefined> {
    try {
      const data = getData(await this.gitea.GET('/repos/{owner}/{repo}/contents/{filepath}', {
        params: {
          path: { owner, repo, filepath: apiPath },
          query: { ref: branch },
        },
      }))
      return Array.isArray(data) ? undefined : data.sha
    } catch (error) {
      if (isNotFound(error)) {
        return undefined
      }
      throw error
    }
  }
}
