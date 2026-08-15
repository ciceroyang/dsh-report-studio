/**
 * Merge several session pictures into one weekly report dataset.
 *
 * Reuses lib/extract.js per session, then sums the hard data. The output
 * keeps the exact shape renderTemplate consumes and adds a `sessions` table
 * for the {{SESSIONS}} placeholder plus a `sourceCount`.
 *
 * @module dsh-report-studio/lib/aggregate
 */

import { extractSession } from './extract.js'

const MAX_MERGED = { asks: 40, commands: 40, errors: 40, timeline: 80 }

/** @param {number|null} ms @returns {string} */
function isoDay(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '未知'
  return new Date(ms).toISOString().slice(0, 10)
}

/** Extract one persisted entry into a report-shaped picture. */
function pictureOf(entry) {
  const id = entry.header?.id ?? entry.id
  const session = { id: String(id), header: { cwd: entry.header?.cwd, createdAt: entry.header?.createdAt } }
  return extractSession(entry.events ?? [], session)
}

/**
 * Aggregate persisted sessions (plus the optional live one) into one dataset.
 * @param {Array<{id: string, header: object|null, events: Array<object>}>} entries - persisted sessions.
 * @param {object|null} [live] - the live caller session, {id, header, events}.
 * @param {string} [cwd] - workspace path for the synthetic weekly session id.
 * @returns {object} dataset compatible with renderTemplate plus sessions/sourceCount.
 */
export function aggregateSessions(entries, live, cwd) {
  const pictures = []
  for (const entry of entries) {
    pictures.push({ entry, data: pictureOf(entry) })
  }
  if (live !== null && live !== undefined) {
    const data = extractSession(live.events ?? [], { id: live.id, header: live.header ?? {} })
    pictures.push({ entry: { id: live.id, header: live.header ?? {} }, data })
  }

  const merged = {
    sessionId: 'week-' + (typeof cwd === 'string' ? cwd : 'multi'),
    cwd: cwd ?? null,
    createdAt: null,
    startedAt: null,
    endedAt: null,
    title: '',
    date: null,
    period: '本周',
    sessions: [],
    tasks: { asks: [], todos: [] },
    stats: {
      turns: 0,
      steps: 0,
      toolCalls: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
      endReasons: {},
    },
    tools: new Map(),
    files: { touched: new Set(), modified: new Set() },
    commands: [],
    errors: [],
    timeline: [],
    truncated: { asks: false, commands: false, errors: false },
    sourceCount: pictures.length,
  }

  for (const { data } of pictures) {
    if (merged.createdAt === null || (data.createdAt !== null && data.createdAt < merged.createdAt)) merged.createdAt = data.createdAt
    if (merged.startedAt === null || (data.startedAt !== null && data.startedAt < merged.startedAt)) merged.startedAt = data.startedAt
    if (merged.endedAt === null || (data.endedAt !== null && data.endedAt > merged.endedAt)) merged.endedAt = data.endedAt
    merged.sessions.push({
      id: data.sessionId,
      title: data.title || '（无标题）',
      day: isoDay(data.endedAt ?? data.startedAt),
      turns: data.stats.turns,
      steps: data.stats.steps,
      toolCalls: data.stats.toolCalls,
      tokens: data.stats.tokens.total,
      filesModified: data.files.modified.length,
      errors: data.errors.length,
    })
    for (const ask of data.tasks.asks) {
      if (merged.tasks.asks.length >= MAX_MERGED.asks) {
        merged.truncated.asks = true
        break
      }
      merged.tasks.asks.push({ text: ask.text + '  [会话 ' + data.sessionId.slice(0, 8) + ']' })
    }
    if (data.tasks.todos.length > 0) merged.tasks.todos = data.tasks.todos
    const s = merged.stats
    const t = data.stats.tokens
    s.turns += data.stats.turns
    s.steps += data.stats.steps
    s.toolCalls += data.stats.toolCalls
    s.tokens.input += t.input
    s.tokens.output += t.output
    s.tokens.cacheRead += t.cacheRead
    s.tokens.cacheWrite += t.cacheWrite
    s.tokens.reasoning += t.reasoning
    for (const [kind, count] of Object.entries(data.stats.endReasons)) {
      s.endReasons[kind] = (s.endReasons[kind] ?? 0) + count
    }
    for (const row of data.tools) {
      const existing = merged.tools.get(row.name)
      if (existing) {
        existing.calls += row.calls
        existing.errors += row.errors
      } else {
        merged.tools.set(row.name, { ...row })
      }
    }
    for (const file of data.files.touched) merged.files.touched.add(file)
    for (const file of data.files.modified) merged.files.modified.add(file)
    for (const command of data.commands) {
      if (merged.commands.length >= MAX_MERGED.commands) break
      merged.commands.push(command)
    }
    for (const error of data.errors) {
      if (merged.errors.length >= MAX_MERGED.errors) {
        merged.truncated.errors = true
        break
      }
      merged.errors.push({ ...error, session: data.sessionId.slice(0, 8) })
    }
    for (const turn of data.timeline) {
      if (merged.timeline.length >= MAX_MERGED.timeline) break
      merged.timeline.push({ ...turn, session: data.sessionId.slice(0, 8) })
    }
  }

  merged.stats.tokens.total = merged.stats.tokens.input + merged.stats.tokens.output
    + merged.stats.tokens.cacheRead + merged.stats.tokens.cacheWrite + merged.stats.tokens.reasoning
  merged.tools = [...merged.tools.values()].sort((a, b) => b.calls - a.calls)
  merged.files = { touched: [...merged.files.touched], modified: [...merged.files.modified] }
  return merged
}
