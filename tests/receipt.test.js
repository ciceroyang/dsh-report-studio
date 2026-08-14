/**
 * Unit tests for receipt hashing and rendering.
 * @module dsh-report-studio/tests/receipt
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sha256, buildReceipt } from '../lib/receipt.js'

test('sha256 is deterministic and correct', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(sha256('abc'), sha256('abc'))
  assert.notEqual(sha256('abc'), sha256('abd'))
})

test('buildReceipt renders session facts and artifacts', () => {
  const receipt = buildReceipt({
    sessionId: 's1',
    cwd: '/work',
    generatedAt: '2026-08-14T00:00:00.000Z',
    reportSha256: 'deadbeef',
    artifacts: [{ path: 'a.txt', sha256: 'cafe' }],
  })
  assert.ok(receipt.includes('报告凭据'))
  assert.ok(receipt.includes('s1'))
  assert.ok(receipt.includes('/work'))
  assert.ok(receipt.includes('deadbeef'))
  assert.ok(receipt.includes('a.txt'))
  assert.ok(receipt.includes('cafe'))
})

test('buildReceipt records undeclared artifacts explicitly', () => {
  const receipt = buildReceipt({ sessionId: 's1', cwd: null, generatedAt: 't', reportSha256: 'h' })
  assert.ok(receipt.includes('（未声明）'))
})
