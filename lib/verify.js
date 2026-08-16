/**
 * Independent receipt verification for saved reports.
 *
 * Recomputes the report SHA-256 over the body (content minus the receipt
 * block) and every claimed artifact hash from disk. Verifiable delivery is
 * the product thesis; this module turns it from a manual check into a tool.
 *
 * @module dsh-report-studio/lib/verify
 */

import { readFileSync, statSync } from 'node:fs'
import { resolve, relative, isAbsolute, sep } from 'node:path'
import { sha256 } from './receipt.js'

const RECEIPT_HEADING = '## 报告凭据 Report Receipt'

/**
 * Split a saved report into its body and its receipt claims.
 * @param {string} full - complete report file content.
 * @returns {{body: string, claims: object|null}} body text and parsed claims.
 */
export function parseReceipt(full) {
  const marker = '---'
  const headingIdx = full.indexOf(RECEIPT_HEADING)
  if (headingIdx < 0) return { body: full, claims: null }
  const sepIdx = full.lastIndexOf(marker, headingIdx)
  // The newline before the separator belongs to the receipt block, not the
  // body: saveReport hashes exactly the content it was given.
  const cut = full.lastIndexOf('\n', sepIdx)
  const body = cut >= 0 ? full.slice(0, cut) : full.slice(0, sepIdx)
  const receipt = full.slice(headingIdx)
  const claims = {
    session: pickField(receipt, '会话 Session', 'Session'),
    reportSha: pickHash(receipt, 0),
    artifacts: [],
  }
  const META_LABELS = ['会话', 'Session', '工作区', 'Workspace', '生成时间', 'Generated', '报告哈希', 'Report SHA']
  const rows = receipt.split('\n').filter((line) => line.includes('|') && !line.includes('项') && !line.includes('---'))
  for (const row of rows) {
    const cells = row.split('|').map((c) => c.trim()).filter(Boolean)
    if (cells.length >= 2 && /^[0-9a-f]{64}$/.test(cells[1] ?? '') && !META_LABELS.some((label) => cells[0].includes(label))) {
      claims.artifacts.push({ path: cells[0], sha: cells[1] })
    }
  }
  return { body, claims }
}

function pickField(receipt, zhLabel, enLabel) {
  for (const line of receipt.split('\n')) {
    if (line.includes(zhLabel) || line.includes(enLabel)) {
      const m = line.match(/\|([^|]+)\|/)
      if (m) return m[1].trim()
    }
  }
  return null
}

function pickHash(receipt, index) {
  const hashes = receipt.match(/[0-9a-f]{64}/g) ?? []
  return hashes[index] ?? null
}

/**
 * Verify a saved report file against its own receipt.
 * @param {string} filePath - absolute path to the report.
 * @param {string} cwd - workspace root for artifact resolution.
 * @returns {{body: string, reportMatch: boolean, claimed: string|null, actual: string, artifacts: Array<object>, receiptPresent: boolean}} result.
 */
export function verifyReportFile(filePath, cwd) {
  const full = readFileSync(filePath, 'utf8')
  const { body, claims } = parseReceipt(full)
  const actual = sha256(body)
  const reportMatch = claims !== null && claims.reportSha === actual
  const artifacts = []
  if (claims !== null) {
    for (const artifact of claims.artifacts) {
      const entry = { path: artifact.path, claimed: artifact.sha, actual: null, match: false, missing: true }
      try {
        const target = resolveWorkspace(cwd, artifact.path)
        statSync(target)
        entry.actual = sha256(readFileSync(target, 'utf8'))
        entry.match = entry.actual === artifact.sha
        entry.missing = false
      } catch {
        // stays missing
      }
      artifacts.push(entry)
    }
  }
  return {
    body,
    receiptPresent: claims !== null,
    claimed: claims?.reportSha ?? null,
    actual,
    reportMatch,
    artifacts,
  }
}

/** Workspace-confined artifact path resolution (mirrors lib/save.js). */
function resolveWorkspace(cwd, requested) {
  const base = resolve(cwd)
  const candidate = isAbsolute(requested) ? resolve(requested) : resolve(base, requested)
  const rel = relative(base, candidate)
  if (rel.startsWith('..' + sep) || rel === '..' || isAbsolute(rel)) {
    throw new Error('artifact path escapes the workspace')
  }
  return candidate
}
