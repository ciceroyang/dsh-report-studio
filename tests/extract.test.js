/**
 * Unit tests for the session event extractor.
 * @module dsh-report-studio/tests/extract
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractSession, textOfContent, parseToolArgs } from '../lib/extract.js'

function event(seq, type, data, time = seq * 1000) {
  return { seq, type, time, data }
}

const SESSION = { id: 'session-test-1', header: { cwd: '/work', createdAt: 1000 } }

test('textOfContent joins text blocks', () => {
  assert.equal(textOfContent([{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }]), 'hello\nworld')
  assert.equal(textOfContent('plain'), 'plain')
  assert.equal(textOfContent(null), '')
})

test('parseToolArgs tolerates garbage', () => {
  assert.deepEqual(parseToolArgs('not json'), {})
  assert.deepEqual(parseToolArgs(''), {})
  assert.deepEqual(parseToolArgs('"a"'), {})
  assert.deepEqual(parseToolArgs('{"a":1}'), { a: 1 })
})

test('extractSession aggregates turns, steps, tools, tokens', () => {
  const events = [
    event(0, 'turn/start', { turn: 0 }),
    event(1, 'step/start', { turn: 0, step: 0 }),
    event(2, 'user/message', { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我写个日报' }] }),
    event(3, 'tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{"command":"ls","workdir":"/work"}' }),
    event(4, 'tool/result', { turn: 0, step: 0, message: { content: [{ callId: 'c1' }] } }),
    event(5, 'assistant/message', {
      turn: 0, step: 0, message: { content: [] },
      usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, reasoningTokens: 20 },
    }),
    event(6, 'step/end', { turn: 0, step: 0 }),
    event(7, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
  ]
  const data = extractSession(events, SESSION)
  assert.equal(data.stats.turns, 1)
  assert.equal(data.stats.steps, 1)
  assert.equal(data.stats.toolCalls, 1)
  assert.equal(data.stats.tokens.input, 100)
  assert.equal(data.stats.tokens.output, 50)
  assert.equal(data.stats.tokens.cacheRead, 10)
  assert.equal(data.stats.tokens.reasoning, 20)
  assert.equal(data.stats.tokens.total, 180)
  assert.equal(data.stats.endReasons.completed, 1)
  assert.equal(data.tasks.asks.length, 1)
  assert.equal(data.tasks.asks[0].text, '帮我写个日报')
  assert.deepEqual(data.commands, [{ workdir: '/work', command: 'ls' }])
  assert.equal(data.tools[0].name, 'bash')
  assert.equal(data.tools[0].calls, 1)
  assert.equal(data.timeline[0].endReason, 'completed')
})

test('extractSession collects modified files from fs tools', () => {
  const events = [
    event(0, 'turn/start', { turn: 0 }),
    event(1, 'tool/call', { turn: 0, step: 0, callId: 'c1', name: 'write', arguments: '{"file_path":"a.txt","content":"x"}' }),
    event(2, 'tool/result', { turn: 0, step: 0, message: { content: [{ callId: 'c1' }] } }),
    event(3, 'tool/call', { turn: 0, step: 0, callId: 'c2', name: 'read', arguments: '{"file_path":"b.txt"}' }),
    event(4, 'tool/result', { turn: 0, step: 0, message: { content: [{ callId: 'c2' }] } }),
  ]
  const data = extractSession(events, SESSION)
  assert.deepEqual(data.files.modified, ['a.txt'])
  assert.ok(data.files.touched.includes('a.txt'))
  assert.ok(data.files.touched.includes('b.txt'))
})

test('extractSession records tool errors and blocked turns', () => {
  const events = [
    event(0, 'turn/start', { turn: 0 }),
    event(1, 'tool/call', { turn: 0, step: 0, callId: 'c1', name: 'bash', arguments: '{}' }),
    event(2, 'tool/result', { turn: 0, step: 0, message: { content: [{ callId: 'c1' }] }, error: { name: 'X', code: 'EXIT_1' } }),
    event(3, 'turn/end', { turn: 0, reason: { kind: 'blocked' } }),
  ]
  const data = extractSession(events, SESSION)
  assert.equal(data.tools[0].errors, 1)
  assert.equal(data.errors[0].tool, 'bash')
  assert.equal(data.errors[0].code, 'EXIT_1')
  assert.equal(data.stats.endReasons.blocked, 1)
})

test('extractSession keeps the latest todo snapshot', () => {
  const events = [
    event(0, 'todo/write', { todos: [{ content: 'old', status: 'pending' }] }),
    event(1, 'todo/write', { todos: [{ content: 'new', status: 'completed' }] }),
  ]
  const data = extractSession(events, SESSION)
  assert.equal(data.tasks.todos.length, 1)
  assert.equal(data.tasks.todos[0].content, 'new')
})

test('extractSession tolerates unknown event types', () => {
  const events = [
    event(0, 'turn/start', { turn: 0 }),
    event(1, 'compaction/start', { what: 'ever' }),
    event(2, 'turn/end', { turn: 0, reason: { kind: 'completed' } }),
  ]
  const data = extractSession(events, SESSION)
  assert.equal(data.stats.turns, 1)
  assert.equal(data.timeline[0].endReason, 'completed')
})
