import process from 'node:process'
import { warning } from '@actions/core'
import createClient from 'openapi-fetch'
import type { Client } from 'openapi-fetch'
import type { paths } from '@/generated/gitea-schema'

/**
 * The Gitea instance URL. Gitea Actions sets the `GITHUB_SERVER_URL`
 * environment variable to the instance URL, see
 * https://docs.gitea.com/1.27/usage/actions/actions-variables/.
 */
export const getGiteaServerUrl = (): string => {
  const serverUrl = process.env.GITHUB_SERVER_URL
  if (serverUrl === undefined) {
    throw new Error(
      'Please set the GITHUB_SERVER_URL environment variable, e.g. https://gitea.example.com',
    )
  }
  return serverUrl
}

export const isNotFound = (error: unknown): boolean => typeof error === 'object'
  && error !== null
  && 'status' in error
  && error.status === 404

/**
 * The generated client types every response as `{ data, error, response }`,
 * even though the configured `fetch` throws on non-2xx responses. This helper
 * returns the response payload, so callers can narrow the union type.
 */
export const getData = <T extends { data?: unknown }>(result: T): NonNullable<T['data']> => {
  const data = result.data
  if (data === undefined) {
    throw new Error('Gitea API request failed without response data')
  }
  // eslint-disable-next-line ts/no-unsafe-type-assertion -- only reached when `data` is defined
  return data as unknown as NonNullable<T['data']>
}

const MAX_ERROR_BODY_CHARS = 1_000

/**
 * Formats a response body for inclusion in an error message. JSON error
 * bodies produced by the Gitea API expose their `message` field; anything
 * else (e.g. HTML error pages from a reverse proxy) is truncated.
 */
const getErrorMessage = (errorBody: string | undefined): string | undefined => {
  if (errorBody === undefined) {
    return undefined
  }
  try {
    const parsed = JSON.parse(errorBody) as unknown
    if (typeof parsed === 'object' && parsed !== null && 'message' in parsed) {
      const message = (parsed as { message: unknown }).message
      if (typeof message === 'string' && message !== '') {
        return message
      }
    }
  } catch {
    // fall through to the raw body
  }
  const trimmed = errorBody.trim()
  if (trimmed === '') {
    return undefined
  }
  return trimmed.length <= MAX_ERROR_BODY_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_ERROR_BODY_CHARS)}…`
}

class GiteaRequestError extends Error {
  public readonly status: number

  public readonly method: string

  public readonly url: string

  public readonly responseBody: string | undefined

  public constructor(input: Request, response: Response, responseBody: string | undefined) {
    const detail = getErrorMessage(responseBody)
    const message = [
      `Gitea API request failed: ${input.method} ${input.url} -> ${response.status}`,
      response.statusText,
      detail,
    ]
      .filter((part): part is string => part !== undefined && part !== '')
      .join(' ')
    super(message)
    this.name = 'GiteaRequestError'
    this.status = response.status
    this.method = input.method
    this.url = input.url
    this.responseBody = responseBody
  }
}

const sleep = async (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

const RATE_LIMIT_RETRIES = 2

const isRateLimitResponse = (response: Response): boolean => response.status === 429

/**
 * The generated client never throws on non-2xx responses, it returns
 * `{ data, error, response }` instead. To keep the request/response semantics
 * of the previous SDK (throwing on errors), the custom fetch below:
 *
 * 1. retries requests that are rate limited (HTTP 429) a few times,
 * 2. throws a `GiteaRequestError` for any other non-2xx response.
 */
const fetchWithRateLimitRetry = async (input: Request): Promise<Response> => {
  const attempt = async (retryCount: number): Promise<Response> => {
    const response = await fetch(input.clone())
    if (isRateLimitResponse(response) && retryCount < RATE_LIMIT_RETRIES) {
      const retryAfter = Number(response.headers.get('retry-after')) || 1

      warning(
        `Rate limit detected for request ${input.method} ${input.url}`,
      )
      await sleep(retryAfter * 1_000)

      return attempt(retryCount + 1)
    }
    return response
  }

  const response = await attempt(0)
  if (response.ok) {
    return response
  }

  const errorBody = await response.text().catch(() => undefined)
  throw new GiteaRequestError(input, response, errorBody)
}

export const setupGitea = (giteaToken: string): Client<paths> => createClient<paths>({
  baseUrl: getGiteaServerUrl(),
  headers: {
    Authorization: `token ${giteaToken}`,
  },
  fetch: fetchWithRateLimitRetry,
})

export type GiteaClient = ReturnType<typeof setupGitea>
