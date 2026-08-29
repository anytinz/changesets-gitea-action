import { readdir, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import artifact from '@actions/artifact'
import { setFailed, setOutput } from '@actions/core'
import {
  downloadArtifact,
  execChangesetsCli,
  getErrorMessage,
  getOptionalInput,
  getProcessEnv,
  validateChangesetsCliVersion,
} from '@/utils'

const pack = async (
  cwd: string,
  args: {
    outDir: string
    publishPlanPath?: string
  },
): Promise<void> => {
  const cliArgs = ['pack', '--out-dir', args.outDir]
  if (args.publishPlanPath !== undefined) {
    cliArgs.push('--from-publish-plan', args.publishPlanPath)
  }

  await execChangesetsCli(cliArgs, {
    cwd,
    env: getProcessEnv(),
  })
}

const downloadPublishPlanArtifact = async (tmpDir: string, artifactId: number): Promise<string> => {
  const downloadPath = await downloadArtifact(
    tmpDir,
    artifactId,
    'changeset-publish-plan',
  )
  return path.join(downloadPath, 'publish-plan.json')
}

const getFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        return getFiles(entryPath)
      }
      return [entryPath]
    }),
  )
  return files.flat()
}

const main = async (): Promise<void> => {
  const cwd = getOptionalInput('cwd') ?? process.cwd()
  await validateChangesetsCliVersion(cwd)

  const publishPlanArtifactId = getOptionalInput('publish-plan-artifact-id')

  const tmpDir = process.env.RUNNER_TEMP ?? await realpath(os.tmpdir())
  const outDir = path.join(tmpDir, `changeset-pack-${Date.now()}`)

  await pack(cwd, {
    outDir,
    publishPlanPath: publishPlanArtifactId === undefined
      ? undefined
      : await downloadPublishPlanArtifact(tmpDir, Number(publishPlanArtifactId)),
  })

  const packDirArtifact = await artifact.uploadArtifact(
    `changeset-pack-${Date.now()}`,
    await getFiles(outDir),
    outDir,
    {
      retentionDays: 30,
    },
  )
  if (packDirArtifact.id === undefined) {
    throw new Error('Packed artifact upload did not return an artifact id')
  }
  setOutput('pack-dir-artifact-id', String(packDirArtifact.id))
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
