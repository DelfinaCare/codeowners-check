import * as core from '@actions/core'
import * as github from '@actions/github'
import { parseCodeowners, getOwnersForFile } from './codeowners.js'

/**
 * Splits a comma-or-newline-separated input string into a trimmed list of
 * non-empty tokens.
 */
function splitInput(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Returns true when `filePath` matches any of the provided ignore patterns.
 */
async function isIgnored(
  filePath: string,
  ignorePatterns: string[]
): Promise<boolean> {
  if (ignorePatterns.length === 0) return false
  const { minimatch } = await import('minimatch')
  return ignorePatterns.some((pat) =>
    minimatch(filePath, pat, { dot: true, matchBase: true })
  )
}

/**
 * Posts a commit status to the PR head SHA when a status check name has been
 * configured. No-ops when statusCheckName is empty/whitespace or when octokit
 * is not yet available (early failure before the client was created).
 */
async function setCommitStatus(
  octokit: ReturnType<typeof github.getOctokit> | undefined,
  owner: string,
  repo: string,
  sha: string,
  statusCheckName: string,
  state: 'success' | 'failure',
  description: string
): Promise<void> {
  if (!statusCheckName.trim() || !octokit) return
  await octokit.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state,
    context: statusCheckName,
    description
  })
}

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  // Declared outside the try block so that the catch clause can still post a
  // failure commit status even when an unexpected error is thrown mid-run.
  let octokitForCatch: ReturnType<typeof github.getOctokit> | undefined
  let statusOwner = ''
  let statusRepo = ''
  let statusHeadSha = ''
  let statusCheckName = ''

  try {
    const token = core.getInput('github-token', { required: true })
    const codeownersPath =
      core.getInput('codeowners-path') || '.github/CODEOWNERS'
    const codeownersContents = core.getInput('codeowners-contents')
    const ignoreFilepaths = splitInput(core.getInput('ignore-filepaths'))
    const ignoreAuthors = splitInput(core.getInput('ignore-authors'))
    const alwaysSucceedBeforeApproval = core.getBooleanInput(
      'always-succeed-before-approval'
    )
    statusCheckName = core.getInput('status-check-name')

    const octokit = github.getOctokit(token)
    octokitForCatch = octokit
    const { context } = github

    if (!context.payload.pull_request) {
      core.info('Not a pull request event — skipping CODEOWNERS check.')
      return
    }

    const prNumber = context.payload.pull_request.number
    const owner = context.repo.owner
    const repo = context.repo.repo
    const prAuthor: string = context.payload.pull_request.user.login
    const headSha: string = context.payload.pull_request.head.sha

    // Populate the status context variables as soon as we have them so the
    // catch clause can use them if an error is thrown later.
    statusOwner = owner
    statusRepo = repo
    statusHeadSha = headSha

    core.info(`PR #${prNumber} — author: ${prAuthor}, head SHA: ${headSha}`)

    // 1. Read current PR approvals — exit success if none exist
    // Build set of users who have an APPROVED review (most-recent per user)
    const latestReviewByUser = new Map<string, string>()
    for await (const { data: reviews } of octokit.paginate.iterator(
      octokit.rest.pulls.listReviews,
      { owner, repo, pull_number: prNumber, per_page: 100 }
    )) {
      for (const review of reviews) {
        if (review.user?.login) {
          latestReviewByUser.set(review.user.login, review.state)
        }
      }
    }
    const approvers = new Set<string>(
      [...latestReviewByUser.entries()]
        .filter(([, state]) => state === 'APPROVED')
        .map(([login]) => login)
    )

    const changesRequestedBy = new Set<string>(
      [...latestReviewByUser.entries()]
        .filter(([, state]) => state === 'CHANGES_REQUESTED')
        .map(([login]) => login)
    )

    if (approvers.size === 0 && changesRequestedBy.size === 0) {
      if (alwaysSucceedBeforeApproval) {
        core.info('No approvals found — skipping CODEOWNERS check.')
        return
      }
      core.debug(
        'No approvals found but alwaysSucceedBeforeApproval is false — continuing CODEOWNERS check.'
      )
    }

    core.info(`Approvers: ${[...approvers].join(', ')}`)
    if (changesRequestedBy.size > 0) {
      core.info(`Changes requested by: ${[...changesRequestedBy].join(', ')}`)
    }

    // 2. Exit success if the PR author is in ignore-authors
    if (ignoreAuthors.includes(prAuthor)) {
      core.info(
        `Author "${prAuthor}" is in ignore-authors — CODEOWNERS check passes.`
      )
      await setCommitStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusCheckName,
        'success',
        'CODEOWNERS check passed (author in ignore-authors)'
      )
      return
    }

    // 3. Read changed files; exit success if all are in ignore-filepaths
    const changedFiles: string[] = []
    for await (const { data: files } of octokit.paginate.iterator(
      octokit.rest.pulls.listFiles,
      { owner, repo, pull_number: prNumber, per_page: 100 }
    )) {
      for (const f of files) {
        changedFiles.push(f.filename)
      }
    }
    core.info(`Changed files: ${changedFiles.join(', ')}`)

    const relevantFiles: string[] = []
    for (const file of changedFiles) {
      if (!(await isIgnored(file, ignoreFilepaths))) {
        relevantFiles.push(file)
      }
    }

    if (relevantFiles.length === 0) {
      core.info(
        'All changed files are in ignore-filepaths — CODEOWNERS check passes.'
      )
      await setCommitStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusCheckName,
        'success',
        'CODEOWNERS check passed (all files ignored)'
      )
      return
    }

    // 4. Read CODEOWNERS — use provided contents or fetch from the PR head SHA
    let codeownersContent: string
    if (codeownersContents) {
      codeownersContent = codeownersContents
      core.info(
        'Using provided CODEOWNERS contents instead of fetching from head.'
      )
    } else {
      try {
        const response = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: codeownersPath,
          ref: headSha
        })
        const data = response.data as { content?: string; encoding?: string }
        if (!data.content) {
          core.info('CODEOWNERS file is empty — CODEOWNERS check passes.')
          await setCommitStatus(
            octokit,
            owner,
            repo,
            headSha,
            statusCheckName,
            'success',
            'CODEOWNERS check passed (empty CODEOWNERS file)'
          )
          return
        }
        codeownersContent = Buffer.from(data.content, 'base64').toString('utf8')
      } catch (error: unknown) {
        const message = `Failed to fetch CODEOWNERS file at "${codeownersPath}" with error: ${errorToString(error)}`
        core.setFailed(message)
        await setCommitStatus(
          octokit,
          owner,
          repo,
          headSha,
          statusCheckName,
          'failure',
          'Failed to fetch CODEOWNERS file'
        )
        return
      }
    }

    const entries = parseCodeowners(codeownersContent)
    core.debug(`Parsed ${entries.length} CODEOWNERS entries.`)

    // 5. Evaluate each relevant file against CODEOWNERS
    const participants = new Set<string>([prAuthor, ...approvers])
    const failures: { file: string; requiredOwners: string[] }[] = []
    // Cache team membership lookups so the same team is only fetched once
    const teamMembersCache = new Map<string, Set<string> | null>()

    const getTeamMembers = async (
      teamOrg: string,
      teamSlug: string
    ): Promise<Set<string> | null> => {
      const cacheKey = `${teamOrg}/${teamSlug}`
      if (teamMembersCache.has(cacheKey)) {
        return teamMembersCache.get(cacheKey)!
      }
      try {
        const logins = new Set<string>()
        for await (const { data: members } of octokit.paginate.iterator(
          octokit.rest.teams.listMembersInOrg,
          { org: teamOrg, team_slug: teamSlug, per_page: 100 }
        )) {
          for (const m of members) {
            logins.add(m.login)
          }
        }
        teamMembersCache.set(cacheKey, logins)
        return logins
      } catch (error: unknown) {
        // Team not found or insufficient permissions — treat as not satisfied
        core.error(
          `Could not fetch members for team "${cacheKey}" with error ${errorToString(error)}`
        )
        teamMembersCache.set(cacheKey, null)
        return null
      }
    }

    for (const file of relevantFiles) {
      const owners = getOwnersForFile(file, entries)
      if (owners.length === 0) {
        // No owners required — file passes
        continue
      }

      // At least one required owner must be a participant AND no required owner
      // may have an outstanding CHANGES_REQUESTED review.
      let satisfied = false
      let blockedByChangesRequested = false
      for (const ownerEntry of owners) {
        const stripped = ownerEntry.startsWith('@')
          ? ownerEntry.slice(1)
          : ownerEntry
        if (stripped.includes('/')) {
          // Team entry: org/team-slug
          const slashIndex = stripped.indexOf('/')
          const teamOrg = stripped.slice(0, slashIndex)
          const teamSlug = stripped.slice(slashIndex + 1)
          const teamLogins = await getTeamMembers(teamOrg, teamSlug)
          if (teamLogins) {
            if ([...changesRequestedBy].some((u) => teamLogins.has(u))) {
              const blocker =
                [...changesRequestedBy].find((u) => teamLogins.has(u)) ??
                'unknown member'
              core.debug(
                `File "${file}" blocked by CHANGES_REQUESTED from ${blocker} in "${teamOrg}/${teamSlug}".`
              )
              blockedByChangesRequested = true
            } else if ([...participants].some((p) => teamLogins.has(p))) {
              const member =
                [...participants].find((p) => teamLogins.has(p)) ??
                'unknown member'
              core.debug(
                `File "${file}" approved by owner ${member} in "${teamOrg}/${teamSlug}".`
              )
              satisfied = true
            }
          }
        } else {
          if (changesRequestedBy.has(stripped)) {
            core.debug(
              `File "${file}" blocked by CHANGES_REQUESTED from "${ownerEntry}".`
            )
            blockedByChangesRequested = true
          } else if (participants.has(stripped)) {
            core.debug(`File "${file}" approved by owner "${ownerEntry}".`)
            satisfied = true
          }
        }
      }

      if (!satisfied || blockedByChangesRequested) {
        failures.push({ file, requiredOwners: owners })
      }
    }

    // 6. Fail with per-file owner details when requirements are not met
    if (failures.length > 0) {
      const lines = failures.map(
        ({ file, requiredOwners }) =>
          `  ${file}: requires approval from ${requiredOwners.join(' or ')}`
      )
      core.setFailed(
        `CODEOWNERS check failed. The following files need approval:\n${lines.join('\n')}`
      )
      await setCommitStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusCheckName,
        'failure',
        'CODEOWNERS check failed'
      )
    } else {
      core.info('CODEOWNERS check passed.')
      await setCommitStatus(
        octokit,
        owner,
        repo,
        headSha,
        statusCheckName,
        'success',
        'CODEOWNERS check passed'
      )
    }
  } catch (error: unknown) {
    core.setFailed(errorToString(error))
    await setCommitStatus(
      octokitForCatch,
      statusOwner,
      statusRepo,
      statusHeadSha,
      statusCheckName,
      'failure',
      'CODEOWNERS check encountered an unexpected error'
    )
  }
}
