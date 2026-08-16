/**
 * Unit tests for independent receipt verification.
 * @module dsh-report-studio/tests/verify
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveReport } from '../lib/save.js'
import { verifyReportFile, parseReceipt } from '../lib/verify.js'

test('verify roundtrip: a saved report verifies against its own receipt', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dv-'))
  writeFileSync(join(cwd, 'artifact.txt'), 'artifact-bytes')
  const content = '# 日报\n\n今天完成三件事。\n'
  const saved = saveReport({
    cwd,
    path: 'reports/daily.md',
    content,
    sessionId: 's1',
    generatedAt: '2026-08-16T00:00:00.000Z',
    artifacts: ['artifact.txt'],
  })
  const result = verifyReportFile(saved.path, cwd)
  assert.equal(result.receiptPresent, true)
  assert.equal(result.reportMatch, true)
  assert.equal(result.artifacts.length, 1)
  assert.equal(result.artifacts[0].match, true)
  assert.equal(result.artifacts[0].missing, false)
  rmSync(cwd, { recursive: true, force: true })
})

test('verify detects a tampered body', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dv2-'))
  const content = '# 日报\n\n原文。\n'
  const saved = saveReport({ cwd, path: 'r.md', content, sessionId: 's1', generatedAt: 't' })
  const full = readFileSync(saved.path, 'utf8')
  writeFileSync(saved.path, full.replace('原文。', '被篡改的原文。'))
  const result = verifyReportFile(saved.path, cwd)
  assert.equal(result.reportMatch, false)
  assert.notEqual(result.actual, result.claimed)
  rmSync(cwd, { recursive: true, force: true })
})

test('verify flags artifacts deleted after saving', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dv3-'))
  writeFileSync(join(cwd, 'artifact.txt'), 'bytes')
  const content = '# 日报\n'
  const saved = saveReport({ cwd, path: 'r.md', content, sessionId: 's1', generatedAt: 't', artifacts: ['artifact.txt'] })
  rmSync(join(cwd, 'artifact.txt'))
  const result = verifyReportFile(saved.path, cwd)
  assert.equal(result.artifacts[0].missing, true)
  assert.equal(result.artifacts[0].match, false)
  rmSync(cwd, { recursive: true, force: true })
})

test('verify reports missing receipts honestly', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'dv4-'))
  const file = join(cwd, 'plain.md')
  writeFileSync(file, '# 没有凭据的报告\n')
  const result = verifyReportFile(file, cwd)
  assert.equal(result.receiptPresent, false)
  assert.equal(result.reportMatch, false)
  rmSync(cwd, { recursive: true, force: true })
})

test('parseReceipt extracts the report hash and artifact rows', () => {
  const full = '正文\n\n---\n\n## 报告凭据 Report Receipt\n\n| 项 | 值 |\n|---|---|\n| 会话 Session | s1 |\n| 报告哈希 Report SHA-256 | ' + 'a'.repeat(64) + ' |\n| 产物 Artifacts | |\n| a.txt | ' + 'b'.repeat(64) + ' |\n'
  const { body, claims } = parseReceipt(full)
  assert.equal(body, '正文\n')
  assert.equal(claims.reportSha, 'a'.repeat(64))
  assert.equal(claims.artifacts.length, 1)
  assert.equal(claims.artifacts[0].path, 'a.txt')
  assert.equal(claims.artifacts[0].sha, 'b'.repeat(64))
})
