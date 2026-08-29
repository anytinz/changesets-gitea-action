import path from 'node:path'
import process from 'node:process'
import { writeChangeset } from '@changesets/write'
import { createFixture } from 'fs-fixture'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Git } from '@/git'
import { setupGitea } from '@/gitea'
import { runVersion } from '@/run'

vi.mock('@actions/github', () => ({
  context: {
    repo: {
      owner: 'changesets',
      repo: 'action',
    },
    ref: 'refs/heads/some-branch',
    sha: 'xeac7',
  },
}))

type PullRequestData = { number: number; title?: string }
type CreatePullRequestBody = {
  base: string
  body: string
  head: string
  title: string
}
type CreatePullRequestInit = {
  params: {
    path: {
      owner: string
      repo: string
    }
  }
  body: CreatePullRequestBody
}
type EditPullRequestBody = {
  body: string
  state: string
  title: string
}
type EditPullRequestInit = {
  params: {
    path: {
      owner: string
      repo: string
      index: number
    }
  }
  body: EditPullRequestBody
}

const mockedGiteaMethods = vi.hoisted(() => ({
  GET: vi.fn<(url: string, init: Record<string, unknown>) => Promise<{ data: PullRequestData }>>(),
  POST: vi.fn<(url: string, init: CreatePullRequestInit) => Promise<{ data: PullRequestData }>>(),
  PATCH: vi.fn<(url: string, init: EditPullRequestInit) => Promise<{ data: PullRequestData }>>(),
  PUT: vi.fn(),
  DELETE: vi.fn(),
}))

vi.mock('@/gitea.js', async (importOriginal) => ({
  // `import()` is the only way to reference the mocked module's own type here
  // eslint-disable-next-line ts/consistent-type-imports
  ...await importOriginal<typeof import('@/gitea')>(),
  setupGitea: vi.fn(() => mockedGiteaMethods),
}))

vi.mock('@/git.js')

process.env.GITHUB_SERVER_URL = 'https://gitea.example.com'

const nodeModulesDir = path.join(import.meta.dirname, '..', 'node_modules')
const git = (cwd: string): Git => new Git({
  cwd,
  gitea: setupGitea('@@GITEA_TOKEN'),
  giteaToken: '@@GITEA_TOKEN',
})

const createSimpleProjectFixture = async (): Promise<ReturnType<typeof createFixture>> => createFixture({
  node_modules: (api) => api.symlink(nodeModulesDir),
  '.changeset/config.json': JSON.stringify({}),
  'packages/pkg-a/package.json': JSON.stringify({
    name: 'changesets-dev-simple-project-pkg-a',
    version: '1.0.0',
    dependencies: {
      'changesets-dev-simple-project-pkg-b': '1.0.0',
    },
  }),
  'packages/pkg-b/package.json': JSON.stringify({
    name: 'changesets-dev-simple-project-pkg-b',
    version: '1.0.0',
  }),
  'package.json': JSON.stringify({
    name: 'simple-project',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*'],
  }),
  'package-lock.json': '',
})

const createIgnoredPackageFixture = async (): Promise<ReturnType<typeof createFixture>> => createFixture({
  node_modules: (api) => api.symlink(nodeModulesDir),
  '.changeset/config.json': JSON.stringify({
    ignore: ['changesets-dev-ignored-package-pkg-a'],
  }),
  'packages/pkg-a/package.json': JSON.stringify({
    name: 'changesets-dev-ignored-package-pkg-a',
    version: '1.0.0',
    dependencies: {
      'changesets-dev-ignored-package-pkg-b': '1.0.0',
    },
  }),
  'packages/pkg-b/package.json': JSON.stringify({
    name: 'changesets-dev-ignored-package-pkg-b',
    version: '1.0.0',
  }),
  'package.json': JSON.stringify({
    name: 'ignored-package',
    version: '1.0.0',
    private: true,
    workspaces: ['packages/*'],
  }),
  'package-lock.json': '',
})

const writeChangesets = async (
  changesets: Parameters<typeof writeChangeset>[0][],
  cwd: string,
): Promise<unknown[]> => Promise.all(changesets.map(async (changeset) => writeChangeset(changeset, cwd)))

const mockNoExistingPullRequest = (): void => {
  mockedGiteaMethods.GET.mockRejectedValueOnce(
    Object.assign(new Error('not found'), { status: 404 }),
  )
}

const mockCreatePullRequest = (): void => {
  mockedGiteaMethods.POST.mockResolvedValueOnce({
    data: { number: 123 },
  })
}

const getCreatePullRequestCall = (): CreatePullRequestInit => {
  const call = mockedGiteaMethods.POST.mock.calls[0]
  if (call === undefined) {
    throw new Error('POST /repos/{owner}/{repo}/pulls was not called')
  }
  return call[1]
}

const getEditPullRequestCall = (): EditPullRequestInit => {
  const call = mockedGiteaMethods.PATCH.mock.calls[0]
  if (call === undefined) {
    throw new Error('PATCH /repos/{owner}/{repo}/pulls/{index} was not called')
  }
  return call[1]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('version', () => {
  it('creates simple PR', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
            {
              name: 'changesets-dev-simple-project-pkg-b',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
    })

    expect(getCreatePullRequestCall()).toMatchSnapshot()
  })

  it('only includes bumped packages in the PR body', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
    })

    expect(getCreatePullRequestCall()).toMatchSnapshot()
  })

  it("doesn't include ignored package that got a dependency update in the PR body", async () => {
    await using fixture = await createIgnoredPackageFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-ignored-package-pkg-b',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
    })

    expect(getCreatePullRequestCall()).toMatchSnapshot()
  })

  it('does not include changelog entries if full message exceeds size limit', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: `# Non manus superum

## Nec cornibus aequa numinis multo onerosior adde

Lorem markdownum undas consumpserat malas, nec est lupus; memorant gentisque ab
limine auctore. Eatque et promptu deficit, quam videtur aequa est **faciat**,
locus. Potentia deus habebat pia quam qui coniuge frater, tibi habent fertque
viribus. E et cognoscere arcus, lacus aut sic pro crimina fuit tum **auxilium**
dictis, qua, in.

In modo. Nomen illa membra.

> Corpora gratissima parens montibus tum coeperat qua remulus caelum Helenamque?
> Non poenae modulatur Amathunta in concita superi, procerum pariter rapto cornu
> munera. Perrhaebum parvo manus contingere, morari, spes per totiens ut
> dividite proculcat facit, visa.

Adspicit sequitur diffamatamque superi Phoebo qua quin lammina utque: per? Exit
decus aut hac inpia, seducta mirantia extremo. Vidi pedes vetus. Saturnius
fluminis divesque vulnere aquis parce lapsis rabie si visa fulmineis.
`,
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
      prBodyMaxCharacters: 1_000,
    })

    const call = getCreatePullRequestCall()
    expect(call).toMatchSnapshot()
    expect(call.body.body).toMatch(
      /The changelog information of each package has been omitted from this message/u,
    )
  })

  it('does not include any release information if a message with simplified release info exceeds size limit', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: `# Non manus superum

## Nec cornibus aequa numinis multo onerosior adde

Lorem markdownum undas consumpserat malas, nec est lupus; memorant gentisque ab
limine auctore. Eatque et promptu deficit, quam videtur aequa est **faciat**,
locus. Potentia deus habebat pia quam qui coniuge frater, tibi habent fertque
viribus. E et cognoscere arcus, lacus aut sic pro crimina fuit tum **auxilium**
dictis, qua, in.

In modo. Nomen illa membra.

> Corpora gratissima parens montibus tum coeperat qua remulus caelum Helenamque?
> Non poenae modulatur Amathunta in concita superi, procerum pariter rapto cornu
> munera. Perrhaebum parvo manus contingere, morari, spes per totiens ut
> dividite proculcat facit, visa.

Adspicit sequitur diffamatamque superi Phoebo qua quin lammina utque: per? Exit
decus aut hac inpia, seducta mirantia extremo. Vidi pedes vetus. Saturnius
fluminis divesque vulnere aquis parce lapsis rabie si visa fulmineis.
`,
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
      prBodyMaxCharacters: 500,
    })

    const call = getCreatePullRequestCall()
    expect(call).toMatchSnapshot()
    expect(call.body.body).toMatch(
      /All release information have been omitted from this message, as the content exceeds the size limit/u,
    )
  })

  it('updates an existing PR via the API', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockedGiteaMethods.GET.mockResolvedValueOnce({
      data: { number: 123 },
    })

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
    })

    expect(getEditPullRequestCall()).toMatchSnapshot()
  })

  it('creates a draft PR when prDraft is "create"', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockNoExistingPullRequest()
    mockCreatePullRequest()

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
      prDraft: 'create',
    })

    expect(getCreatePullRequestCall().body.title).toBe('WIP: Version Packages')
  })

  it('keeps an existing draft PR as draft when prDraft is "create"', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockedGiteaMethods.GET.mockResolvedValueOnce({
      data: { number: 123, title: 'WIP: Version Packages' },
    })

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
      prDraft: 'create',
    })

    expect(getEditPullRequestCall().body.title).toBe('WIP: Version Packages')
  })

  it('updates an existing PR with prDraft "always"', async () => {
    await using fixture = await createSimpleProjectFixture()
    const cwd = fixture.path

    mockedGiteaMethods.GET.mockResolvedValueOnce({
      data: { number: 123 },
    })

    await writeChangesets(
      [
        {
          releases: [
            {
              name: 'changesets-dev-simple-project-pkg-a',
              type: 'minor',
            },
          ],
          summary: 'Awesome feature',
        },
      ],
      cwd,
    )

    await runVersion({
      gitea: setupGitea('@@GITEA_TOKEN'),
      git: git(cwd),
      cwd,
      prDraft: 'always',
    })

    expect(getEditPullRequestCall().body.state).toBe('open')
    expect(getEditPullRequestCall().body.title).toBe('WIP: Version Packages')
  })
})
