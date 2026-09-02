import http from 'node:http'
import process from 'node:process'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getGiteaApiUrl, isNotFound, setupGitea } from '@/gitea'
import type { AddressInfo } from 'node:net'

const listen = async (server: http.Server): Promise<http.Server> => {
  const waiter = Promise.withResolvers<undefined>()
  server.on('listening', waiter.resolve)
  server.on('error', waiter.reject)
  server.listen(0)
  try {
    await waiter.promise
    return server
  } finally {
    server.off('listening', waiter.resolve)
    server.off('error', waiter.reject)
  }
}

const createTestServer = async (
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
): Promise<{ url: string; close: () => Promise<void> }> => {
  const server = http.createServer(handler)
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Failed to get the test server address')
  }
  const { port }: AddressInfo = address
  return {
    url: `http://127.0.0.1:${port}`,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}

const previousServerUrl = process.env.GITHUB_SERVER_URL

const restoreServerUrl = (): void => {
  if (previousServerUrl === undefined) {
    delete process.env.GITHUB_SERVER_URL
  } else {
    process.env.GITHUB_SERVER_URL = previousServerUrl
  }
}

const getRequestError = async (promise: Promise<unknown>): Promise<Error> => {
  try {
    await promise
  } catch (error: unknown) {
    if (error instanceof Error) {
      return error
    }
    return new Error(String(error))
  }
  throw new Error('expected the request to fail')
}

describe('getGiteaApiUrl', () => {
  beforeEach(() => {
    delete process.env.GITHUB_SERVER_URL
  })

  afterEach(restoreServerUrl)

  it('throws when GITHUB_SERVER_URL is not set', () => {
    expect(() => getGiteaApiUrl()).toThrow('GITHUB_SERVER_URL')
  })

  it('appends the /api/v1 prefix to the instance URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://gitea.example.com'
    expect(getGiteaApiUrl()).toBe('https://gitea.example.com/api/v1')
  })

  it('strips a trailing slash from the instance URL', () => {
    process.env.GITHUB_SERVER_URL = 'https://gitea.example.com/'
    expect(getGiteaApiUrl()).toBe('https://gitea.example.com/api/v1')
  })
})

describe('setupGitea', () => {
  beforeEach(() => {
    delete process.env.GITHUB_SERVER_URL
  })

  afterEach(restoreServerUrl)

  it('requests the API path with the /api/v1 prefix', async () => {
    const received: string[] = []
    const server = await createTestServer((request, response) => {
      received.push(`${request.method} ${request.url}`)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"id":1}')
    })
    process.env.GITHUB_SERVER_URL = server.url
    try {
      const gitea = setupGitea('token')
      await gitea.GET('/repos/{owner}/{repo}/branches/{branch}', {
        params: {
          path: { owner: 'owner', repo: 'repo', branch: 'feature/x' },
        },
      })
      expect(received[0]).toContain('/api/v1/repos/owner/repo/branches/feature%2Fx')
      expect(received[0]?.slice(0, 4)).toBe('GET ')
    } finally {
      await server.close()
    }
  })

  it('throws an error with method, url, status and response body', async () => {
    const server = await createTestServer((_request, response) => {
      response.writeHead(404, { 'content-type': 'text/html' })
      response.end('<html>404 Not Found</html>')
    })
    process.env.GITHUB_SERVER_URL = server.url
    try {
      const gitea = setupGitea('token')
      const error = await getRequestError(
        gitea.GET('/repos/{owner}/{repo}/branches/{branch}', {
          params: {
            path: { owner: 'owner', repo: 'repo', branch: 'feature/x' },
          },
        }),
      )
      expect(error.message).toContain('GET')
      expect(error.message).toContain('/api/v1/repos/owner/repo/branches/feature%2Fx')
      expect(error.message).toContain('404')
      expect(error.message).toContain('<html>404 Not Found</html>')
      expect(isNotFound(error)).toBe(true)
    } finally {
      await server.close()
    }
  })

  it('uses the response message of JSON error bodies', async () => {
    const server = await createTestServer((_request, response) => {
      response.writeHead(422, { 'content-type': 'application/json' })
      response.end('{"message":"the branch already exists","url":"https://gitea.example.com/api/swagger"}')
    })
    process.env.GITHUB_SERVER_URL = server.url
    try {
      const gitea = setupGitea('token')
      const error = await getRequestError(
        gitea.GET('/repos/{owner}/{repo}/branches/{branch}', {
          params: {
            path: { owner: 'owner', repo: 'repo', branch: 'feature/x' },
          },
        }),
      )
      expect(error.message).toContain('422')
      expect(error.message).toContain('the branch already exists')
      expect(isNotFound(error)).toBe(false)
    } finally {
      await server.close()
    }
  })
})
