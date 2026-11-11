# Codeowners-check

A GitHub Action that validates CODEOWNERS approval requirements for pull
requests while counting the PR author as an eligible owner.

![Linter](https://github.com/DelfinaCare/codeowners-check/actions/workflows/linter.yml/badge.svg)
![CI](https://github.com/DelfinaCare/codeowners-check/actions/workflows/ci.yml/badge.svg)
![Check dist/](https://github.com/DelfinaCare/codeowners-check/actions/workflows/check-dist.yml/badge.svg)
![CodeQL](https://github.com/DelfinaCare/codeowners-check/actions/workflows/codeql-analysis.yml/badge.svg)
![Coverage](./badges/coverage.svg)

## Inputs

- `github-token`: (default `${{ .github.token }}`) GitHub token used to read PR
  details, reviews, and file contents. Defaults to the token provided by the
  Actions runner.
- `codeowners-path`: (default `.github/CODEOWNERS`) Path to the CODEOWNERS file
  in the repository. The file is fetched from the PR head SHA.
- `codeowners-contents`: Raw CODEOWNERS file contents to use instead of fetching
  the file from the repository. When provided, `codeowners-path` is ignored.
- `ignore-filepaths`: Comma- or newline-separated list of file paths or glob
  patterns where CODEOWNERS rules should be ignored.
- `ignore-authors`: Comma- or newline-separated list of PR authors for which the
  CODEOWNERS check should be skipped entirely.
- `always-succeed-before-approval`: (default `'true'`) When true, the action
  exits successfully if the PR has no approvals yet, even if the CODEOWNERS
  check would otherwise have failed. This avoids spurious CI failures while a PR
  is still awaiting its first review. Most workflows already enforce at least
  one approval via branch protection, making this safe to leave enabled.
- `status-check-name`: When set, the action posts a commit status with this name
  to the PR head SHA on every real outcome (success or failure), except when
  exiting early because there are no approvals yet and
  `always-succeed-before-approval` is true. Set this to the same string you use
  as a **required status check** in your branch protection rules so that the
  protection requirement is satisfied or blocked based on the CODEOWNERS check
  result.
- `min-reviewers`: Newline-separated rules of the form `<pattern> <count>` that
  set the minimum number of approving reviewers (excluding the PR author) for
  files matching `<pattern>`. See
  [Minimum required reviewers](#minimum-required-reviewers).
- `default-min-reviewers`: (default `'0'`) Minimum number of approving reviewers
  for files not matched by any `min-reviewers` rule.

## Minimum required reviewers

Besides CODEOWNERS, the action can require a minimum number of approving
reviewers as a function of the files changed. Each changed file resolves its own
minimum, and the PR must have at least the **highest** of those minimums in
approvals from users other than the author. Files matched by `ignore-filepaths`
are exempt, and the check is skipped for `ignore-authors`.

- Patterns use CODEOWNERS syntax and, as in CODEOWNERS, the last matching rule
  wins.
- `{author}` in a pattern is replaced with the PR author's GitHub login (exact
  case), so rules can target per-user folders.
- Files that match no rule use `default-min-reviewers`.
- Lines starting with `#` are comments. Malformed rules fail the action.

For example, to let each user merge freely into `experimental/<their-login>/`
while requiring one reviewer everywhere else and two for `infra/`:

```yaml
- uses: DelfinaCare/codeowners-check@main
  with:
    always-succeed-before-approval: false
    status-check-name: codeowners-check
    default-min-reviewers: 1
    min-reviewers: |
      /experimental/{author}/ 0
      /infra/ 2
```

For this to take effect, set the branch protection rule's required approvals to
`0`, make `status-check-name` a required status check, and set
`always-succeed-before-approval` to `false` (otherwise PRs with no approvals
exit early without posting a status). CODEOWNERS is still enforced on top of the
minimum; the author counts as an owner, so a CODEOWNERS entry like
`/experimental/alice/ @alice` lets Alice satisfy it for her own folder.

Requirements are resolved by pluggable policies (see
`src/review-requirements.ts`). Each policy receives the changed file, including
its diff, and may return a minimum or defer to the next policy. Today only the
path-based policy is wired up, but diff-based or AI risk-assessment policies can
be added without changing how the requirement is enforced.
