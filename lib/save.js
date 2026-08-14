/**
 * Safe report persistence inside the session workspace.
 *
 * Path policy: the final absolute path must stay inside the session cwd.
 * Absolute inputs, '..' traversal, and escapes through the workspace root are
 * rejected with a precise error code before any bytes are written.
 *
 * @module dsh-report-studio/lib/save
 */

import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { buildReceipt, sha256 } from './receipt.js'

/**
 * Resolve a requested report path to an absolute path inside cwd.
 * @param {string} cwd - session workspace root.
 * @param {string} requested - user/model-supplied path (absolute or relative).
 * @returns {string} absolute target path inside cwd.
 * @throws {Error} with code REPORT_PATH_ESCAPE when the path leaves cwd.
 */
export function resolveInside(cwd, requested) {
  if (typeof requested !== 'string' || requested.trim() === '') {
    throw new Error('empty report path')
  }
  const base = resolve(cwd)
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(base, requested)
  const rel = relative(base, candidate)
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    const error = new Error('report path escapes the session workspace: ' + requested)
    error.code = 'REPORT_PATH_ESCAPE'
    throw error
  }
  return candidate
}

/**
 * Hash an artifact file for the receipt. Missing or escaping paths are
 * skipped silently: the receipt only records verified files.
 * @param {string} cwd - session workspace root.
 * @param {string} artifactPath - requested artifact path.
 * @returns {{path: string, sha256: string}|null} facts, or null when unverifiable.
 */
function hashArtifact(cwd, artifactPath) {
  let resolved
  try {
    resolved = resolveInside(cwd, artifactPath)
    statSync(resolved)
  } catch {
    return null
  }
  try {
    const bytes = readFileSync(resolved)
    return { path: artifactPath, sha256: sha256(bytes.toString('utf8')) }
  } catch {
    return null
  }
}

/**
 * Write a report file and append its receipt.
 * @param {object} input - save request.
 * @param {string} input.cwd - session workspace root.
 * @param {string} input.path - requested target path.
 * @param {string} input.content - final report Markdown (without receipt).
 * @param {string} input.sessionId - generating session id.
 * @param {string} input.generatedAt - ISO timestamp.
 * @param {string[]} [input.artifacts] - artifact paths to hash; missing files are skipped.
 * @returns {{path: string, sha256: string, artifacts: Array<{path: string, sha256: string}>}} saved facts.
 */
export function saveReport(input) {
  const target = resolveInside(input.cwd, input.path)
  const reportSha256 = sha256(input.content)
  const artifacts = []
  for (const artifactPath of input.artifacts ?? []) {
    if (typeof artifactPath !== 'string' || artifactPath === '') continue
    const facts = hashArtifact(input.cwd, artifactPath)
    if (facts !== null) artifacts.push(facts)
  }
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, input.content + buildReceipt({
    sessionId: input.sessionId,
    cwd: input.cwd,
    generatedAt: input.generatedAt,
    reportSha256,
    artifacts,
  }), 'utf8')
  return { path: target, sha256: reportSha256, artifacts }
}
