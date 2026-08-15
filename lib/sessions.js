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

/** Whether the runtime can decompress zstd logs natively (Node >= 22.15). */
export function zstdAvailable() {
  if (typeof process.getBuiltinModule !== 'function') return false
  const zlib = process.getBuiltinModule('node:zlib')
  return zlib !== undefined && typeof zlib.zstdDecompressSync === 'function'
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

const ZSTD_MAGIC = 0xFD2FB528

/**
 * Structurally scan a concatenated zstd container for complete frame ranges.
 * Ported from the official dsh-session-persistence-jsonl format.ts algorithm
 * (MIT): magic, frame-header descriptor, optional fields, then block headers
 * until the last block, plus the optional content checksum.
 * @param {Buffer} buffer - complete bytes of the compressed artifact.
 * @returns {Array<{start: number, end: number}>} complete frames in order.
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) {
      throw new Error('corrupt zstd session log: invalid frame magic at byte ' + offset)
    }
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0
      ? (singleSegment ? 1 : 0)
      : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const blockSize = blockHeader >>> 3
      if (blockType === 0x03) {
        throw new Error('corrupt zstd session log: reserved block type at byte ' + (offset - 3))
      }
      const payloadBytes = blockType === 0x01 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decompress a multi-frame zstd buffer fully. DSH session logs are written as
 * concatenated zstd frames; the one-shot zstdDecompressSync stops at the first
 * frame, so each scanned frame is decoded separately and concatenated.
 * @param {Buffer} bytes - compressed buffer.
 * @returns {string|null} full decompressed text, or null when unsupported.
 */
export function zstdDecompressAll(bytes) {
  if (!zstdAvailable()) return null
  try {
    const zlib = process.getBuiltinModule('node:zlib')
    const parts = []
    for (const frame of scanZstdFrames(bytes)) {
      parts.push(zlib.zstdDecompressSync(bytes.subarray(frame.start, frame.end)).toString('utf8'))
    }
    return parts.join('')
  } catch {
    return null
  }
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
      text = zstdDecompressAll(bytes)
      if (text === null) return null
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
