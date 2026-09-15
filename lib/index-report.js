/**
 * Human-facing index over a directory of saved reports.
 *
 * `verifyReportDirectory` answers "are these files intact?"; this module renders
 * the answer as a list a person can read (and optionally save as HTML), so a
 * workspace with weeks of daily reports stops being a pile of filenames.
 *
 * @module dsh-report-studio/lib/index-report
 */

import { verifyReportDirectory } from './verify-dir.js'
import { markdownToHtml, wrapHtmlDocument } from './html.js'

export function verdictOf(row) {
  if (!row.receiptPresent) return 'no-receipt'
  return row.reportMatch ? 'verified' : 'mismatch'
}

const VERDICT_TEXT = {
  verified: '✅ 通过',
  mismatch: '❌ 内容不匹配',
  'no-receipt': '⚠️ 无凭据',
}

/**
 * Render the index as Markdown.
 * @param {Array<object>} rows - verify-dir rows.
 * @param {{title?: string, generatedAt?: string}} [opts]
 * @returns {string} markdown.
 */
export function renderIndexMarkdown(rows, opts = {}) {
  const title = opts.title ?? '报告索引 Report Index'
  const generatedAt = opts.generatedAt ?? new Date().toISOString()
  const verified = rows.filter((r) => verdictOf(r) === 'verified').length
  const mismatch = rows.filter((r) => verdictOf(r) === 'mismatch').length
  const noReceipt = rows.filter((r) => verdictOf(r) === 'no-receipt').length
  const lines = []
  lines.push('# ' + title)
  lines.push('')
  lines.push('生成时间 ' + generatedAt + ' · 共 ' + rows.length + ' 份报告:' + verified + ' 通过 / ' + mismatch + ' 不匹配 / ' + noReceipt + ' 无凭据')
  lines.push('')
  if (rows.length === 0) {
    lines.push('该目录下没有报告文件。')
    return lines.join('\n') + '\n'
  }
  lines.push('| 文件 | 类型 | 日期 | 会话 | 核验 | 产物 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    lines.push(
      '| ' + row.file +
      ' | ' + row.kind +
      ' | ' + row.date +
      ' | ' + (row.session ?? '-') +
      ' | ' + (VERDICT_TEXT[verdictOf(row)] ?? '?') +
      ' | ' + row.artifacts + ' |',
    )
  }
  lines.push('')
  lines.push('核验由 `report_verify` 的同一套逻辑完成:重算报告 SHA-256 与凭据声明比对。')
  return lines.join('\n') + '\n'
}

/**
 * Scan a directory and render an index.
 * @param {string} cwd - workspace root.
 * @param {string} dir - directory relative to the workspace.
 * @param {{format?: 'md'|'html', title?: string, generatedAt?: string}} [opts]
 * @returns {{text: string, rows: Array<object>, summary: object}} rendered index.
 */
export function renderReportIndex(cwd, dir, opts = {}) {
  const summary = verifyReportDirectory(cwd, dir)
  const markdown = renderIndexMarkdown(summary.rows, opts)
  const text = opts.format === 'html'
    ? wrapHtmlDocument(opts.title ?? '报告索引 Report Index', markdownToHtml(markdown), '', markdown)
    : markdown
  return { text, markdown, rows: summary.rows, summary }
}