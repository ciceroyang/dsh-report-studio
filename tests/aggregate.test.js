/**
 * Unit tests for cross-session aggregation.
 * @module dsh-report-studio/tests/aggregate
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregateSessions } from '../lib/aggregate.js'

function makeEvents(asks, toolCount, tokenInput) {
  const events = []
  let seq = 0
  for (let turn = 0; turn < asks.length; turn++) {
    events.push({ type: 'turn/start', seq: seq++, time: 1000 + turn * 1000, data: { turn } })
    events.push({ type: 'step/start', seq: seq++, time: 1000 + turn * 1000, data: { turn, step: 0 } })
    events.push({
      type: 'user/message', seq: seq++, time: 1000 + turn * 1000,
      data: { content: [{ type: 'text', text: asks[turn] }], source: { kind: 'user' } },
    })
    for (let c = 0; c < toolCount; c++) {
      events.push({ type: 'tool/call', seq: seq++, time: 1100, data: { turn, step: 0, callId: 'c' + turn + c, name: 'bash', arguments: '{}' } })
      events.push({ type: 'tool/result', seq: seq++, time: 1101, data: { turn, step: 0, message: { content: [{ callId: 'c' + turn + c }] } } })
    }
    events.push({
      type: 'assistant/message', seq: seq++, time: 1200,
      data: { turn, step: 0, message: { content: [] }, usage: { inputTokens: tokenInput, outputTokens: 10 } },
    })
    events.push({ type: 'step/end', seq: seq++, time: 1200, data: { turn, step: 0 } })
    events.push({ type: 'turn/end', seq: seq++, time: 1200, data: { turn, reason: { kind: 'completed' } } })
  }
  return events
}

const S1 = { id: 's-aaaa1111', header: { id: 's-aaaa1111', cwd: '/work', createdAt: 1000 }, events: makeEvents(['周一任务A'], 2, 100) }
const S2 = { id: 's-bbbb2222', header: { id: 's-bbbb2222', cwd: '/work', createdAt: 2000 }, events: makeEvents(['周二任务B', '周二任务C'], 3, 200) }

test('aggregateSessions sums stats and lists sessions', () => {
  const out = aggregateSessions([S1, S2], null, '/work')
  assert.equal(out.sourceCount, 2)
  assert.equal(out.sessions.length, 2)
  assert.equal(out.stats.turns, 3)
  assert.equal(out.stats.steps, 3)
  assert.equal(out.stats.toolCalls, 8)
  assert.equal(out.stats.tokens.input, 500)
  assert.equal(out.stats.tokens.output, 30)
  assert.equal(out.stats.tokens.total, 530)
  assert.equal(out.tools[0].name, 'bash')
  assert.equal(out.tools[0].calls, 8)
  assert.equal(out.tasks.asks.length, 3)
  assert.ok(out.tasks.asks[0].includes('[会话 s-aaaa11]'))
  assert.equal(out.sessions[0].turns, 1)
  assert.equal(out.sessions[1].toolCalls, 6)
})

test('aggregateSessions includes the live session when provided', () => {
  const out = aggregateSessions([S1], { id: 's-live3333', header: { cwd: '/work' }, events: makeEvents(['今天任务D'], 1, 50) }, '/work')
  assert.equal(out.sourceCount, 2)
  assert.equal(out.stats.toolCalls, 3)
  assert.equal(out.stats.tokens.input, 150)
})

test('aggregateSessions handles empty input', () => {
  const out = aggregateSessions([], null, '/work')
  assert.equal(out.sourceCount, 0)
  assert.equal(out.stats.turns, 0)
  assert.deepEqual(out.tools, [])
})
