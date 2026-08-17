/**
 * Minimal Markdown -> HTML for standalone report export.
 *
 * Deliberately small: headings, bullets, fenced code, table rows, paragraphs,
 * inline bold and code. Everything is HTML-escaped first. The receipt block
 * is NOT converted here — saveReport embeds it as a raw <pre> so the pipe
 * table stays verifiable by lib/verify.js without a second parser.
 *
 * @module dsh-report-studio/lib/html
 */

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(text) {
  let out = escapeHtml(text)
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>')
  return out
}

/**
 * Convert Markdown body text to HTML fragments.
 * @param {string} markdown - report body (without the receipt block).
 * @returns {string} HTML body.
 */
export function markdownToHtml(markdown) {
  const out = []
  const lines = markdown.split('\n')
  let code = false
  let codeLines = []
  const flushCode = () => {
    if (codeLines.length > 0) {
      out.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>')
      codeLines = []
    }
  }
  let inTable = false
  const flushTable = () => {
    if (inTable) { out.push('</table>'); inTable = false }
  }
  for (const raw of lines) {
    const line = raw
    if (line.startsWith('```')) {
      flushTable()
      if (code) flushCode()
      code = !code
      continue
    }
    if (code) { codeLines.push(line); continue }
    if (line.trim() === '') { flushTable(); continue }
    if (line.startsWith('### ')) { flushTable(); out.push('<h3>' + inline(line.slice(4)) + '</h3>'); continue }
    if (line.startsWith('## ')) { flushTable(); out.push('<h2>' + inline(line.slice(3)) + '</h2>'); continue }
    if (line.startsWith('# ')) { flushTable(); out.push('<h1>' + inline(line.slice(2)) + '</h1>'); continue }
    if (line.startsWith('- ')) { flushTable(); out.push('<li>' + inline(line.slice(2)) + '</li>'); continue }
    if (line.startsWith('|')) {
      if (!inTable) { out.push('<table>'); inTable = true }
      const cells = line.split('|').map((c) => c.trim()).filter((c, i, arr) => !(i === 0 && c === '') && c !== '---')
      if (cells.length === 0) continue
      const isSep = cells.every((c) => /^-+$/.test(c))
      if (isSep) continue
      out.push('<tr>' + cells.map((c) => '<td>' + inline(c) + '</td>').join('') + '</tr>')
      continue
    }
    flushTable()
    out.push('<p>' + inline(line) + '</p>')
  }
  flushCode()
  flushTable()
  return out.join('\n')
}

/**
 * Embed the raw markdown receipt as an escaped pre block so its pipe table
 * remains verifiable by lib/verify.js without a second parser.
 * @param {string} raw - raw markdown receipt.
 * @returns {string} HTML fragment.
 */
export function receiptToHtml(raw) {
  return '<pre class="receipt">' + escapeHtml(raw) + '</pre>'
}

/** Markers for the embedded markdown source block (used by verify). */
export const SOURCE_OPEN = '<script type="text/plain" id="report-source">'
export const SOURCE_CLOSE = '</script>'

/**
 * Wrap an HTML body into a standalone styled document. The original Markdown
 * source is embedded in a hidden block so lib/verify.js can re-hash it — the
 * HTML file stays fully self-contained and auditable.
 * @param {string} title - document title.
 * @param {string} bodyHtml - converted body.
 * @param {string} receiptHtml - receipt fragment (use receiptToHtml).
 * @param {string} sourceMd - original markdown content.
 * @returns {string} full HTML document.
 */
export function wrapHtmlDocument(title, bodyHtml, receiptHtml, sourceMd) {
  return '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + escapeHtml(title) + '</title><style>' +
    'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:0 auto;padding:32px;color:#1d2530;line-height:1.7}' +
    'h1{font-size:24px}h2{font-size:19px;border-bottom:1px solid #e3e8ee;padding-bottom:6px}h3{font-size:16px}' +
    'li{margin:4px 0}code{background:#f2f5f8;padding:1px 5px;border-radius:4px;font-family:Menlo,monospace;font-size:13px}' +
    'pre{background:#0f1420;color:#dde3ee;padding:14px;border-radius:8px;overflow-x:auto}' +
    'table{border-collapse:collapse;margin:10px 0}td{border:1px solid #d8dee6;padding:6px 10px;font-size:13px}' +
    'pre.receipt{background:#fbf7ef;color:#6f5a2e;border:1px dashed #d8c9a0;white-space:pre-wrap}' +
    '</style></head><body>' + bodyHtml + receiptHtml + SOURCE_OPEN + escapeHtml(sourceMd) + SOURCE_CLOSE + '</body></html>'
}
