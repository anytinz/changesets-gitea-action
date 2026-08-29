import { readFile, realpath } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import artifact from '@actions/artifact'
import { setFailed, setOutput } from '@actions/core'
import { readChangesetState } from '@/read-changeset-state'
import {
  execChangesetsCli,
  getErrorMessage,
  getOptionalInput,
  getProcessEnv,
  validateChangesetsCliVersion,
} from '@/utils'

type ModeResult = | {
  mode: 'none'
}
| {
  mode: 'version'
}
| {
  mode: 'publish'
  publishPlanPath: string
}

type PublishPlan = unknown[]

const parseJson = (raw: string): unknown => JSON.parse(raw)

const readPublishPlan = async (publishPlanPath: string): Promise<PublishPlan> => {
  const rawPlan = await readFile(publishPlanPath, 'utf8')

  const plan = parseJson(rawPlan)

  if (
    typeof plan !== 'object'
    || plan === null
    || !('version' in plan)
    || typeof plan.version !== 'number'
    || !('plan' in plan)
    || !Array.isArray(plan.plan)
  ) {
    throw new Error(
      `Invalid publish plan at ${publishPlanPath}: expected { version: number; plan: unknown[] }`,
    )
  }
  return plan.plan as unknown[]
}

const getMode = async (cwd: string): Promise<ModeResult> => {
  const { changesets } = await readChangesetState(cwd)

  if (changesets.length > 0) {
    const hasNonEmptyChangesets = changesets.some(
      (changeset) => changeset.releases.length > 0,
    )
    if (hasNonEmptyChangesets) {
      return { mode: 'version' }
    }
    return { mode: 'none' }
  }

  const publishPlanPath = path.join(
    process.env.RUNNER_TEMP ?? await realpath(os.tmpdir()),
    `changeset-publish-plan-${Date.now()}`,
    // we need a stable filename here (in a unique dirname) so the artifact download can find this cleanly
    'publish-plan.json',
  )
  await execChangesetsCli(['publish-plan', '--output', publishPlanPath], {
    cwd,
    env: getProcessEnv(),
  })

  const publishPlan = await readPublishPlan(publishPlanPath)
  if (publishPlan.length === 0) {
    return { mode: 'none' }
  }

  return {
    mode: 'publish',
    publishPlanPath,
  }
}

const main = async (): Promise<void> => {
  const cwd = getOptionalInput('cwd') ?? process.cwd()
  await validateChangesetsCliVersion(cwd)

  const result = await getMode(cwd)
  setOutput('mode', result.mode)
  if (result.mode === 'publish') {
    const publishPlanArtifact = await artifact.uploadArtifact(
      path.basename(result.publishPlanPath, '.json'),
      [result.publishPlanPath],
      path.dirname(result.publishPlanPath),
      {
        skipArchive: true,
        retentionDays: 30,
      },
    )
    if (publishPlanArtifact.id === undefined) {
      throw new Error(
        'Publish plan artifact upload did not return an artifact id',
      )
    }
    setOutput('publish-plan-artifact-id', String(publishPlanArtifact.id))
  }
}

try {
  await main()
} catch (error) {
  setFailed(getErrorMessage(error))
}
