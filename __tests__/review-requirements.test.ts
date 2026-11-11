/**
 * Unit tests for src/review-requirements.ts
 */
import { describe, it, expect } from '@jest/globals'
import {
  createPathPolicy,
  getMinReviewersForFile,
  parseCount,
  parseMinReviewersRules,
  type MinReviewersPolicy
} from '../src/review-requirements.js'

const ctx = { author: 'alice' }

describe('parseMinReviewersRules', () => {
  it('parses rules, skipping blank lines and comments', () => {
    const rules = parseMinReviewersRules(
      '# comment\n\n/experimental/ 0\n  *.md   1  \n'
    )
    expect(rules).toEqual([
      { pattern: '/experimental/', minReviewers: 0 },
      { pattern: '*.md', minReviewers: 1 }
    ])
  })

  it('returns no rules for empty input', () => {
    expect(parseMinReviewersRules('')).toEqual([])
  })

  it('rejects lines without a count', () => {
    expect(() => parseMinReviewersRules('/experimental/')).toThrow(
      'Invalid min-reviewers rule'
    )
  })

  it('rejects lines with extra tokens', () => {
    expect(() => parseMinReviewersRules('/a/ 1 2')).toThrow(
      'Invalid min-reviewers rule'
    )
  })

  it('rejects non-integer counts', () => {
    expect(() => parseMinReviewersRules('/a/ -1')).toThrow(
      'Invalid minimum reviewer count'
    )
    expect(() => parseMinReviewersRules('/a/ 1.5')).toThrow(
      'Invalid minimum reviewer count'
    )
    expect(() => parseMinReviewersRules('/a/ two')).toThrow(
      'Invalid minimum reviewer count'
    )
  })
})

describe('parseCount', () => {
  it('parses non-negative integers', () => {
    expect(parseCount('0')).toBe(0)
    expect(parseCount(' 2 ')).toBe(2)
  })

  it('rejects empty values', () => {
    expect(() => parseCount('')).toThrow('Invalid minimum reviewer count')
  })
})

describe('createPathPolicy', () => {
  it('returns undefined when no rule matches', () => {
    const policy = createPathPolicy(parseMinReviewersRules('/docs/ 0'))
    expect(policy({ filename: 'src/a.ts' }, ctx)).toBeUndefined()
  })

  it('uses the last matching rule', () => {
    const policy = createPathPolicy(
      parseMinReviewersRules('* 1\n/experimental/ 0\n/experimental/shared/ 2')
    )
    expect(policy({ filename: 'src/a.ts' }, ctx)).toBe(1)
    expect(policy({ filename: 'experimental/x/a.py' }, ctx)).toBe(0)
    expect(policy({ filename: 'experimental/shared/a.py' }, ctx)).toBe(2)
  })

  it('substitutes {author} with the PR author', () => {
    const policy = createPathPolicy(
      parseMinReviewersRules('/experimental/{author}/ 0')
    )
    expect(policy({ filename: 'experimental/alice/a.py' }, ctx)).toBe(0)
    expect(policy({ filename: 'experimental/bob/a.py' }, ctx)).toBeUndefined()
    expect(
      policy({ filename: 'experimental/bob/a.py' }, { author: 'bob' })
    ).toBe(0)
  })
})

describe('getMinReviewersForFile', () => {
  it('falls back to the default when no policy has an opinion', () => {
    expect(getMinReviewersForFile({ filename: 'a.ts' }, ctx, [], 1)).toBe(1)
    const noOpinion: MinReviewersPolicy = () => undefined
    expect(
      getMinReviewersForFile({ filename: 'a.ts' }, ctx, [noOpinion], 2)
    ).toBe(2)
  })

  it('uses the first policy with an opinion', () => {
    const diffPolicy: MinReviewersPolicy = (file) =>
      file.patch?.includes('DROP TABLE') ? 2 : undefined
    const pathPolicy = createPathPolicy(parseMinReviewersRules('* 0'))
    const policies = [diffPolicy, pathPolicy]

    expect(
      getMinReviewersForFile(
        { filename: 'a.sql', patch: '+DROP TABLE x' },
        ctx,
        policies,
        1
      )
    ).toBe(2)
    expect(
      getMinReviewersForFile(
        { filename: 'a.sql', patch: '+SELECT 1' },
        ctx,
        policies,
        1
      )
    ).toBe(0)
  })
})
