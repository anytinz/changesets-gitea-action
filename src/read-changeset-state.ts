import process from 'node:process'
import { readPreState } from '@changesets/pre'
import { readChangesets } from '@changesets/read'
import type { NewChangeset, PreState } from '@changesets/types'

export type ChangesetState = {
  preState: PreState | undefined
  changesets: NewChangeset[]
}

export const readChangesetState = async (
  cwd: string = process.cwd(),
): Promise<ChangesetState> => {
  const preState = await readPreState(cwd)
  const changesets = await readChangesets(cwd)

  if (preState?.mode === 'pre') {
    return {
      preState,
      changesets: changesets.filter(
        (changeset) => !changeset.id.startsWith('pre/'),
      ),
    }
  }

  return {
    preState: undefined,
    changesets,
  }
}
