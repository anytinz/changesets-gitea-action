import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { info, warning } from '@actions/core'
import { exec, getExecOutput } from '@actions/exec'
import { context } from '@actions/github'
import { getPackages } from '@manypkg/get-packages'
import { getData, isNotFound } from '@/gitea'
import { readChangesetState } from '@/read-changeset-state'
import {
  execChangesetsCli,
  getChangedPackages,
  getChangelogEntry,
  getExecOutputChangesetsCli,
  getVersionsByDirectory,
  isErrorWithCode,
  sortTheThings,
} from '@/utils'
import type { ExecOptions, ExecOutput } from '@actions/exec'
import type { PreState } from '@changesets/types'
import type { Package } from '@manypkg/get-packages'
import type { Git } from '@/git'
import type { GiteaClient } from '@/gitea'

// Gitea issues/PRs messages have a max size limit on the
// message body payload.
// `body is too long (maximum is 65536 characters)`.
// To avoid that, we ensure to cap the message to 60k chars.
const MAX_CHARACTERS_PER_MESSAGE = 60_000

const parseJson = (raw: string): unknown => JSON.parse(raw)

const toError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)))

const readChangelog = async (pkgDir: string): Promise<string | undefined> => {
  try {
    return await readFile(path.join(pkgDir, 'CHANGELOG.md'), 'utf8')
  } catch (error) {
    if (isErrorWithCode(error, 'ENOENT')) {
      // if we can't find a changelog, the user has probably disabled changelogs
      return undefined
    }
    throw error
  }
}

const createRelease = async (
  gitea: GiteaClient,
  { pkg, tagName }: { pkg: Package; tagName: string },
): Promise<void> => {
  const changelog = await readChangelog(pkg.dir)
  if (changelog === undefined) {
    return
  }
  const changelogEntry = getChangelogEntry(changelog, pkg.packageJson.version)

  await gitea.POST('/repos/{owner}/{repo}/releases', {
    params: {
      path: {
        owner: context.repo.owner,
        repo: context.repo.repo,
      },
    },
    body: {
      body: changelogEntry.content,
      name: tagName,
      prerelease: pkg.packageJson.version.includes('-'),
      tag_name: tagName,
    },
  })
}

type PublishOptions = {
  script?: string
  fromPackDir?: string
  createGiteaReleases: boolean
  pushGitTags: boolean
  git: Git
  gitea: GiteaClient
  cwd: string
}

type PublishedPackage = { name: string; version: string }
type ChangesetsOutputEvent = {
  type: 'git-tag'
  tag: string
  packageName: string
}

class ChangesetsOutputReadError extends Error {}

type PublishResult = | {
  published: true
  publishedPackages: PublishedPackage[]
  exitCode: number
}
| {
  published: false
  exitCode: number
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isChangesetsOutputEvent = (value: unknown): value is ChangesetsOutputEvent => {
  if (!isObject(value)) {
    return false
  }
  return (
    'type' in value
    && value.type === 'git-tag'
    && 'tag' in value
    && typeof value.tag === 'string'
    && 'packageName' in value
    && typeof value.packageName === 'string'
  )
}

const readOutputFile = async (outputPath: string): Promise<string> => {
  try {
    return await readFile(outputPath, 'utf8')
  } catch (error) {
    throw new ChangesetsOutputReadError(`Failed to read changesets output at ${outputPath}`, {
      cause: error,
    })
  }
}

const parseOutputEvent = (line: string): unknown => {
  try {
    return parseJson(line)
  } catch (error) {
    throw new Error(`Failed to parse changesets output event: ${line}`, { cause: error })
  }
}

const readChangesetsOutput = async (outputPath: string): Promise<ChangesetsOutputEvent[]> => {
  const rawOutput = await readOutputFile(outputPath)

  const events: ChangesetsOutputEvent[] = []
  rawOutput.split('\n').forEach((line) => {
    if (/^\s*$/u.test(line)) {
      return
    }
    const event = parseOutputEvent(line)
    if (isChangesetsOutputEvent(event)) {
      events.push(event)
    }
  })

  return events
}

export const runPublish = async ({
  script,
  fromPackDir,
  git,
  gitea,
  createGiteaReleases,
  pushGitTags,
  cwd,
}: PublishOptions): Promise<PublishResult> => {
  // Changesets creates annotated tags locally.
  // It might also be important for custom publish scripts to have a valid git user configured.
  await git.ensureGitUser()

  const outputFile = path.join(
    process.env.RUNNER_TEMP ?? await realpath(os.tmpdir()),
    `changesets-output-${randomUUID()}.ndjson`,
  )
  const execOptions: ExecOptions = {
    cwd,
    ignoreReturnCode: true,
    env: {
      ...process.env,
      GITEA_TOKEN: git.getToken(),
      CHANGESETS_OUTPUT: outputFile,
    },
  }

  const changesetPublishOutput: ExecOutput = script !== undefined && script !== ''
    ? await getExecOutput(script, undefined, execOptions)
    : await (async (): Promise<ExecOutput> => {
      const args = ['publish']
      if (fromPackDir !== undefined && fromPackDir !== '') {
        args.push('--from-pack-dir', fromPackDir)
      }
      return getExecOutputChangesetsCli(args, execOptions)
    })()

  const { packages, tool } = await getPackages(cwd)
  const packagesByName = new Map(packages.map((x) => [x.packageJson.name, x]))
  const output = await readChangesetsOutput(outputFile).catch((error: unknown): ChangesetsOutputEvent[] => {
    if (script === undefined || script === '' || !(error instanceof ChangesetsOutputReadError)) {
      throw toError(error)
    }
    warning(
      `${error.message}. Gitea releases and git tags cannot be created without this output. Ensure the custom publish script passes CHANGESETS_OUTPUT to the Changesets CLI.`,
    )
    return []
  })
  const releases = output.map((event) => {
    const pkg = packagesByName.get(event.packageName)
    if (pkg === undefined) {
      throw new Error(
        `Package "${event.packageName}" not found.`
        + 'This is probably a bug in the action, please open an issue',
      )
    }
    return { pkg, tag: event.tag }
  })

  if (tool.type === 'root' && packages.length === 0) {
    throw new Error(
      'No package found.'
      + 'This is probably a bug in the action, please open an issue',
    )
  }

  if (createGiteaReleases || pushGitTags) {
    await Promise.all(
      releases.map(async ({ pkg, tag }) => {
        if (pushGitTags) {
          await git.pushTag(tag)
        }
        if (createGiteaReleases) {
          await createRelease(gitea, { pkg, tagName: tag })
        }
      }),
    )
  }

  if (releases.length > 0) {
    return {
      published: true,
      publishedPackages: releases.map(({ pkg }) => ({
        name: pkg.packageJson.name,
        version: pkg.packageJson.version,
      })),
      exitCode: changesetPublishOutput.exitCode,
    }
  }

  return { published: false, exitCode: changesetPublishOutput.exitCode }
}

type GetMessageOptions = {
  hasPublishScript: boolean
  branch: string
  changedPackagesInfo: {
    highestLevel: number
    private: boolean
    content: string
    header: string
  }[]
  prBodyMaxCharacters: number
  preState?: PreState
}

export const getVersionPrBody = ({
  hasPublishScript,
  preState,
  changedPackagesInfo,
  prBodyMaxCharacters,
  branch,
}: GetMessageOptions): string => {
  const messageHeader = `This PR was opened by the [Changesets release](https://github.com/anytinz/changesets-gitea-action) Gitea action. When you're ready to do a release, you can merge this and ${
    hasPublishScript
      ? 'the packages will be published to npm automatically'
      : 'publish to npm yourself or [setup this action to publish automatically](https://github.com/anytinz/changesets-gitea-action#with-publishing)'
  }. If you're not ready to do a release yet, that's fine, whenever you add more changesets to ${branch}, this PR will be updated.
`
  const messagePrestate = preState === undefined
    ? ''
    : `⚠️⚠️⚠️⚠️⚠️⚠️

\`${branch}\` is currently in **pre mode** so this branch has prereleases rather than normal releases. If you want to exit prereleases, run \`changeset pre exit\` on \`${branch}\`.

⚠️⚠️⚠️⚠️⚠️⚠️
`
  const messageReleasesHeading = '# Releases'

  let fullMessage = [
    messageHeader,
    messagePrestate,
    messageReleasesHeading,
    ...changedPackagesInfo.map((pkgInfo) => `${pkgInfo.header}\n\n${pkgInfo.content}`),
  ].join('\n')

  // Check that the message does not exceed the size limit.
  // If not, omit the changelog entries of each package.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      '\n> The changelog information of each package has been omitted from this message, as the content exceeds the size limit.\n',
      ...changedPackagesInfo.map((pkgInfo) => `${pkgInfo.header}\n\n`),
    ].join('\n')
  }

  // Check (again) that the message is within the size limit.
  // If not, omit all release content this time.
  if (fullMessage.length > prBodyMaxCharacters) {
    fullMessage = [
      messageHeader,
      messagePrestate,
      messageReleasesHeading,
      '\n> All release information have been omitted from this message, as the content exceeds the size limit.',
    ].join('\n')
  }

  return fullMessage
}

type VersionOptions = {
  script?: string
  git: Git
  gitea: GiteaClient
  cwd?: string
  prTitle?: string
  commitMessage?: string
  hasPublishScript?: boolean
  prBodyMaxCharacters?: number
  prDraft?: 'always' | 'create'
  branch?: string
}

type RunVersionResult = {
  pullRequestNumber: number
}

// Gitea treats a pull request as a draft when its title starts with one of
// these prefixes (case-insensitive).
const DRAFT_TITLE_PREFIXES = ['wip:', '[wip]', 'draft:', '[draft]'] as const

const isDraftTitle = (title: string): boolean => {
  const lowerTitle = title.toLocaleLowerCase()
  return DRAFT_TITLE_PREFIXES.some((prefix) => lowerTitle.startsWith(prefix))
}

const findPullRequest = async (
  gitea: GiteaClient,
  head: string,
  base: string,
): Promise<{ number?: number | undefined; title?: string | undefined } | undefined> => {
  try {
    const data = getData(await gitea.GET('/repos/{owner}/{repo}/pulls/{base}/{head}', {
      params: {
        path: {
          owner: context.repo.owner,
          repo: context.repo.repo,
          base,
          head,
        },
      },
    }))
    return data
  } catch (error) {
    if (isNotFound(error)) {
      return undefined
    }
    throw error
  }
}

const getPullRequestNumber = (pullRequest: { number?: number | undefined }): number => {
  if (pullRequest.number === undefined) {
    throw new Error('The Gitea API did not return a pull request number')
  }
  return pullRequest.number
}

export const runVersion = async ({
  script,
  git,
  gitea,
  cwd = process.cwd(),
  prTitle = 'Version Packages',
  commitMessage = 'Version Packages',
  hasPublishScript = false,
  prBodyMaxCharacters = MAX_CHARACTERS_PER_MESSAGE,
  branch = context.ref.replace('refs/heads/', ''),
  prDraft,
}: VersionOptions): Promise<RunVersionResult> => {
  const versionBranch = `changeset-release/${branch}`

  const { preState } = await readChangesetState(cwd)

  const versionsByDirectory = await getVersionsByDirectory(cwd)

  const env = { ...process.env, GITEA_TOKEN: git.getToken() }

  await (script !== undefined && script !== '' ? exec(script, undefined, { cwd, env }) : execChangesetsCli(['version'], { cwd, env }))

  const changedPackages = await getChangedPackages(cwd, versionsByDirectory)
  const changedPackagesInfoPromises = Promise.all(
    changedPackages.map(async (pkg) => {
      const changelogContents = await readFile(path.join(pkg.dir, 'CHANGELOG.md'), 'utf8')

      const entry = getChangelogEntry(changelogContents, pkg.packageJson.version)
      return {
        highestLevel: entry.highestLevel,
        private: pkg.packageJson.private === true,
        content: entry.content,
        header: `## ${pkg.packageJson.name}@${pkg.packageJson.version}`,
      }
    }),
  )

  const finalPrTitle = `${prTitle}${preState === undefined ? '' : ` (${preState.tag})`}`
  const finalCommitMessage = `${commitMessage}${preState === undefined ? '' : ` (${preState.tag})`}`

  const existingPullRequest = await findPullRequest(gitea, versionBranch, branch)
  info(`Existing pull request: ${JSON.stringify(existingPullRequest, null, 2)}`)

  await git.pushChanges({
    branch: versionBranch,
    message: finalCommitMessage,
  })

  const changedPackagesInfo = await changedPackagesInfoPromises
  const resolvedChangedPackagesInfo = changedPackagesInfo
    .filter(Boolean)
    .toSorted(sortTheThings)

  const prBody = getVersionPrBody({
    hasPublishScript,
    preState,
    branch,
    changedPackagesInfo: resolvedChangedPackagesInfo,
    prBodyMaxCharacters,
  })

  if (existingPullRequest === undefined) {
    info('creating pull request')
    const newPrTitle = prDraft === undefined ? finalPrTitle : `WIP: ${finalPrTitle}`
    const newPullRequest = getData(await gitea.POST('/repos/{owner}/{repo}/pulls', {
      params: {
        path: {
          owner: context.repo.owner,
          repo: context.repo.repo,
        },
      },
      body: {
        base: branch,
        head: versionBranch,
        title: newPrTitle,
        body: prBody,
      },
    }))

    return {
      pullRequestNumber: getPullRequestNumber(newPullRequest),
    }
  }
  info(`updating found pull request #${existingPullRequest.number}`)
  const updatedPrTitle = prDraft === 'always' || isDraftTitle(existingPullRequest.title ?? '')
    ? `WIP: ${finalPrTitle}`
    : finalPrTitle
  await gitea.PATCH('/repos/{owner}/{repo}/pulls/{index}', {
    params: {
      path: {
        owner: context.repo.owner,
        repo: context.repo.repo,
        index: getPullRequestNumber(existingPullRequest),
      },
    },
    body: {
      title: updatedPrTitle,
      body: prBody,
      state: 'open',
    },
  })

  return {
    pullRequestNumber: getPullRequestNumber(existingPullRequest),
  }
}
