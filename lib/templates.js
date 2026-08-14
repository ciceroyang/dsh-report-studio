/**
 * Template loading and placeholder rendering for the report drafts.
 *
 * Templates are Markdown files with stable {{PLACEHOLDER}} slots; data
 * sections are filled deterministically by this module, prose slots are
 * emitted as [[待写:…]] markers the model replaces before saving.
 *
 * @module dsh-report-studio/lib/templates
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The bundled template directory inside this package. */
const DEFAULT_TEMPLATE_DIR = fileURLToPath(new URL('../templates/', import.meta.url))

/** Report kinds this version ships templates for. */
export const REPORT_KINDS = ['daily', 'weekly', 'handoff', 'article']

/** Prose slots the model MUST fill before saving. */
export const PROSE_SLOT_PATTERN = /\[\[待写:([^\]]+)\]\]/g

/**
 * Load one template file.
 * @param {string} kind - report kind.
 * @param {string[]} [extraDirs] - user template directories, searched first.
 * @returns {string} template content.
 * @throws when no template exists for the kind.
 */
export function loadTemplate(kind, extraDirs = []) {
  for (const dir of [...extraDirs, DEFAULT_TEMPLATE_DIR]) {
    const file = dir + (dir.endsWith('/') ? '' : '/') + kind + '.md'
    if (existsSync(file)) return readFileSync(file, 'utf8')
  }
  throw new Error('unknown report kind "' + kind + '"; available: ' + REPORT_KINDS.join(', '))
}

/** @param {number|null} ms @returns {string} */
function isoDate(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '未知'
  return new Date(ms).toISOString().slice(0, 10)
}

/** @param {number|null} ms @returns {string} */
function isoTime(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '未知'
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 19)
}

/** @param {number} n @returns {string} */
function humanNumber(n) {
  if (!Number.isFinite(n)) return String(n)
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

/** Build the {{META}} section. */
function buildMeta(data) {
  const lines = [
    '- 会话: ' + data.sessionId,
    '- 工作区: ' + (data.cwd ?? '未知'),
    '- 会话开始: ' + isoTime(data.startedAt),
    '- 会话结束: ' + isoTime(data.endedAt),
    '- 标题: ' + (data.title || '（无）'),
  ]
  return lines.join('\n')
}

/** Build the {{TASKS}} section. */
function buildTasks(data) {
  const lines = []
  lines.push('**用户诉求（按时间）**')
  if (data.tasks.asks.length === 0) lines.push('- （本次会话没有直接的用户消息）')
  for (const ask of data.tasks.asks) lines.push('- ' + ask.text)
  if (data.truncated.asks) lines.push('- …（诉求过多，已截断）')
  lines.push('')
  lines.push('**任务清单（最后一次快照）**')
  if (data.tasks.todos.length === 0) lines.push('- （无）')
  for (const todo of data.tasks.todos) {
    const mark = todo.status === 'completed' ? 'x' : ' '
    lines.push('- [' + mark + '] ' + todo.content)
  }
  return lines.join('\n')
}

/** Build the {{STATS}} section. */
function buildStats(data) {
  const s = data.stats
  const t = s.tokens
  const reasons = Object.entries(s.endReasons).map(([k, v]) => k + '×' + v).join(', ') || '无'
  const tokenLine =
    '- Token: 输入 ' + humanNumber(t.input) + ' + 输出 ' + humanNumber(t.output) +
    (t.cacheRead ? ' + 缓存读 ' + humanNumber(t.cacheRead) : '') +
    (t.cacheWrite ? ' + 缓存写 ' + humanNumber(t.cacheWrite) : '') +
    (t.reasoning ? ' + 推理 ' + humanNumber(t.reasoning) : '') +
    ' = 合计 ' + humanNumber(t.total)
  const lines = [
    '- 回合: ' + s.turns + ' | 模型步骤: ' + s.steps + ' | 工具调用: ' + s.toolCalls,
    tokenLine,
    '- 回合结束原因: ' + reasons,
  ]
  return lines.join('\n')
}

/** Build the {{TOOLS}} section. */
function buildTools(data) {
  if (data.tools.length === 0) return '- （本次会话没有工具调用）'
  const lines = ['| 工具 | 调用次数 | 出错 |', '|---|---|---|']
  for (const row of data.tools) lines.push('| ' + row.name + ' | ' + row.calls + ' | ' + row.errors + ' |')
  return lines.join('\n')
}

/** Build the {{FILES}} section. */
function buildFiles(data) {
  const lines = []
  lines.push('**产出/修改的文件**')
  if (data.files.modified.length === 0) lines.push('- （无）')
  for (const file of data.files.modified) lines.push('- ' + file)
  lines.push('')
  lines.push('**读过的文件**')
  const read = data.files.touched.filter((f) => !data.files.modified.includes(f))
  if (read.length === 0) lines.push('- （无）')
  for (const file of read.slice(0, 30)) lines.push('- ' + file)
  return lines.join('\n')
}

/** Build the {{COMMANDS}} section. */
function buildCommands(data) {
  if (data.commands.length === 0) return '- （本次会话没有执行 shell 命令）'
  const lines = []
  for (const entry of data.commands) {
    lines.push('- ' + entry.command + (entry.workdir ? '  (cwd: ' + entry.workdir + ')' : ''))
  }
  if (data.truncated.commands) lines.push('- …（命令过多，已截断）')
  return lines.join('\n')
}

/** Build the {{ERRORS}} section. */
function buildErrors(data) {
  if (data.errors.length === 0) return '- 无'
  const lines = []
  for (const entry of data.errors) lines.push('- ' + entry.tool + ': ' + entry.code)
  if (data.truncated.errors) lines.push('- …（错误过多，已截断）')
  return lines.join('\n')
}

/** Build the {{TIMELINE}} section: one line per turn. */
function buildTimeline(data) {
  if (data.timeline.length === 0) return '- （无回合记录）'
  const lines = []
  for (const turn of data.timeline) {
    const ask = turn.ask || '（注入上下文）'
    lines.push(
      '- 回合 ' + turn.turn + ' (' + isoTime(turn.startedAt) + '): ' + ask + ' — ' +
      turn.steps + ' 步 / ' + turn.toolCalls + ' 次工具调用, 结束: ' + (turn.endReason ?? '进行中'),
    )
  }
  return lines.join('\n')
}

/** Build the {{SESSIONS}} section: one row per aggregated session. */
function buildSessions(data) {
  if (!Array.isArray(data.sessions) || data.sessions.length === 0) {
    return '- 本次周报基于当前单个会话生成（未聚合历史会话）'
  }
  const lines = [
    '| 会话 | 标题 | 日期 | 回合 | 步骤 | 工具调用 | Token | 产出文件 | 错误 |',
    '|---|---|---|---|---|---|---|---|---|',
  ]
  for (const s of data.sessions) {
    lines.push(
      '| ' + String(s.id).slice(0, 8) + ' | ' + (s.title || '（无标题）') + ' | ' + (s.day ?? '未知') +
      ' | ' + s.turns + ' | ' + s.steps + ' | ' + s.toolCalls + ' | ' + humanNumber(s.tokens) +
      ' | ' + s.filesModified + ' | ' + s.errors + ' |',
    )
  }
  lines.push('')
  lines.push('共聚合 ' + data.sessions.length + ' 个会话' + (data.sourceCount ? '（来源:历史日志 + 当前会话）' : ''))
  return lines.join('\n')
}

/**
 * Render one template with the extracted session data.
 * @param {string} template - template Markdown.
 * @param {object} data - extractSession output, optionally with title/period overrides applied.
 * @returns {string} the report draft.
 */
export function renderTemplate(template, data) {
  const sections = {
    '{{META}}': buildMeta(data),
    '{{TASKS}}': buildTasks(data),
    '{{STATS}}': buildStats(data),
    '{{TOOLS}}': buildTools(data),
    '{{FILES}}': buildFiles(data),
    '{{COMMANDS}}': buildCommands(data),
    '{{ERRORS}}': buildErrors(data),
    '{{TIMELINE}}': buildTimeline(data),
    '{{SESSIONS}}': buildSessions(data),
    '{{DATE}}': data.date ?? isoDate(data.endedAt ?? data.startedAt),
    '{{TITLE}}': data.titleOverride ?? data.title ?? '工作交付报告',
    '{{PERIOD}}': data.period ?? '',
  }
  let output = template
  for (const [slot, value] of Object.entries(sections)) {
    output = output.split(slot).join(value)
  }
  return output.trim() + '\n'
}

/**
 * Parse slash-command input into a report kind.
 * @param {string} rawInput - text after the command name.
 * @returns {string} a REPORT_KINDS member; unknown input defaults to 'daily'.
 */
export function parseReportKind(rawInput) {
  const text = typeof rawInput === 'string' ? rawInput.trim().toLowerCase() : ''
  if (REPORT_KINDS.includes(text)) return text
  const aliases = {
    d: 'daily', 日报: 'daily',
    w: 'weekly', 周报: 'weekly',
    h: 'handoff', 交接: 'handoff',
    a: 'article', 文章: 'article', 公众号: 'article',
  }
  return aliases[text] ?? 'daily'
}

/**
 * Whether a draft still contains unfilled prose slots.
 * @param {string} draft - rendered report text.
 * @returns {boolean}
 */
export function hasUnfilledProse(draft) {
  PROSE_SLOT_PATTERN.lastIndex = 0
  return PROSE_SLOT_PATTERN.test(draft)
}
