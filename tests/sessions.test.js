/**
 * Unit tests for persisted-session reading helpers.
 * @module dsh-report-studio/tests/sessions
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeSegment, projectKey, parseSessionLog, listSessionLogs } from '../lib/sessions.js'

test('encodeSegment escapes unsafe code units', () => {
  assert.equal(encodeSegment('ai infra'), 'ai~0020infra')
  assert.equal(encodeSegment('示例项目'), '~793A~4F8B~9879~76EE')
  assert.equal(encodeSegment('plain-name'), 'plain-name')
  assert.equal(encodeSegment('.'), '~002E')
  assert.equal(encodeSegment('..'), '~002E~002E')
})

test('projectKey encodes a project path the way the harness writes it', () => {
  assert.equal(projectKey('/Users/example/Documents/ai infra'), '--Users-example-Documents-ai~0020infra--')
  assert.equal(projectKey('/Users/example/Documents/示例项目'), '--Users-example-Documents-~793A~4F8B~9879~76EE--')
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
