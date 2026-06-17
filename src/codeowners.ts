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

// Cache compiled regexes so the same pattern is only translated once.
const patternRegexCache = new Map<string, RegExp | null>()

/**
 * Checks whether a file path matches a CODEOWNERS pattern.
 *
 * CODEOWNERS patterns follow .gitignore rules:
 * - A pattern without an interior slash (e.g. `*.ts`, `build/`) matches anywhere
 *   in the tree (as if it were prefixed with `**` /).
 * - A pattern with a leading slash is anchored to the repo root.
 * - A pattern with an interior slash but no leading slash is also anchored.
 * - A pattern ending in `/` matches the directory and everything beneath it.
 * - `**` matches any number of path segments.
 * - A standalone `*` segment matches exactly one path segment (it does not match
 *   across `/`) and, unlike a literal segment, does not implicitly match the
 *   directory's descendants.
 * - A literal (or partially-wildcarded) final segment also matches everything
 *   beneath it, so `src/api` matches `src/api/handler.ts`.
 *
 * @param filePath The file path relative to the repo root.
 * @param pattern  The CODEOWNERS pattern.
 * @returns True if the file matches the pattern.
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Normalise the file path: strip leading slash if present
  const normalised = filePath.startsWith('/') ? filePath.slice(1) : filePath

  const regex = patternToRegExp(pattern)
  if (!regex) return false
  return regex.test(normalised)
}

/**
 * Translates a CODEOWNERS (gitignore-style) pattern into an anchored regular
 * expression following the same semantics GitHub uses to resolve code owners.
 *
 * @param pattern The CODEOWNERS pattern.
 * @returns A compiled RegExp, or null when the pattern matches nothing.
 */
function patternToRegExp(pattern: string): RegExp | null {
  if (patternRegexCache.has(pattern)) return patternRegexCache.get(pattern)!

  const compiled = buildRegExp(pattern)
  patternRegexCache.set(pattern, compiled)
  return compiled
}

function buildRegExp(pattern: string): RegExp | null {
  // "/" on its own matches nothing.
  if (pattern === '' || pattern === '/') return null

  let segments = pattern.split('/')

  if (segments[0] === '') {
    // Leading slash: the pattern is anchored to the repository root.
    segments = segments.slice(1)
  } else if (
    segments.length === 1 ||
    (segments.length === 2 && segments[1] === '')
  ) {
    // No leading slash and a single segment (e.g. `*.ts` or `build/`): the
    // pattern may match at any depth, equivalent to a leading `**/`.
    if (segments[0] !== '**') {
      segments = ['**', ...segments]
    }
  }

  // A trailing slash is equivalent to a trailing `/**` (directory contents).
  if (segments.length > 1 && segments[segments.length - 1] === '') {
    segments[segments.length - 1] = '**'
  }

  const sep = '/'
  const lastIndex = segments.length - 1
  let needSep = false
  let re = '^'

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    if (seg === '**') {
      if (i === 0 && i === lastIndex) {
        re += '.+'
      } else if (i === 0) {
        re += `(?:.+${sep})?`
        needSep = false
      } else if (i === lastIndex) {
        re += `${sep}.*`
      } else {
        re += `(?:${sep}.+)?`
        needSep = true
      }
    } else if (seg === '*') {
      if (needSep) re += sep
      // A standalone wildcard segment matches exactly one path segment.
      re += `[^${sep}]+`
      needSep = true
    } else {
      if (needSep) re += sep
      re += translateSegment(seg)
      if (i === lastIndex) {
        // A literal/partial final segment also matches its descendants.
        re += `(?:${sep}.*)?`
      }
      needSep = true
    }
  }

  re += '$'
  return new RegExp(re)
}

/**
 * Translates a single non-`**`, non-standalone-`*` pattern segment into a regex
 * fragment, honouring `*` (any run of non-separator characters) and `?` (a
 * single non-separator character) wildcards.
 */
function translateSegment(seg: string): string {
  let out = ''
  for (const ch of seg) {
    if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  return out
}
