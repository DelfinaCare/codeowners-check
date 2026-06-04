import { minimatch } from 'minimatch'

export interface CodeownersEntry {
  pattern: string
  owners: string[]
}

/**
 * Parses the content of a CODEOWNERS file into an array of entries.
 *
 * @param content The raw text content of the CODEOWNERS file.
 * @returns An array of pattern/owner entries (last match wins, per GitHub docs).
 */
export function parseCodeowners(content: string): CodeownersEntry[] {
  const entries: CodeownersEntry[] = []

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) continue

    const parts = trimmed.split(/\s+/)
    const pattern = parts[0]
    const owners = parts.slice(1)

    entries.push({ pattern, owners })
  }

  return entries
}

/**
 * Returns the owners for a given file path according to CODEOWNERS rules.
 * GitHub uses the last matching rule, so we iterate in reverse.
 *
 * @param filePath The file path to look up (relative to repo root, no leading slash).
 * @param entries  Parsed CODEOWNERS entries.
 * @returns The list of owners for the file, or an empty array if unowned.
 */
export function getOwnersForFile(
  filePath: string,
  entries: CodeownersEntry[]
): string[] {
  // Iterate in reverse order — last match wins
  for (let i = entries.length - 1; i >= 0; i--) {
    const { pattern, owners } = entries[i]
    if (matchesPattern(filePath, pattern)) {
      return owners
    }
  }
  return []
}

/**
 * Checks whether a file path matches a CODEOWNERS pattern.
 *
 * CODEOWNERS patterns follow .gitignore rules:
 * - A pattern without a slash (except trailing) matches anywhere in the tree.
 * - A pattern with a leading slash is anchored to the repo root.
 * - A pattern with an interior slash but no leading slash is also anchored.
 * - `**` matches any number of path segments.
 * - `*` matches within a single segment (no `/`).
 *
 * @param filePath The file path relative to the repo root.
 * @param pattern  The CODEOWNERS pattern.
 * @returns True if the file matches the pattern.
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalise the file path: strip leading slash if present
  const normalised = filePath.startsWith('/') ? filePath.slice(1) : filePath

  // Patterns that contain a slash (other than a purely trailing one) are
  // anchored to the root, per .gitignore / CODEOWNERS semantics.
  const hasInteriorSlash = pattern.includes('/') && !pattern.match(/^[^/]*\/$/)

  const opts = { dot: true, matchBase: !hasInteriorSlash }

  // Strip leading slash from the pattern before passing to minimatch
  const normPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern

  // A pattern that ends with "/" matches the directory and everything inside
  if (normPattern.endsWith('/')) {
    const dirPattern = normPattern + '**'
    return minimatch(normalised, dirPattern, opts)
  }

  if (minimatch(normalised, normPattern, opts)) return true

  // Also match everything inside a matched directory (pattern matches both
  // the directory itself and its contents, similar to gitignore behaviour).
  return minimatch(normalised, normPattern + '/**', opts)
}
