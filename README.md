# rows-page-action

[![test](https://github.com/bitgate/rows-page-action/actions/workflows/test.yml/badge.svg)](https://github.com/bitgate/rows-page-action/actions/workflows/test.yml)

Push a CSV, TSV, JSON, JSONL or Parquet file from a workflow to [rows.page](https://rows.page) and get a link a human can explore: filters, sorting, column charts, SQL, and what changed since the previous version. One step, no account needed, and on pull requests a comment with the link and the diff. Exports, reports, test results, scraped data, whatever your job produces as rows.

## Usage

```yaml
- uses: bitgate/rows-page-action@v1
  id: rows
  with:
    path: out/report.csv
- run: echo "${{ steps.rows.outputs.url }}"
```

Anonymous datasets are deleted after 7 days. Open the owner link (the masked `owner-url` output) and sign in to keep one.

### One stable link per pull request

With an API key, `key` names the dataset: every push with the same key adds a version to it, the link stays the same, and the page shows how many rows are new, gone and changed against the previous version. `id-column` matches rows by id so edits count as changed instead of gone plus new. The PR comment is updated in place on every push.

```yaml
on: pull_request

permissions:
  contents: read
  pull-requests: write

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./generate-report.sh
      - uses: bitgate/rows-page-action@v1
        with:
          path: out/report.csv
          title: Report for PR #${{ github.event.number }}
          key: pr-${{ github.event.number }}
          id-column: order_id
          api-key: ${{ secrets.ROWS_API_KEY }}
```

Create an API key at [rows.page/account](https://rows.page/account). The action also reads it from a `ROWS_API_KEY` environment variable.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `path` | yes | | File to push: `.csv`, `.tsv`, `.json`, `.jsonl` or `.parquet`, up to 100 MB |
| `title` | no | | Dataset title shown on the page |
| `api-key` | no | | rows.page API key (`rpk_...`). Datasets go to your account and do not expire. Needed for `key` |
| `key` | no | | Your own stable dataset name, 1-100 characters of `A-Z a-z 0-9 . _ -`. The same key again adds a version to that dataset |
| `id-column` | no | | Column that identifies a row across versions, so changed rows can be counted |
| `dataset-token` | no | | Dataset token (`rpt_...`) from an earlier anonymous push, to push a new version of that dataset without an account |
| `comment` | no | `true` | Post one PR comment with the link and what changed, updated in place on later pushes. Skipped when the event is not a pull request |
| `github-token` | no | `${{ github.token }}` | Token for the PR comment. Needs `pull-requests: write` |

## Outputs

| Output | Description |
|---|---|
| `url` | Dataset page, the link to open |
| `id` | Dataset id |
| `version` | Version number, 1 for a new dataset |
| `unchanged` | `true` when the file matched the latest version, so no version was added |
| `rows` | Row count |
| `rows-delta` | Row count difference against the previous version. Empty for a new dataset or an unchanged push |
| `diff-url` | Dataset page opened on what changed since the previous version. Empty for a new dataset or an unchanged push |
| `expires-at` | When an anonymous dataset gets deleted. Empty when it does not expire |
| `owner-url` | Page URL with owner controls (keep, delete, re-push). Only when a dataset was created. Masked in logs |
| `token` | Dataset token (`rpt_...`) for later pushes via `dataset-token`. Only when a dataset was created, so store it. Masked in logs |

The per-row counts (new, gone, changed) are shown on the page and behind `diff-url`; the API returns the row count difference and the added and removed columns.

## Limits

- Anonymous: 100 MB per file, deleted 7 days after creation unless kept, up to 20 versions, 50 pushes and 1 GB per day per IP, 10 pushes per minute.
- With an API key: Free keeps 10 datasets with their last 3 versions, Pro 100 datasets at 500 MB per file with 90 days of versions, Max 1,000 datasets at 2 GB per file with a year of versions. 120 pushes per minute. One request carries up to 100 MB.

GitHub-hosted runners share IP addresses, so heavy anonymous use from Actions can hit the per-IP limits. The action retries a rate-limited push a few times; an API key moves you to per-account limits.

## Notes

- The same bytes pushed again create no version; `unchanged` is `true` and the link stays the same.
- The push is sent with the run URL and commit as provenance, shown on the page.
- The PR comment is skipped, with a warning, when the token cannot comment: pull requests from forks get a read-only token.
- Fails the step with a clear message when the file is missing, over 100 MB, or rows.page answers anything but 2xx (status and body included).

## License

MIT
