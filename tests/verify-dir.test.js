/**
 * Unit tests for batch directory verification.
 * @module dsh-report-studio/tests/verify-dir
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveReport } from '../lib/save.js'
import { verifyReportDirectory } from '../lib/verify-dir.js'

test('batch verify counts matched, mismatched and receipt-less reports', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vd-'))
  writeFileSync(join(cwd, 'artifact.txt'), 'bytes')
  const good = saveReport({ cwd, path: 'reports/good.md', content: '# 好报告\n', sessionId: 's1', generatedAt: 't', artifacts: ['artifact.txt'] })
  const bad = saveReport({ cwd, path: 'reports/bad.md', content: '# 坏报告\n', sessionId: 's2', generatedAt: 't' })
  const full = readFileSync(bad.path, 'utf8')
  writeFileSync(bad.path, full.replace('坏报告', '被改过的报告'))
  writeFileSync(join(cwd, 'reports', 'plain.md'), '# 没有凭据\n')

  const summary = verifyReportDirectory(cwd, 'reports')
  assert.equal(summary.total, 3)
  assert.equal(summary.matched, 1)
  assert.equal(summary.mismatched, 1)
  assert.equal(summary.noReceipt, 1)
  assert.equal(summary.rows.length, 3)
  rmSync(cwd, { recursive: true, force: true })
})

test('batch verify reports missing directories honestly', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'vd2-'))
  const summary = verifyReportDirectory(cwd, 'nope')
  assert.equal(summary.total, 0)
  assert.ok(summary.detail.includes('不存在'))
  rmSync(cwd, { recursive: true, force: true })
})
