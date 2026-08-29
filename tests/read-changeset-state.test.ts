import { createFixture } from 'fs-fixture'
import { describe, expect, it } from 'vitest'
import { readChangesetState } from '@/read-changeset-state'
import { withTestScope } from './test-utils.js'

const changeset = `\
---
"pkg-a": patch
---

Fix a bug.
`

describe('readChangesetState', () => {
  it('filters versioned changesets in prerelease mode', async () => {
    await withTestScope(async (add) => {
      const fixture = add(
        await createFixture({
          '.changeset/pre.json': JSON.stringify({ mode: 'pre', tag: 'next' }),
          '.changeset/pre/versioned.md': changeset,
          '.changeset/pending.md': changeset,
        }),
        async (f) => f.rm(),
      )

      const state = await readChangesetState(fixture.path)

      expect(state.changesets.map((cs) => cs.id)).toEqual([
        'pending',
      ])
    })
  })
  it('includes versioned changesets when exiting prerelease mode', async () => {
    await withTestScope(async (add) => {
      const fixture = add(
        await createFixture({
          '.changeset/pre.json': JSON.stringify({ mode: 'exit', tag: 'next' }),
          '.changeset/pre/versioned.md': changeset,
        }),
        async (f) => f.rm(),
      )

      const state = await readChangesetState(fixture.path)

      expect(state.preState).toBeUndefined()
      expect(state.changesets.map((cs) => cs.id)).toEqual([
        'pre/versioned',
      ])
    })
  })
})
