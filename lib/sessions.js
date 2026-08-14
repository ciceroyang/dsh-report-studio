/**
 * Read persisted session logs from $DSH_HOME/sessions.
 *
 * The path encoding and directory layout follow the official
 * dsh-session-persistence-jsonl format (ported from its format.ts, MIT):
 * project dirs are '--' + slug + '--' with '~XXXX' escapes, session dirs use
 * the same per-code-unit escaping. Logs are JSONL with a 'session' header
 * line, zstd-compressed with the .jsonl.zstd suffix.
 *
 * zstd support requires Node >= 22.15 (zlib.zstdDecompressSync); on older
 * Node the readers degrade gracefully instead of crashing the plugin.
 *
 * @module dsh-report-studio/lib/sessions
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

/**
 * Escape one path segment the way dsh-session-persistence-jsonl does:
 * safe characters survive, everything else becomes '~' + 4 uppercase hex
 * UTF-16 code units; '.' and '..' are escaped to prevent traversal.
 * @param {string} raw - non-empty segment.
 * @returns {string} escaped segment.
 */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/**
 * The project directory key for one workspace path (official algorithm).
 * @param {string} cwd - workspace path.
 * @returns {string} filesystem-safe project directory name.
 */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  const slug = readable.replace(/^-+/, '') || 'root'
  return '--' + slug.slice(0, 251) + '--'
}

/** Default session root when DSH_HOME is unset. */
export function defaultSessionRoot() {
  const home = process.env.DSH_HOME
  return home ? join(home, 'sessions') : join(homedir(), '.dsh', 'sessions')
}

/** Whether the runtime can decompress zstd logs natively. */
export function zstdAvailable() {
  return typeof globalThis.zlib?.zstdDecompressSync === 'function'
    || typeof process.getBuiltinModule === 'function'
    && typeof process.getBuiltinModule('node:zlib')?.zstdDecompressSync === 'function'
}

/**
 * List the session log files of one workspace.
 * @param {string} root - session root ($DSH_HOME/sessions).
 * @param {string} cwd - workspace path.
 * @returns {Array<{id: string, path: string, mtimeMs: number}>} newest last.
 */
export function listSessionLogs(root, cwd) {
  const projectDir = join(root, projectKey(cwd))
  let entries
  try {
    entries = readdirSync(projectDir, { withFileTypes: true })
  } catch {
    return []
  }
  const logs = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('session-')) continue
    const path = join(projectDir, entry.name, 'session.jsonl.zstd')
    let stat
    try {
      stat = statSync(path)
    } catch {
      continue
    }
    logs.push({ id: entry.name, path, mtimeMs: stat.mtimeMs })
  }
  logs.sort((a, b) => a.mtimeMs - b.mtimeMs)
  return logs
}

/**
 * Parse one decompressed session log into its header and event lines.
 * Unknown line types (including packed '*-chunks' records) are skipped.
 * @param {string} text - decompressed JSONL content.
 * @returns {{header: object|null, events: Array<object>}}
 */
export function parseSessionLog(text) {
  let header = null
  const events = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let record
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }
    if (!record || typeof record !== 'object') continue
    if (record.type === 'session') {
      header = record
      continue
    }
    if (typeof record.type === 'string' && typeof record.seq === 'number' && record.data !== undefined) {
      events.push(record)
    }
  }
  return { header, events }
}

/**
 * Read one persisted session log (decompressing when the runtime supports it).
 * @param {string} logPath - path to a session.jsonl.zstd file.
 * @returns {{header: object|null, events: Array<object>}|null} null when unreadable.
 */
export function readSessionLog(logPath) {
  try {
    const bytes = readFileSync(logPath)
    let text
    if (logPath.endsWith('.zstd')) {
      if (!zstdAvailable()) return null
      text = globalThis.zlib?.zstdDecompressSync
        ? globalThis.zlib.zstdDecompressSync(bytes).toString('utf8')
        : process.getBuiltinModule('node:zlib').zstdDecompressSync(bytes).toString('utf8')
    } else {
      text = bytes.toString('utf8')
    }
    return parseSessionLog(text)
  } catch {
    return null
  }
}

/**
 * Read every persisted session log of one workspace, newest last.
 * @param {string} root - session root ($DSH_HOME/sessions).
 * @param {string} cwd - workspace path.
 * @param {string} [excludeId] - skip this session id (the live caller).
 * @returns {Array<{id: string, header: object|null, events: Array<object>}>}
 */
export function readWorkspaceSessions(root, cwd, excludeId) {
  const logs = listSessionLogs(root, cwd)
  const sessions = []
  for (const entry of logs) {
    if (entry.id === excludeId) continue
    const parsed = readSessionLog(entry.path)
    if (parsed === null) continue
    sessions.push({ id: entry.id, header: parsed.header, events: parsed.events })
  }
  return sessions
}
