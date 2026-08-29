export type PullRequestContext = {
  number: number
  title: string
  head: {
    ref: string
    sha: string
    repo: RepoContext
  }
  base: {
    ref: string
    repo: RepoContext
  }
}

type RepoContext = {
  name: string
  html_url: string
  clone_url: string
  owner: {
    login: string
  }
}

export const isPullRequestContext = (value: unknown): value is PullRequestContext => typeof value === 'object'
  && value !== null
  && 'base' in value
  && 'head' in value
  && 'number' in value
  && 'title' in value
