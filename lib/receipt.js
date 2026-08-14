/**
 * Verifiable receipt block for saved reports.
 *
 * The receipt pins the generating session, workspace, generation time, the
 * report's own SHA-256, and the SHA-256 of every artifact the report claims.
 * The report hash is computed over the content WITHOUT the receipt, so the
 * receipt can be appended after hashing.
 *
 * @module dsh-report-studio/lib/receipt
 */

import { createHash } from 'node:crypto'

/**
 * SHA-256 hex digest of one UTF-8 string.
 * @param {string} text - content to hash.
 * @returns {string} 64-char hex digest.
 */
export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * Render the receipt Markdown block.
 * @param {object} input - receipt facts.
 * @param {string} input.sessionId - generating session id.
 * @param {string|null} input.cwd - session workspace.
 * @param {string} input.generatedAt - ISO timestamp.
 * @param {string} input.reportSha256 - hash of the report content without the receipt.
 * @param {Array<{path: string, sha256: string}>} [input.artifacts] - hashed artifacts.
 * @returns {string} Markdown block to append.
 */
export function buildReceipt(input) {
  const lines = [
    '',
    '---',
    '',
    '## 报告凭据 Report Receipt',
    '',
    '| 项 | 值 |',
    '|---|---|',
    '| 会话 Session | ' + input.sessionId + ' |',
    '| 工作区 Workspace | ' + (input.cwd ?? '未知') + ' |',
    '| 生成时间 Generated | ' + input.generatedAt + ' |',
    '| 报告哈希 Report SHA-256 | ' + input.reportSha256 + ' |',
  ]
  if (input.artifacts && input.artifacts.length > 0) {
    lines.push('| 产物 Artifacts | |')
    for (const artifact of input.artifacts) {
      lines.push('| ' + artifact.path + ' | ' + artifact.sha256 + ' |')
    }
  } else {
    lines.push('| 产物 Artifacts | （未声明） |')
  }
  lines.push('')
  return lines.join('\n')
}
