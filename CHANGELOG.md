# Changelog

Notable changes, newest first. Earlier versions (0.1.0 through 0.4.4) were
tagged and released before this file existed; their notes are on the
[Releases](https://github.com/ciceroyang/dsh-report-studio/releases) page.

## 0.4.7 — 2026-09-15

- `report_index` and `/report index [dir]` list every saved report with its
  kind, date, session and verification status, and can write the index as
  Markdown or HTML.
- Batch verification now covers `.html` reports as well as `.md`, and
  `pickField` returns the value rather than its label.

## 0.4.6 — 2026-09-15

- Host peer ranges are declared precisely instead of as wildcards, so
  `dsh-doctor --lint-peers` can check them against an installed host.

## 0.4.5 — 2026-09-15

- `report_index` tool.
- Two receipt and provenance fixes in the verification path.
- Docs: narrowed what the receipt block does and does not prove.

## 0.4.4 — 2026-09-12

- HTML export with an embedded, verifiable Markdown source block;
  `report_save` gains a `format` parameter.
- Deterministic auto-weekly draft script, with a launchd recipe.
- Batch verify mode: `report_verify` over a directory of saved reports.
