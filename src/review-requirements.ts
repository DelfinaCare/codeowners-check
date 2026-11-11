import { matchesPattern } from './codeowners.js'

/**
 * A file changed by a pull request. Carries the diff so that policies can
 * decide requirements based on the code change itself, not just the path.
 */
export interface ChangedFile {
  filename: string
  patch?: string
}

/** Pull-request-level information available to every policy. */
export interface ReviewRequirementContext {
  author: string
}

/**
 * Decides the minimum number of (non-author) approving reviewers a single
 * changed file needs. Returning `undefined` means the policy has no opinion and
 * the next policy is consulted.
 */
export type MinReviewersPolicy = (
  file: ChangedFile,
  context: ReviewRequirementContext
) => number | undefined

export interface MinReviewersRule {
  pattern: string
  minReviewers: number
}

/** Placeholder in rule patterns that is replaced by the PR author's login. */
export const AUTHOR_PLACEHOLDER = '{author}'

/**
 * Parses minimum-reviewer rules. Each non-empty, non-comment line has the form
 * `<pattern> <count>`, where `<pattern>` uses CODEOWNERS syntax and `<count>` is
 * a non-negative integer.
 *
 * @param content The raw rules text.
 * @returns The parsed rules, in file order (last match wins).
 * @throws When a line is malformed.
 */
export function parseMinReviewersRules(content: string): MinReviewersRule[] {
  const rules: MinReviewersRule[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const parts = trimmed.split(/\s+/)
    if (parts.length !== 2) {
      throw new Error(
        `Invalid min-reviewers rule "${trimmed}": expected "<pattern> <count>".`
      )
    }
    rules.push({ pattern: parts[0], minReviewers: parseCount(parts[1]) })
  }

  return rules
}

/**
 * Parses a non-negative integer reviewer count.
 *
 * @throws When the value is not a non-negative integer.
 */
export function parseCount(value: string): number {
  if (!/^\d+$/.test(value.trim())) {
    throw new Error(
      `Invalid minimum reviewer count "${value}": expected a non-negative integer.`
    )
  }
  return Number(value.trim())
}

/**
 * Builds a policy from path rules. As with CODEOWNERS, the last matching rule
 * wins. `{author}` in a pattern is replaced with the PR author's login, so a
 * rule like `/experimental/{author}/ 0` only applies to the author's own folder.
 */
export function createPathPolicy(
  rules: MinReviewersRule[]
): MinReviewersPolicy {
  return (file, context) => {
    for (let i = rules.length - 1; i >= 0; i--) {
      const pattern = rules[i].pattern
        .split(AUTHOR_PLACEHOLDER)
        .join(context.author)
      if (matchesPattern(file.filename, pattern)) {
        return rules[i].minReviewers
      }
    }
    return undefined
  }
}

/**
 * Resolves the minimum number of approving reviewers for a file. Policies are
 * consulted in order and the first one with an opinion wins; if none has an
 * opinion, `defaultMinReviewers` applies.
 */
export function getMinReviewersForFile(
  file: ChangedFile,
  context: ReviewRequirementContext,
  policies: MinReviewersPolicy[],
  defaultMinReviewers: number
): number {
  for (const policy of policies) {
    const result = policy(file, context)
    if (result !== undefined) return result
  }
  return defaultMinReviewers
}
