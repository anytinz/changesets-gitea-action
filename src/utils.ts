import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import artifact from '@actions/artifact'
import { getInput } from '@actions/core'
import {
  exec,
  getExecOutput,

} from '@actions/exec'
import { getPackages } from '@manypkg/get-packages'
import major from 'semver/functions/major.js'
import subset from 'semver/ranges/subset.js'
import type { ExecOptions, ExecOutput } from '@actions/exec'
import type { Package } from '@manypkg/get-packages'

const require = createRequire(import.meta.url)

export const BumpLevels = {
  dep: 0,
  patch: 1,
  minor: 2,
  major: 3,
} as const

export const getVersionsByDirectory = async (
  cwd: string,
): Promise<Map<string, string>> => {
  const { packages } = await getPackages(cwd)
  return new Map(packages.map((x) => [x.dir, x.packageJson.version]))
}

export const getChangedPackages = async (
  cwd: string,
  previousVersions: Map<string, string>,
): Promise<Package[]> => {
  const { packages } = await getPackages(cwd)
  const changedPackages = new Set<Package>()

  packages.forEach((pkg) => {
    const previousVersion = previousVersions.get(pkg.dir)
    if (previousVersion !== pkg.packageJson.version) {
      changedPackages.add(pkg)
    }
  })

  return [...changedPackages]
}

export const getChangelogEntry = (
  changelog: string,
  version: string,
): { content: string; highestLevel: number } => {
  let highestLevel: number = BumpLevels.dep
  let headingStartIndex = -1
  let headingStartDepth = 0
  let endIndex = -1

  // Iterate through each headings and code blocks (for skipping its contents)
  const regex = /^(?<heading>#{1,6})\s(?<headingText>.*)$|^(?<codeFence>`{3,})/gmu
  let match: RegExpExecArray | null = regex.exec(changelog)
  while (match !== null) {
    const codeFence = match.groups?.codeFence
    if (codeFence === undefined) {
      const headingDepth = match.groups?.heading?.length ?? 0
      const headingText = match.groups?.headingText?.trim() ?? ''

      // Search for the highest bump level in the entire changelog
      const levelName = /(?<level>major|minor|patch)/u
        .exec(headingText.toLowerCase())
        ?.groups?.level
      if (levelName === 'major' || levelName === 'minor' || levelName === 'patch') {
        highestLevel = Math.max(BumpLevels[levelName], highestLevel)
      }

      // Search for heading of the entry
      if (headingText === version) {
        headingStartIndex = regex.lastIndex
        headingStartDepth = headingDepth
      } else if (headingStartIndex !== -1 && headingDepth === headingStartDepth) {
        // If we've found the entry heading, search for the closing heading with the same depth
        endIndex = match.index
        break
      }
    } else {
      // Skip over code blocks so we don't match any headings inside of them
      const endOfCodeBlockRegex = new RegExp(`^${codeFence}`, 'gmu')
      endOfCodeBlockRegex.lastIndex = regex.lastIndex
      const endMatch = endOfCodeBlockRegex.exec(changelog)
      if (endMatch === null) {
        // Can't find end of code block, probably malformed
        break
      } else {
        // Start next search for headings after the end of the code block
        regex.lastIndex = endOfCodeBlockRegex.lastIndex
      }
    }

    match = regex.exec(changelog)
  }

  return {
    content: changelog
      .slice(headingStartIndex === -1 ? undefined : headingStartIndex, endIndex === -1 ? undefined : endIndex)
      .trim(),
    highestLevel,
  }
}

export const sortTheThings = (
  a: { private: boolean; highestLevel: number },
  b: { private: boolean; highestLevel: number },
): number => {
  if (a.private === b.private) {
    return b.highestLevel - a.highestLevel
  }
  if (a.private) {
    return 1
  }
  return -1
}

export const getErrorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export const isErrorWithCode = (err: unknown, code: string): boolean => typeof err === 'object'
  && err !== null
  && 'code' in err
  && err.code === code

export const getProcessEnv = (): Record<string, string> => {
  const env: Record<string, string> = {}
  Object.entries(process.env).forEach(([key, value]) => {
    if (value !== undefined) {
      env[key] = value
    }
  })
  return env
}

export const getOptionalInput = (name: string): string | undefined => getInput(name) || undefined

export const getRequiredInput = (name: string): string => getInput(name, { required: true })

export const throwOnRenamedInputs = (renames: Record<string, string>): void => {
  const references: Record<string, string> = {}

  Object.entries(renames).forEach(([oldInput, newInput]) => {
    if (getInput(oldInput) !== '') {
      references[oldInput] = newInput
    }
  })

  if (Object.keys(references).length > 0) {
    const list = Object.entries(references)
      .map(([oldInput, newInput]) => `- "${oldInput}" -> "${newInput}"`)
      .join('\n')
    throw new Error(
      `The following inputs have been renamed:\n${list}\nPlease update your workflow file.`,
    )
  }
}

const changesetsCliCompatibilityError = 'This version of the Changesets action is designed to work with Changesets CLI v3. '
  + 'Changesets CLI v2 is not supported; use Changesets action v1 instead, which is compatible with CLI v2.'
const parseJson = (raw: string): unknown => JSON.parse(raw)

export const validateChangesetsCliVersion = async (cwd: string): Promise<void> => {
  const { rootPackage } = await getPackages(cwd)
  const packageJson = rootPackage?.packageJson
  const declaredVersion = packageJson?.devDependencies?.['@changesets/cli']
    ?? packageJson?.dependencies?.['@changesets/cli']
  if (typeof declaredVersion === 'string') {
    const range = declaredVersion.startsWith('workspace:')
      ? declaredVersion.slice('workspace:'.length)
      : declaredVersion

    let isV2 = false

    try {
      isV2 = subset(range, '>=2.0.0-0 <3.0.0-0', {
        includePrerelease: true,
      })
    } catch {
      // it could be a non-semver protocol
    }

    if (isV2) {
      throw new Error(changesetsCliCompatibilityError)
    }
  }

  const cliPackageJson = await (async (): Promise<unknown> => {
    try {
      const cliPackageJsonPath = require.resolve('@changesets/cli/package.json', {
        paths: [cwd],
      })
      return parseJson(await readFile(cliPackageJsonPath, 'utf8'))
    } catch {
      return undefined
    }
  })()

  if (cliPackageJson !== undefined
    && typeof cliPackageJson === 'object'
    && cliPackageJson !== null
    && 'version' in cliPackageJson
    && typeof cliPackageJson.version === 'string'
    && major(cliPackageJson.version) === 2
  ) {
    throw new Error(changesetsCliCompatibilityError)
  }
}

const resolveChangesetsCli = (cwd: string): string => require.resolve('@changesets/cli/bin.js', {
  paths: [cwd],
})

export const execChangesetsCli = async (
  args: string[],
  options?: ExecOptions,
): Promise<number> => exec(
  'node',
  [resolveChangesetsCli(options?.cwd ?? process.cwd()), ...args],
  options,
)

export const getExecOutputChangesetsCli = async (
  args: string[],
  options?: ExecOptions,
): Promise<ExecOutput> => getExecOutput(
  'node',
  [resolveChangesetsCli(options?.cwd ?? process.cwd()), ...args],
  options,
)

export const downloadArtifact = async (
  tmpDir: string,
  artifactId: number,
  name: string,
): Promise<string> => {
  if (!Number.isInteger(artifactId) || artifactId <= 0) {
    throw new Error(
      `Invalid ${JSON.stringify(name)} artifact id: ${artifactId}`,
    )
  }

  const downloadPath = path.join(tmpDir, `${name}-${artifactId}-${Date.now()}`)
  const result = await artifact.downloadArtifact(artifactId, {
    path: downloadPath,
  })

  if (result.downloadPath === undefined || result.downloadPath === '') {
    throw new Error(
      `${JSON.stringify(name)} artifact download did not return a path for artifact ${artifactId}`,
    )
  }

  return result.downloadPath
}
