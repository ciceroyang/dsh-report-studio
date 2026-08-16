/**
 * Batch verification over a directory of saved reports.
 *
 * @module dsh-report-studio/lib/verify-dir
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { verifyReportFile } from './verify.js'

/**
 * Verify every Markdown report under one workspace directory (recursive).
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
      } else if (entry.name.endsWith('.md')) {
        const result = verifyReportFile(full, cwd)
        rows.push({
          file: entry.name,
          dir: full,
          receiptPresent: result.receiptPresent,
          reportMatch: result.reportMatch,
          artifacts: result.artifacts.length,
        })
      }
    }
  }
  const base = join(cwd, dir)
  try {
    statSync(base)
    walk(base)
  } catch {
    return { total: 0, matched: 0, mismatched: 0, noReceipt: 0, rows: [], detail: '目录不存在或不可读: ' + dir }
  }
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
