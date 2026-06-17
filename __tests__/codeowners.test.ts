/**
 * Unit tests for src/codeowners.ts
 */
import { describe, it, expect } from '@jest/globals'
import { parseCodeowners, getOwnersForFile } from '../src/codeowners.js'

describe('parseCodeowners', () => {
  it('parses basic entries', () => {
    const content = `
# comment
*.ts @org/frontend
/docs/ @org/docs @alice
`
    const entries = parseCodeowners(content)
    expect(entries).toEqual([
      { pattern: '*.ts', owners: ['@org/frontend'] },
      { pattern: '/docs/', owners: ['@org/docs', '@alice'] }
    ])
  })

  it('ignores empty lines and comments', () => {
    const entries = parseCodeowners('# just a comment\n\n')
    expect(entries).toHaveLength(0)
  })

  it('handles entries with no owners', () => {
    const entries = parseCodeowners('unowned-file.txt')
    expect(entries).toEqual([{ pattern: 'unowned-file.txt', owners: [] }])
  })
})

describe('getOwnersForFile', () => {
  const entries = parseCodeowners(`
* @org/default
*.ts @org/frontend
/docs/**  @org/docs
src/api/ @org/backend
  `)

  it('returns owners for an exact pattern match', () => {
    expect(getOwnersForFile('README.md', entries)).toEqual(['@org/default'])
  })

  it('last matching rule wins', () => {
    // *.ts overrides * for TypeScript files
    expect(getOwnersForFile('src/foo.ts', entries)).toEqual(['@org/frontend'])
  })

  it('matches directory patterns', () => {
    expect(getOwnersForFile('docs/guide.md', entries)).toEqual(['@org/docs'])
  })

  it('matches nested files under a directory rule', () => {
    expect(getOwnersForFile('src/api/handler.ts', entries)).toEqual([
      '@org/backend'
    ])
  })

  it('returns empty array when no rule matches', () => {
    const emptyEntries = parseCodeowners('')
    expect(getOwnersForFile('anything.txt', emptyEntries)).toEqual([])
  })
})

describe('getOwnersForFile pattern semantics', () => {
  it('a standalone "*" segment does not match across directories', () => {
    const entries = parseCodeowners('apps/* @org/apps')
    // Direct children match...
    expect(getOwnersForFile('apps/main.ts', entries)).toEqual(['@org/apps'])
    // ...but nested files do not (a single "*" cannot cross a "/").
    expect(getOwnersForFile('apps/nested/main.ts', entries)).toEqual([])
  })

  it('a "*" catch-all matches files at any depth', () => {
    const entries = parseCodeowners('* @org/default')
    expect(getOwnersForFile('a/b/c/deep.ts', entries)).toEqual(['@org/default'])
  })

  it('an extension pattern matches at any depth', () => {
    const entries = parseCodeowners('*.ts @org/frontend')
    expect(getOwnersForFile('src/a/b/foo.ts', entries)).toEqual([
      '@org/frontend'
    ])
  })

  it('an unanchored directory pattern matches that directory anywhere', () => {
    const entries = parseCodeowners('build/ @org/build')
    expect(getOwnersForFile('build/out.o', entries)).toEqual(['@org/build'])
    expect(getOwnersForFile('packages/x/build/out.o', entries)).toEqual([
      '@org/build'
    ])
  })

  it('a leading-slash pattern is anchored to the repository root', () => {
    const entries = parseCodeowners('/docs/ @org/docs')
    expect(getOwnersForFile('docs/guide.md', entries)).toEqual(['@org/docs'])
    expect(getOwnersForFile('pkg/docs/guide.md', entries)).toEqual([])
  })

  it('a literal final segment also matches its descendants', () => {
    const entries = parseCodeowners('src/api @org/backend')
    expect(getOwnersForFile('src/api', entries)).toEqual(['@org/backend'])
    expect(getOwnersForFile('src/api/handler.ts', entries)).toEqual([
      '@org/backend'
    ])
  })

  it('a "**/dir" pattern matches the directory at any depth', () => {
    const entries = parseCodeowners('**/logs @org/ops')
    expect(getOwnersForFile('build/logs/error.log', entries)).toEqual([
      '@org/ops'
    ])
    expect(getOwnersForFile('a/b/logs/error.log', entries)).toEqual([
      '@org/ops'
    ])
  })

  it('a standalone "**" pattern matches every file', () => {
    const entries = parseCodeowners('** @org/all')
    expect(getOwnersForFile('a/b/c.txt', entries)).toEqual(['@org/all'])
    expect(getOwnersForFile('top.txt', entries)).toEqual(['@org/all'])
  })

  it('an interior "**" matches zero or more intermediate segments', () => {
    const entries = parseCodeowners('/src/**/test.ts @org/qa')
    expect(getOwnersForFile('src/test.ts', entries)).toEqual(['@org/qa'])
    expect(getOwnersForFile('src/a/b/test.ts', entries)).toEqual(['@org/qa'])
    expect(getOwnersForFile('src/a/b/other.ts', entries)).toEqual([])
  })

  it('the "?" wildcard matches a single non-separator character', () => {
    const entries = parseCodeowners('/file?.ts @org/x')
    expect(getOwnersForFile('fileA.ts', entries)).toEqual(['@org/x'])
    expect(getOwnersForFile('file.ts', entries)).toEqual([])
    expect(getOwnersForFile('file/.ts', entries)).toEqual([])
  })
})
