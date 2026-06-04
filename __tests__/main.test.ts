/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * To mock dependencies in ESM, you can create fixtures that export mock
 * functions and objects. For example, the core module is mocked in this test,
 * so that the actual '@actions/core' module is not imported.
 */
import { jest } from '@jest/globals'
import { describe, it, expect, beforeEach } from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as gh from '../__fixtures__/github.js'

// Mocks should be declared before the module being tested is imported.
jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => gh)

// The module being tested should be imported dynamically. This ensures that the
// mocks are used in place of any actual dependencies.
const { run } = await import('../src/main.js')

/** Build a base64-encoded CODEOWNERS content string. */
function b64(content: string): string {
  return Buffer.from(content).toString('base64')
}

const BASE_CODEOWNERS = '*.ts @org/frontend\n* @org/default\n'

describe('main.ts', () => {
  beforeEach(() => {
    jest.resetAllMocks()

    // Default inputs
    core.getInput.mockImplementation((name: string) => {
      switch (name) {
        case 'github-token':
          return 'fake-token'
        case 'codeowners-path':
          return '.github/CODEOWNERS'
        case 'codeowners-contents':
          return ''
        case 'ignore-filepaths':
          return ''
        case 'ignore-authors':
          return ''
        default:
          return ''
      }
    })
    core.getBooleanInput.mockImplementation((name: string) => {
      switch (name) {
        case 'always-succeed-before-approval':
          return true
        default:
          return false
      }
    })

    // Default PR context
    gh.context.payload = {
      pull_request: {
        number: 42,
        user: { login: 'alice' },
        head: { sha: 'deadbeef' }
      }
    }
    // @ts-expect-error - mocking in a test
    gh.context.repo = { owner: 'myorg', repo: 'myrepo' }
  })

  it('skips check when not a pull_request event', async () => {
    gh.context.payload = {}
    gh.getOctokit.mockReturnValue(gh.buildMockOctokit())

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Not a pull request')
    )
  })

  it('skips check when there are no approvals', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ data: [] })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('No approvals found')
    )
  })

  it('skips check when author is in ignore-authors', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'github-token') return 'fake-token'
      if (name === 'ignore-authors') return 'alice'
      return ''
    })

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('ignore-authors')
    )
  })

  it('skips check when all changed files are ignored', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'github-token') return 'fake-token'
      if (name === 'ignore-filepaths') return 'dist/**'
      return ''
    })

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'dist/bundle.js' }]
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('ignore-filepaths')
    )
  })

  it('skips check when CODEOWNERS file is not found', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/foo.ts' }]
        }),
        getContent: jest
          .fn<() => Promise<unknown>>()
          .mockRejectedValue(new Error('Not Found'))
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch CODEOWNERS file')
    )
  })

  it('skips check when CODEOWNERS file is empty', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/foo.ts' }]
        }),
        getContent: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ data: { content: '', encoding: 'base64' } })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS file is empty')
    )
  })

  it('passes when approver satisfies CODEOWNERS requirement', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: { content: b64('*.ts @frontend-dev\n'), encoding: 'base64' }
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
    )
  })

  it('fails when no participant satisfies CODEOWNERS requirement', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64(BASE_CODEOWNERS),
            encoding: 'base64'
          }
        })
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('src/app.ts')
    )
  })

  it('passes when the PR author is themselves an owner', async () => {
    // alice is the PR author (set in beforeEach) and also the owner
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64('*.ts @alice\n'),
            encoding: 'base64'
          }
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
  })

  it('handles a setFailed error from the GitHub client', async () => {
    gh.getOctokit.mockImplementation(() => {
      throw new Error('Bad credentials')
    })

    await run()

    expect(core.setFailed).toHaveBeenCalledWith('Bad credentials')
  })

  it('passes when a team member approves and the owner is a team', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'team-member' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64('*.ts @myorg/frontend\n'),
            encoding: 'base64'
          }
        }),
        listMembersInOrg: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ login: 'team-member' }, { login: 'other-member' }]
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
    )
  })

  it('fails when the approver is not a member of the required team', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'outsider' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64('*.ts @myorg/frontend\n'),
            encoding: 'base64'
          }
        }),
        listMembersInOrg: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ login: 'team-member' }]
        })
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('src/app.ts')
    )
  })

  it('fails when the required team does not exist or cannot be fetched', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'approver' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64('*.ts @myorg/nonexistent-team\n'),
            encoding: 'base64'
          }
        }),
        listMembersInOrg: jest
          .fn<() => Promise<unknown>>()
          .mockRejectedValue(new Error('Not Found'))
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('src/app.ts')
    )
  })

  it('calls listMembersInOrg only once per team across multiple files', async () => {
    const listMembersInOrg = jest
      .fn<() => Promise<unknown>>()
      .mockResolvedValue({ data: [{ login: 'team-member' }] })

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'team-member' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [
            { filename: 'src/a.ts' },
            { filename: 'src/b.ts' },
            { filename: 'src/c.ts' }
          ]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64('*.ts @myorg/frontend\n'),
            encoding: 'base64'
          }
        }),
        listMembersInOrg
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(listMembersInOrg).toHaveBeenCalledTimes(1)
  })

  it('fails when always-succeed-before-approval is false and no approvals exist', async () => {
    core.getBooleanInput.mockImplementation((name: string) => {
      if (name === 'always-succeed-before-approval') return false
      return false
    })

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ data: [] }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: {
            content: b64(BASE_CODEOWNERS),
            encoding: 'base64'
          }
        })
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('src/app.ts')
    )
  })

  it('skips check when always-succeed-before-approval is true (default) and no approvals exist', async () => {
    // default mock already sets always-succeed-before-approval to true
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ data: [] })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('No approvals found')
    )
  })

  it('uses codeowners-contents instead of fetching from the API', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'github-token') return 'fake-token'
      if (name === 'codeowners-contents') return '*.ts @frontend-dev\n'
      return ''
    })

    const getContent = jest.fn<() => Promise<unknown>>()

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent
      })
    )

    await run()

    expect(getContent).not.toHaveBeenCalled()
    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
    )
  })

  it('fails via codeowners-contents when no participant satisfies requirements', async () => {
    core.getInput.mockImplementation((name: string) => {
      if (name === 'github-token') return 'fake-token'
      if (name === 'codeowners-contents') return '*.ts @required-owner\n'
      return ''
    })

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'other-user' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        })
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('src/app.ts')
    )
  })

  describe('status-check-name', () => {
    const STATUS_CHECK_NAME = 'codeowners-check'

    let createCommitStatus: jest.Mock<() => Promise<unknown>>

    beforeEach(() => {
      createCommitStatus = jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({})
    })

    function withStatusCheck(
      base: (name: string) => string
    ): (name: string) => string {
      return (name: string) => {
        if (name === 'status-check-name') return STATUS_CHECK_NAME
        return base(name)
      }
    }

    it('does not post a status check when status-check-name is not set', async () => {
      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/app.ts' }]
          }),
          getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: { content: b64('*.ts @frontend-dev\n'), encoding: 'base64' }
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).not.toHaveBeenCalled()
    })

    it('does not post a status check when skipping due to no approvals and always-succeed-before-approval is true', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ data: [] }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining('No approvals found')
      )
      expect(createCommitStatus).not.toHaveBeenCalled()
    })

    it('posts a success status when check passes', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/app.ts' }]
          }),
          getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: { content: b64('*.ts @frontend-dev\n'), encoding: 'base64' }
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'myorg',
          repo: 'myrepo',
          sha: 'deadbeef',
          state: 'success',
          context: STATUS_CHECK_NAME
        })
      )
    })

    it('posts a success status when author is in ignore-authors', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          if (name === 'ignore-authors') return 'alice'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'success', context: STATUS_CHECK_NAME })
      )
    })

    it('posts a success status when all changed files are ignored', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          if (name === 'ignore-filepaths') return 'dist/**'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'dist/bundle.js' }]
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'success', context: STATUS_CHECK_NAME })
      )
    })

    it('posts a success status when CODEOWNERS file is empty', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/foo.ts' }]
          }),
          getContent: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ data: { content: '', encoding: 'base64' } }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'success', context: STATUS_CHECK_NAME })
      )
    })

    it('does not post a status when the check fails', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          return ''
        })
      )

      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/app.ts' }]
          }),
          getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: {
              content: b64(BASE_CODEOWNERS),
              encoding: 'base64'
            }
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalled()
      expect(createCommitStatus).not.toHaveBeenCalled()
    })
  })
})
