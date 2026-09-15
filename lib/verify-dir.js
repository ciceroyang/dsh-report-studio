/**
 * Batch verification over a directory of saved reports.
 *
 * Markdown and HTML exports are both scanned: both carry a receipt (HTML embeds
 * the original Markdown in a hidden block), so both are verifiable. The earlier
 * markdown-only filter silently skipped every HTML report saved with
 * `format: 'html'`.
 *
 * @module dsh-report-studio/lib/verify-dir
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { verifyReportFile } from './verify.js'
import { REPORT_KINDS } from './templates.js'

const REPORT_FILE = /^([a-z]+)-(\d{4}-\d{2}-\d{2})\.(md|html)$/

/** Kind/date from the default save name, falling back to the file mtime. */
function describe(file, mtimeMs) {
  const match = REPORT_FILE.exec(file)
  if (match && REPORT_KINDS.includes(match[1])) {
    return { kind: match[1], date: match[2], format: match[3] }
  }
  return {
    kind: 'other',
    date: new Date(mtimeMs).toISOString().slice(0, 10),
    format: file.endsWith('.html') ? 'html' : 'md',
  }
}

/**
 * Verify every report under one workspace directory (recursive).
 * @param {string} cwd - workspace root.
 * @param {string} dir - directory path relative to the workspace.
 * @returns {{total: number, matched: number, mismatched: number, noReceipt: number, rows: Array<object>}} summary.
 */
export function verifyReportDirectory(cwd, dir) {
  const rows = []
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (!entry.name.endsWith('.md') && !entry.name.endsWith('.html')) continue
      const result = verifyReportFile(full, cwd)
      const info = describe(entry.name, statSync(full).mtimeMs)
      rows.push({
        file: entry.name,
        dir: full,
        kind: info.kind,
        date: info.date,
        format: info.format,
        session: result.session,
        receiptPresent: result.receiptPresent,
        reportMatch: result.reportMatch,
        artifacts: result.artifacts.length,
      })
    }
  }
  const base = join(cwd, dir)
  try {
    statSync(base)
    walk(base)
  } catch {
    return { total: 0, matched: 0, mismatched: 0, noReceipt: 0, rows: [], detail: '目录不存在或不可读: ' + dir }
  }
  // Newest first; ties broken by name so two runs of the same tree agree.
  rows.sort((a, b) => (a.date === b.date ? a.file.localeCompare(b.file) : a.date < b.date ? 1 : -1))
  const matched = rows.filter((r) => r.receiptPresent && r.reportMatch).length
  const noReceipt = rows.filter((r) => !r.receiptPresent).length
  return {
    total: rows.length,
    matched,
    mismatched: rows.length - matched - noReceipt,
    noReceipt,
    rows,
  }
}