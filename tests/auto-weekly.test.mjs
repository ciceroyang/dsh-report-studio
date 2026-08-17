/**
 * Smoke test for the auto-weekly draft script.
 * @module dsh-report-studio/tests/auto-weekly
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/auto-weekly.mjs', import.meta.url))

test('auto-weekly writes a data-filled draft for an empty workspace', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'aw-'))
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  const out = execFileSync(process.execPath, [SCRIPT, cwd, '--out', 'reports/weekly-auto.md'], { encoding: 'utf8', env })
  assert.ok(out.includes('auto draft saved'))
  const target = join(cwd, 'reports', 'weekly-auto.md')
  assert.ok(existsSync(target))
  const draft = readFileSync(target, 'utf8')
  assert.ok(draft.includes('自动草稿'))
  assert.ok(draft.includes('[[待写:'), 'prose slots remain')
  assert.ok(draft.includes('{{') === false || draft.includes('未聚合'), 'data slots filled')
  rmSync(cwd, { recursive: true, force: true })
})
