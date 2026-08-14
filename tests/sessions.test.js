/**
 * Unit tests for persisted-session reading helpers.
 * @module dsh-report-studio/tests/sessions
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeSegment, projectKey, parseSessionLog, listSessionLogs } from '../lib/sessions.js'

test('encodeSegment escapes unsafe code units', () => {
  assert.equal(encodeSegment('ai infra'), 'ai~0020infra')
  assert.equal(encodeSegment('dhp开源'), 'dhp~5F00~6E90')
  assert.equal(encodeSegment('plain-name'), 'plain-name')
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
})

test('projectKey matches real on-disk directories', () => {
  assert.equal(projectKey('/Users/zhang/Documents/ai infra'), '--Users-zhang-Documents-ai~0020infra--')
  assert.equal(projectKey('/Users/zhang/Documents/dhp开源'), '--Users-zhang-Documents-dhp~5F00~6E90--')
  assert.throws(() => projectKey(''), /empty project path/)
  assert.equal(projectKey('/'), '--root--')
})

test('parseSessionLog keeps events and skips chunk packs', () => {
  const text = [
    JSON.stringify({ type: 'session', version: 0, id: 's1', createdAt: 1 }),
    JSON.stringify({ type: 'user/message', seq: 0, time: 2, data: { content: [{ type: 'text', text: 'hi' }], source: { kind: 'user' } } }),
    JSON.stringify({ type: 'reasoning-chunks', seq0: 1, data: { chunks: [] } }),
    'not json at all',
    '',
  ].join('\n')
  const parsed = parseSessionLog(text)
  assert.equal(parsed.header.id, 's1')
  assert.equal(parsed.events.length, 1)
  assert.equal(parsed.events[0].type, 'user/message')
})

test('listSessionLogs returns empty for missing project dir', () => {
  assert.deepEqual(listSessionLogs('/nonexistent-root-xyz', '/any/cwd'), [])
})
