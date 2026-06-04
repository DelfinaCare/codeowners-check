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
