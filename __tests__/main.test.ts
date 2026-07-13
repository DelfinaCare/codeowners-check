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

  it('skips check when all changed files are in an ignored subdirectory', async () => {
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
          data: [{ filename: 'dist/nested/deep/bundle.js' }]
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
          .mockResolvedValue({ data: '' })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS file is empty')
    )
  })

  it('fails when the CODEOWNERS path resolves to a directory', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/foo.ts' }]
        }),
        // With the raw accept header, GitHub returns a 422 error for directory paths.
        getContent: jest
          .fn<() => Promise<unknown>>()
          .mockRejectedValue(new Error('422 Unprocessable Entity'))
      })
    )

    await run()

    expect(core.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch CODEOWNERS file')
    )
  })

  it('succeeds when the CODEOWNERS file is larger than 1 MB', async () => {
    // With the raw accept header, files up to 100 MB are returned as raw strings.
    const largeCODEOWNERS = '*.ts @frontend-dev\n'.repeat(60_000)

    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/foo.ts' }]
        }),
        getContent: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ data: largeCODEOWNERS })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
    )
  })

  it('matches owners case-insensitively', async () => {
    // The approver's canonical login is lower-case "frontend-dev" but the
    // CODEOWNERS file references "@Frontend-Dev".
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: '*.ts @Frontend-Dev\n'
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
    )
  })

  it('matches team membership case-insensitively', async () => {
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ user: { login: 'Team-Member' }, state: 'APPROVED' }]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: '*.ts @MyOrg/Frontend\n'
        }),
        listMembersInOrg: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ login: 'team-member' }]
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
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
          data: '*.ts @frontend-dev\n'
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
          data: BASE_CODEOWNERS
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
          data: '*.ts @alice\n'
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
          data: '*.ts @myorg/frontend\n'
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
          data: '*.ts @myorg/frontend\n'
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
          data: '*.ts @myorg/nonexistent-team\n'
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
          data: '*.ts @myorg/frontend\n'
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
          data: BASE_CODEOWNERS
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

  it('preserves APPROVED state when a later COMMENTED review would otherwise clobber it', async () => {
    // GitHub returns reviews in reverse-chronological order (newest first).
    // approver first submitted APPROVED, then added a comment (COMMENTED).
    // The COMMENTED review must not overwrite the APPROVED state in the map.
    gh.getOctokit.mockReturnValue(
      gh.buildMockOctokit({
        listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [
            { user: { login: 'frontend-dev' }, state: 'COMMENTED' },
            { user: { login: 'frontend-dev' }, state: 'APPROVED' }
          ]
        }),
        listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: [{ filename: 'src/app.ts' }]
        }),
        getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          data: '*.ts @frontend-dev\n'
        })
      })
    )

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('CODEOWNERS check passed')
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
            data: '*.ts @frontend-dev\n'
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
            data: '*.ts @frontend-dev\n'
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
        expect.objectContaining({
          state: 'success',
          context: STATUS_CHECK_NAME
        })
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
        expect.objectContaining({
          state: 'success',
          context: STATUS_CHECK_NAME
        })
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
            .mockResolvedValue({ data: '' }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'success',
          context: STATUS_CHECK_NAME
        })
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
            data: BASE_CODEOWNERS
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalled()
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failure',
          context: STATUS_CHECK_NAME
        })
      )
    })

    it('posts a failure status when CODEOWNERS check fails', async () => {
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
            data: BASE_CODEOWNERS
          }),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('src/app.ts')
      )
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: 'myorg',
          repo: 'myrepo',
          sha: 'deadbeef',
          state: 'failure',
          context: STATUS_CHECK_NAME
        })
      )
    })

    it('posts a failure status when CODEOWNERS file cannot be fetched', async () => {
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
            .mockRejectedValue(new Error('Not Found')),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch CODEOWNERS file')
      )
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failure',
          context: STATUS_CHECK_NAME
        })
      )
    })

    it('posts a failure status on unexpected errors when context is available', async () => {
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
            .mockRejectedValue(new Error('Network failure')),
          createCommitStatus
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('Network failure')
      expect(createCommitStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'failure',
          context: STATUS_CHECK_NAME
        })
      )
    })

    it('does not post a failure status on unexpected errors when context is not yet available', async () => {
      core.getInput.mockImplementation(
        withStatusCheck((name) => {
          if (name === 'github-token') return 'fake-token'
          return ''
        })
      )

      gh.getOctokit.mockImplementation(() => {
        throw new Error('Bad credentials')
      })

      const createCommitStatus = jest.fn<() => Promise<unknown>>()
      // (createCommitStatus won't be wired since getOctokit throws before
      // buildMockOctokit is even called, but we verify it is never invoked)

      await run()

      expect(core.setFailed).toHaveBeenCalledWith('Bad credentials')
      expect(createCommitStatus).not.toHaveBeenCalled()
    })
  })

  describe('files-missing-approver output', () => {
    it('sets output to an empty array when the check passes', async () => {
      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'frontend-dev' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/app.ts' }]
          }),
          getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: '*.ts @frontend-dev\n'
          })
        })
      )

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })

    it('sets output to the list of failing files when the check fails', async () => {
      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ user: { login: 'bob' }, state: 'APPROVED' }]
          }),
          listFiles: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: [{ filename: 'src/app.ts' }, { filename: 'src/utils.ts' }]
          }),
          getContent: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            data: BASE_CODEOWNERS
          })
        })
      )

      await run()

      expect(core.setFailed).toHaveBeenCalled()
      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify(['src/app.ts', 'src/utils.ts'])
      )
    })

    it('sets output to an empty array when not a pull request event', async () => {
      gh.context.payload = {}
      gh.getOctokit.mockReturnValue(gh.buildMockOctokit())

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })

    it('sets output to an empty array when skipping due to no approvals', async () => {
      gh.getOctokit.mockReturnValue(
        gh.buildMockOctokit({
          listReviews: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ data: [] })
        })
      )

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })

    it('sets output to an empty array when author is in ignore-authors', async () => {
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

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })

    it('sets output to an empty array when all changed files are ignored', async () => {
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

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })

    it('sets output to an empty array when the CODEOWNERS file is empty', async () => {
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
            .mockResolvedValue({ data: '' })
        })
      )

      await run()

      expect(core.setOutput).toHaveBeenCalledWith(
        'files-missing-approver',
        JSON.stringify([])
      )
    })
  })
})
