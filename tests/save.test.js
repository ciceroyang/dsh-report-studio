/**
 * Unit tests for safe persistence.
 * @module dsh-report-studio/tests/save
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveInside, saveReport } from '../lib/save.js'
import { sha256 } from '../lib/receipt.js'

const CWD = mkdtempSync(join(tmpdir(), 'dsh-report-studio-'))

test('resolveInside accepts relative and in-cwd absolute paths', () => {
  assert.equal(resolveInside(CWD, 'reports/d.md'), join(CWD, 'reports/d.md'))
  assert.equal(resolveInside(CWD, join(CWD, 'x.md')), join(CWD, 'x.md'))
})

test('resolveInside rejects escapes', () => {
  assert.throws(() => resolveInside(CWD, '../outside.md'), (error) => error.code === 'REPORT_PATH_ESCAPE')
  assert.throws(() => resolveInside(CWD, join(tmpdir(), 'elsewhere.md')), (error) => error.code === 'REPORT_PATH_ESCAPE')
  assert.throws(() => resolveInside(CWD, 'a/../../outside.md'), (error) => error.code === 'REPORT_PATH_ESCAPE')
  assert.throws(() => resolveInside(CWD, '  '), /empty report path/)
})

test('saveReport writes content, receipt, and hashed artifacts', () => {
  writeFileSync(join(CWD, 'artifact.txt'), 'artifact-bytes')
  const content = '# 日报\n\n今天完成了三件事。\n'
  const result = saveReport({
    cwd: CWD,
    path: 'reports/daily.md',
    content,
    sessionId: 's1',
    generatedAt: '2026-08-14T00:00:00.000Z',
    artifacts: ['artifact.txt', 'missing.txt'],
  })
  assert.equal(result.path, join(CWD, 'reports/daily.md'))
  assert.equal(result.sha256, sha256(content))
  assert.equal(result.artifacts.length, 1)
  assert.equal(result.artifacts[0].path, 'artifact.txt')
  assert.equal(result.artifacts[0].sha256, sha256('artifact-bytes'))

  const written = readFileSync(result.path, 'utf8')
  assert.ok(written.startsWith(content))
  assert.ok(written.includes('报告凭据'))
  assert.ok(written.includes('s1'))
  assert.ok(written.includes('artifact.txt'))
})

test('saveReport rejects escaping paths before writing', () => {
  assert.throws(() => saveReport({
    cwd: CWD,
    path: '../outside.md',
    content: 'x',
    sessionId: 's1',
    generatedAt: 't',
  }), (error) => error.code === 'REPORT_PATH_ESCAPE')
})

test('saveReport creates nested directories', () => {
  mkdirSync(join(CWD, 'nested-dir-marker'), { recursive: true })
  const result = saveReport({
    cwd: CWD,
    path: 'a/b/c/report.md',
    content: 'x',
    sessionId: 's1',
    generatedAt: 't',
  })
  assert.ok(readFileSync(result.path, 'utf8').includes('报告凭据'))
})

test('teardown', () => {
  rmSync(CWD, { recursive: true, force: true })
})
