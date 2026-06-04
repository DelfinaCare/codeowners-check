import type * as gh from '@actions/github'
import { jest } from '@jest/globals'

type Octokit = ReturnType<typeof gh.getOctokit>

export const getOctokit = jest.fn<typeof gh.getOctokit>()

export const context: typeof gh.context = {
  payload: {},
  eventName: 'pull_request',
  sha: 'abc123',
  ref: 'refs/heads/main',
  workflow: 'CI',
  action: 'run',
  actor: 'testuser',
  job: 'test',
  runNumber: 1,
  runId: 1,
  apiUrl: 'https://api.github.com',
  serverUrl: 'https://github.com',
  graphqlUrl: 'https://api.github.com/graphql',
  issue: { owner: 'owner', repo: 'repo', number: 1 },
  repo: { owner: 'owner', repo: 'repo' }
} as typeof gh.context

/** Helper to build a minimal mock Octokit for tests. */
export function buildMockOctokit(overrides?: {
  listReviews?: jest.Mock
  listFiles?: jest.Mock
  getContent?: jest.Mock
  listMembersInOrg?: jest.Mock
  createCommitStatus?: jest.Mock
}): Octokit {
  const restMocks = {
    pulls: {
      listReviews:
        overrides?.listReviews ??
        jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: [] }),
      listFiles:
        overrides?.listFiles ??
        jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: [] })
    },
    repos: {
      getContent:
        overrides?.getContent ??
        jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: {} }),
      createCommitStatus:
        overrides?.createCommitStatus ??
        jest.fn<() => Promise<unknown>>().mockResolvedValue({})
    },
    teams: {
      listMembersInOrg:
        overrides?.listMembersInOrg ??
        jest.fn<() => Promise<unknown>>().mockResolvedValue({ data: [] })
    }
  }
  async function* iteratorImpl(
    fn: unknown,
    params: unknown
  ): AsyncGenerator<{ data: unknown[] }> {
    const result = await (fn as (p: unknown) => Promise<{ data: unknown[] }>)(
      params
    )
    yield result
  }

  const paginateFn = Object.assign(
    jest
      .fn<(fn: unknown, params: unknown) => Promise<unknown[]>>()
      .mockImplementation(
        async (fn: unknown, params: unknown): Promise<unknown[]> => {
          const result = await (
            fn as (p: unknown) => Promise<{ data: unknown[] }>
          )(params)
          return result.data
        }
      ),
    {
      iterator: jest
        .fn<
          (fn: unknown, params: unknown) => AsyncGenerator<{ data: unknown[] }>
        >()
        .mockImplementation(iteratorImpl)
    }
  )

  return {
    rest: restMocks,
    paginate: paginateFn
  } as unknown as Octokit
}
