/**
 * Unit tests for the report index and HTML-inclusive batch verification.
 * @module dsh-report-studio/tests/index-report
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveReport } from '../lib/save.js'
import { verifyReportDirectory } from '../lib/verify-dir.js'
import { verifyReportFile } from '../lib/verify.js'
import { renderIndexMarkdown, renderReportIndex, verdictOf } from '../lib/index-report.js'

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'idx-'))
  writeFileSync(join(cwd, 'artifact.txt'), 'bytes')
  saveReport({ cwd, path: 'reports/daily-2026-09-01.md', content: '# 日报\n', sessionId: 'sess-a', generatedAt: 't', artifacts: ['artifact.txt'] })
  saveReport({ cwd, path: 'reports/weekly-2026-09-08.md', content: '# 周报\n', sessionId: 'sess-b', generatedAt: 't' })
  saveReport({ cwd, path: 'reports/handoff-2026-09-09.html', content: '# 交接\n', sessionId: 'sess-c', generatedAt: 't', format: 'html' })
  saveReport({ cwd, path: 'reports/article-2026-09-10.md', content: '# 文章\n', sessionId: 'sess-d', generatedAt: 't' })
  const tampered = join(cwd, 'reports', 'article-2026-09-10.md')
  writeFileSync(tampered, readFileSync(tampered, 'utf8').replace('文章', '改动过'))
  return cwd
}

test('verifyReportDirectory scans HTML exports too', () => {
  const cwd = fixture()
  const summary = verifyReportDirectory(cwd, 'reports')
  assert.equal(summary.total, 4)
  const html = summary.rows.find((r) => r.format === 'html')
  assert.ok(html, 'html report is included')
  assert.equal(html.kind, 'handoff')
  assert.equal(html.date, '2026-09-09')
  assert.equal(html.reportMatch, true)
  assert.equal(html.session, 'sess-c')
  rmSync(cwd, { recursive: true, force: true })
})

test('verifyReportDirectory sorts newest first and records kind/date/session', () => {
  const cwd = fixture()
  const summary = verifyReportDirectory(cwd, 'reports')
  assert.deepEqual(summary.rows.map((r) => r.date), ['2026-09-10', '2026-09-09', '2026-09-08', '2026-09-01'])
  assert.equal(summary.matched, 3)
  assert.equal(summary.mismatched, 1)
  assert.equal(summary.noReceipt, 0)
  rmSync(cwd, { recursive: true, force: true })
})

test('renderIndexMarkdown marks verified, mismatch and receipt-less rows', () => {
  const rows = [
    { file: 'a.md', kind: 'daily', date: '2026-09-02', session: 's1', receiptPresent: true, reportMatch: true, artifacts: 2 },
    { file: 'b.md', kind: 'weekly', date: '2026-09-01', session: 's2', receiptPresent: true, reportMatch: false, artifacts: 0 },
    { file: 'c.md', kind: 'other', date: '2026-08-31', session: null, receiptPresent: false, reportMatch: false, artifacts: 0 },
  ]
  const md = renderIndexMarkdown(rows, { generatedAt: 'T' })
  assert.match(md, /共 3 份报告:1 通过 \/ 1 不匹配 \/ 1 无凭据/)
  assert.match(md, /\| a\.md \| daily \| 2026-09-02 \| s1 \| ✅ 通过 \| 2 \|/)
  assert.match(md, /❌ 内容不匹配/)
  assert.match(md, /⚠️ 无凭据/)
  assert.equal(verdictOf(rows[1]), 'mismatch')
})

test('renderReportIndex renders HTML on request and notes an empty directory', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'idx-empty-'))
  mkdirSync(join(cwd, 'reports'), { recursive: true })
  const md = renderReportIndex(cwd, 'reports')
  assert.match(md.text, /没有报告文件/)
  const html = renderReportIndex(cwd, 'reports', { format: 'html' })
  assert.match(html.text, /<!DOCTYPE html>/)
  assert.match(html.text, /报告索引/)
  rmSync(cwd, { recursive: true, force: true })
})
test('verifyReportFile reports the session id, not the receipt label', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'sess-'))
  saveReport({ cwd, path: 'reports/daily-2026-09-01.md', content: '# r\n', sessionId: 'SESS-MD', generatedAt: 't' })
  saveReport({ cwd, path: 'reports/daily-2026-09-02.html', content: '# r2\n', sessionId: 'SESS-HTML', generatedAt: 't', format: 'html' })
  const md = verifyReportFile(join(cwd, 'reports', 'daily-2026-09-01.md'), cwd)
  const html = verifyReportFile(join(cwd, 'reports', 'daily-2026-09-02.html'), cwd)
  assert.equal(md.session, 'SESS-MD')
  assert.equal(html.session, 'SESS-HTML')
  rmSync(cwd, { recursive: true, force: true })
})
