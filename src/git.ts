import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { info, warning } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { context } from '@actions/github'
import { getGiteaServerUrl } from '@/gitea'
import type { components } from '@/generated/gitea-schema'
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

  public async pushChanges({
    base,
    branch,
    message,
  }: {
    base: string
    branch: string
    message: string
  }): Promise<void> {
    await this.pushChangesViaApi({ base, branch, message })
  }

  /**
   * Push the working directory changes to a branch via the Gitea contents API.
   *
   * Gitea's multi-file endpoint creates a single commit from `base` and force
   * updates `branch`. Re-running the action therefore replaces the previous
   * release commit instead of appending one commit per changed file.
   */
  private async pushChangesViaApi({
    base,
    branch,
    message,
  }: {
    base: string
    branch: string
    message: string
  }): Promise<void> {
    const { owner, repo } = context.repo
    const { stdout: repoRootOutput } = await getExecOutput('git', ['rev-parse', '--show-toplevel'], {
      cwd: this.cwd,
    })
    const repoRoot = repoRootOutput.trim()

    const changes = new Map<string, 'upload' | 'delete'>()

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
      changes.set(filepath, status === 'D' ? 'delete' : 'upload')
    })

    const { stdout: untrackedOutput } = await getExecOutput(
      'git',
      ['ls-files', '--others', '--exclude-standard'],
      { cwd: this.cwd },
    )
    untrackedOutput.split('\n').forEach((filepath) => {
      if (filepath !== '') {
        changes.set(filepath, 'upload')
      }
    })

    const pendingFiles = await Promise.all(
      [...changes].map(async ([filepath, operation]) => {
        // File paths relative to the git repository root, as expected by the API
        const apiPath = path.relative(repoRoot, path.resolve(this.cwd, filepath)).split(path.sep).join('/')

        if (operation === 'delete') {
          return {
            operation: 'delete',
            path: apiPath,
          } satisfies components['schemas']['ChangeFileOperation']
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
        return {
          operation: 'upload',
          path: apiPath,
          content: fileContents.toString('base64'),
        } satisfies components['schemas']['ChangeFileOperation']
      }),
    )
    const files = pendingFiles.filter((operation) => operation !== undefined)

    if (files.length === 0) {
      throw new Error('The version command did not produce any regular file changes to commit')
    }

    await this.gitea.POST('/repos/{owner}/{repo}/contents', {
      params: {
        path: { owner, repo },
      },
      body: {
        branch: base,
        new_branch: branch,
        force_push: true,
        message,
        files,
      },
    })
  }
}
