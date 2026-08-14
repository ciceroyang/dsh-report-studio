/**
 * Unit tests for template loading and rendering.
 * @module dsh-report-studio/tests/templates
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadTemplate, renderTemplate, hasUnfilledProse, parseReportKind, REPORT_KINDS } from '../lib/templates.js'

test('every declared kind ships a template', () => {
  for (const kind of REPORT_KINDS) {
    const template = loadTemplate(kind)
    assert.ok(template.length > 0, kind + ' template is non-empty')
  }
})

test('unknown kind throws', () => {
  assert.throws(() => loadTemplate('nope'), /unknown report kind/)
})

const SAMPLE_DATA = {
  sessionId: 's1',
  cwd: '/work',
  startedAt: 1700000000000,
  endedAt: 1700003600000,
  title: '会话标题',
  date: '2026-08-14',
  period: '本周',
  tasks: { asks: [{ text: '做A' }, { text: '做B' }], todos: [{ content: '任务一', status: 'completed' }] },
  stats: {
    turns: 2, steps: 5, toolCalls: 12,
    tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, reasoning: 100, total: 1600 },
    endReasons: { completed: 2 },
  },
  tools: [{ name: 'bash', calls: 10, errors: 1 }],
  files: { touched: ['b.txt', 'a.txt'], modified: ['a.txt'] },
  commands: [{ workdir: '/work', command: 'ls' }],
  errors: [{ tool: 'bash', code: 'EXIT_1' }],
  truncated: { asks: false, commands: false, errors: false },
  timeline: [{ turn: 0, startedAt: 1700000000000, endedAt: 1700001000000, endReason: 'completed', ask: '做A', steps: 3, toolCalls: 8 }],
}

test('renderTemplate fills every data slot and keeps prose slots', () => {
  const template = loadTemplate('daily')
  const draft = renderTemplate(template, SAMPLE_DATA)
  assert.ok(draft.includes('s1'), 'session id present')
  assert.ok(draft.includes('做A'), 'ask present')
  assert.ok(draft.includes('EXIT_1'), 'error present')
  assert.ok(draft.includes('1.6k'), 'token total present')
  assert.ok(draft.includes('[[待写:'), 'prose slots remain')
  assert.ok(!draft.includes('{{META}}'), 'data slot replaced')
})

test('renderTemplate leaves unknown placeholders untouched', () => {
  const draft = renderTemplate('# {{UNKNOWN}} {{DATE}}', SAMPLE_DATA)
  assert.ok(draft.includes('{{UNKNOWN}}'))
  assert.ok(draft.includes('2026-08-14'))
})

test('hasUnfilledProse detects leftover slots', () => {
  assert.equal(hasUnfilledProse('还有 [[待写:摘要]] 没写'), true)
  assert.equal(hasUnfilledProse('全部写完了'), false)
})

test('parseReportKind resolves kinds and aliases', () => {
  assert.equal(parseReportKind('daily'), 'daily')
  assert.equal(parseReportKind(' WEEKLY '), 'weekly')
  assert.equal(parseReportKind('handoff'), 'handoff')
  assert.equal(parseReportKind('article'), 'article')
  assert.equal(parseReportKind('日报'), 'daily')
  assert.equal(parseReportKind('周报'), 'weekly')
  assert.equal(parseReportKind('交接'), 'handoff')
  assert.equal(parseReportKind('公众号'), 'article')
  assert.equal(parseReportKind('d'), 'daily')
  assert.equal(parseReportKind(''), 'daily')
  assert.equal(parseReportKind('随便写的'), 'daily')
})

test('weekly template uses period', () => {
  const draft = renderTemplate(loadTemplate('weekly'), SAMPLE_DATA)
  assert.ok(draft.includes('本周'))
})
