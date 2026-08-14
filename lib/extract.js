/**
 * Session event log → structured hard data for report templates.
 *
 * Pure functions over the durable {@link SessionEvent} vocabulary of
 * @deepseek-ai/dsh-session. No harness services required, so the whole
 * extraction surface is unit-testable with synthetic events.
 *
 * @module dsh-report-studio/lib/extract
 */

/** Tool names whose arguments reference workspace files. */
const FILE_TOOL_NAMES = new Set(['read', 'write', 'edit', 'glob', 'grep', 'str_replace_editor', 'todo_write'])

/** Tool names that modify files on disk. */
const WRITE_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor'])

/** Hard caps so hostile or pathological logs cannot blow up a report. */
const MAX_ASKS = 40
const MAX_COMMANDS = 40
const MAX_ERRORS = 40

/**
 * Plain text of one message's content blocks.
 * @param {unknown} content - provider message content.
 * @returns {string} joined text, trimmed.
 */
export function textOfContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block === 'string') parts.push(block)
    else if (block && typeof block === 'object') {
      if (typeof block.text === 'string') parts.push(block.text)
      else if (typeof block.content === 'string') parts.push(block.content)
    }
  }
  return parts.join('\n').trim()
}

/**
 * Parse a raw model-produced tool arguments string losslessly.
 * @param {string} raw - the JSON string the model emitted.
 * @returns {Record<string, unknown>} parsed object, or empty on failure.
 */
export function parseToolArgs(raw) {
  if (typeof raw !== 'string' || raw === '') return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** @typedef {{kind: string}} EndReason */

/**
 * Extract the hard-data picture of one session.
 * @param {ReadonlyArray<import('@deepseek-ai/dsh-session').SessionEvent>} events - durable log.
 * @param {{id: unknown, header: {cwd?: string, createdAt?: number}}} session - caller session identity.
 * @returns {object} structured report data (see DESIGN.md).
 */
export function extractSession(events, session) {
  const turns = []
  let current = null
  const callName = new Map()
  const tools = new Map()
  const filesTouched = new Set()
  const filesModified = new Set()
  const commands = []
  const errors = []
  const asks = []
  const endReasons = new Map()
  let todos = []
  let title = ''
  const tokens = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  }
  let steps = 0
  let toolCalls = 0

  const addError = (entry) => {
    if (errors.length < MAX_ERRORS) errors.push(entry)
  }

  const bump = (key, delta) => {
    if (current !== null && typeof current[key] === 'number') current[key] += delta
  }

  const aggregateTool = (name) => {
    const row = tools.get(name) ?? { name, calls: 0, errors: 0 }
    row.calls += 1
    tools.set(name, row)
    bump('toolCalls', 1)
  }

  for (const event of events) {
    switch (event.type) {
      case 'turn/start': {
        current = {
          turn: event.data.turn,
          startedAt: event.time,
          endedAt: null,
          endReason: null,
          ask: '',
          steps: 0,
          toolCalls: 0,
          tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        }
        turns.push(current)
        break
      }
      case 'turn/end': {
        if (current !== null) {
          current.endedAt = event.time
          current.endReason = event.data.reason?.kind ?? 'unknown'
          endReasons.set(current.endReason, (endReasons.get(current.endReason) ?? 0) + 1)
        }
        break
      }
      case 'step/start':
        steps += 1
        bump('steps', 1)
        break
      case 'user/message': {
        const text = textOfContent(event.data.content)
        if (event.data.source?.kind === 'user' && text) {
          if (asks.length < MAX_ASKS) {
            asks.push({ turn: current?.turn ?? null, time: event.time, text })
          }
          if (current !== null && current.ask === '') current.ask = text
        }
        break
      }
      case 'assistant/message': {
        const usage = event.data.usage
        if (usage && typeof usage === 'object') {
          const add = (key, value) => {
            const n = Number(value)
            if (Number.isFinite(n)) {
              tokens[key] += n
              const path = 'tokens.' + key
              if (current !== null && typeof current[path] === 'number') current[path] += n
            }
          }
          add('input', usage.inputTokens)
          add('output', usage.outputTokens)
          add('cacheRead', usage.cacheReadTokens)
          add('cacheWrite', usage.cacheWriteTokens)
          add('reasoning', usage.reasoningTokens)
        }
        break
      }
      case 'tool/call': {
        toolCalls += 1
        aggregateTool(event.data.name)
        callName.set(event.data.callId, event.data.name)
        const args = parseToolArgs(event.data.arguments)
        if (FILE_TOOL_NAMES.has(event.data.name)) {
          for (const key of ['file_path', 'path']) {
            const value = args[key]
            if (typeof value === 'string' && value.trim() !== '') {
              filesTouched.add(value.trim())
              if (WRITE_TOOL_NAMES.has(event.data.name)) filesModified.add(value.trim())
            }
          }
        }
        if (event.data.name === 'bash' && typeof args.command === 'string' && commands.length < MAX_COMMANDS) {
          commands.push({ workdir: typeof args.workdir === 'string' ? args.workdir : undefined, command: args.command })
        }
        break
      }
      case 'tool/result': {
        if (event.data.error) {
          const block = event.data.message?.content?.[0]
          const name = callName.get(block?.callId) ?? 'unknown'
          const row = tools.get(name)
          if (row) row.errors += 1
          addError({ tool: name, code: event.data.error.code ?? 'TOOL_ERROR' })
        }
        break
      }
      case 'todo/write':
        if (Array.isArray(event.data.todos)) todos = event.data.todos
        break
      case 'session/title': {
        const value = event.data?.title ?? event.data?.text
        if (typeof value === 'string' && value.trim() !== '') title = value.trim()
        break
      }
      default:
        // Compaction, chunk, and merge-extended event types carry nothing
        // report-worthy; skip them silently.
        break
    }
  }

  const toolRows = [...tools.values()].sort((a, b) => b.calls - a.calls)
  const totalTokens = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning

  return {
    sessionId: String(session.id),
    cwd: session.header?.cwd ?? null,
    createdAt: session.header?.createdAt ?? null,
    startedAt: events.length > 0 ? events[0].time : null,
    endedAt: events.length > 0 ? events[events.length - 1].time : null,
    title,
    tasks: { asks, todos },
    timeline: turns,
    stats: {
      turns: turns.length,
      steps,
      toolCalls,
      tokens: { ...tokens, total: totalTokens },
      endReasons: Object.fromEntries(endReasons),
    },
    tools: toolRows,
    files: { touched: [...filesTouched], modified: [...filesModified] },
    commands,
    errors,
    truncated: {
      asks: asks.length >= MAX_ASKS,
      commands: commands.length >= MAX_COMMANDS,
      errors: errors.length >= MAX_ERRORS,
    },
  }
}
