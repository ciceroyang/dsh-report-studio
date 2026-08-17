/**
 * Unit tests for the HTML export path.
 * @module dsh-report-studio/tests/html
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { markdownToHtml, wrapHtmlDocument, receiptToHtml } from '../lib/html.js'
import { saveReport } from '../lib/save.js'
import { verifyReportFile } from '../lib/verify.js'

test('markdownToHtml maps headings, bullets, fences and tables', () => {
  const html = markdownToHtml('# 标题\n\n## 小节\n\n- 点一\n- 点二\n\n正文\n\n```\ncode\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |')
  assert.ok(html.includes('<h1>标题</h1>'))
  assert.ok(html.includes('<h2>小节</h2>'))
  assert.ok(html.includes('<li>点一</li>'))
  assert.ok(html.includes('<pre><code>code</code></pre>'))
  assert.ok(html.includes('<table>'))
  assert.ok(html.includes('<td>1</td>'))
})

test('markdownToHtml escapes hostile input', () => {
  const html = markdownToHtml('# <script>alert(1)</script>')
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<script>'))
})

test('html export roundtrips through verify', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'hx-'))
  writeFileSync(join(cwd, 'artifact.txt'), 'bytes')
  const content = '# 日报\n\n今天完成三件事。\n'
  const saved = saveReport({
    cwd,
    path: 'reports/daily.html',
    content,
    format: 'html',
    sessionId: 's1',
    generatedAt: 't',
    artifacts: ['artifact.txt'],
  })
  const full = readFileSync(saved.path, 'utf8')
  assert.ok(full.includes('<h1>日报</h1>'))
  assert.ok(full.includes('<pre class="receipt">'))
  assert.ok(full.includes('报告凭据'))
  const result = verifyReportFile(saved.path, cwd)
  assert.equal(result.receiptPresent, true)
  assert.equal(result.reportMatch, true)
  assert.equal(result.artifacts[0].match, true)
  rmSync(cwd, { recursive: true, force: true })
})

test('wrapHtmlDocument embeds title and receipt', () => {
  const doc = wrapHtmlDocument('标题', '<p>x</p>', receiptToHtml('\n---\n\n## 报告凭据 Report Receipt\n'))
  assert.ok(doc.includes('<title>标题</title>'))
  assert.ok(doc.includes('报告凭据'))
  assert.ok(doc.includes('pre class="receipt"'))
})
