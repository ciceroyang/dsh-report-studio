/**
 * Unit tests for the publish payload builders.
 * @module dsh-report-studio/tests/publish
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { buildFeishuPayload, buildNotionPayload, markdownToNotionBlocks, postJson } from '../lib/publish.js'

const FENCE = String.fromCharCode(96, 96, 96)

test('buildFeishuPayload prefixes the title and shapes the payload', () => {
  const payload = buildFeishuPayload('正文内容', '我的日报')
  assert.equal(payload.msg_type, 'text')
  assert.ok(payload.content.text.startsWith('我的日报'))
  assert.ok(payload.content.text.includes('正文内容'))
})

test('buildFeishuPayload truncates oversized content', () => {
  const long = 'x'.repeat(30000)
  const payload = buildFeishuPayload(long)
  assert.ok(payload.content.text.length <= 28000 + 40)
  assert.ok(payload.content.text.includes('已截断'))
})

test('markdownToNotionBlocks maps headings, bullets, paragraphs and fences', () => {
  const md = '# 标题\n\n## 小节\n\n- 点一\n- 点二\n\n正文段落\n\n' + FENCE + '\ncode line\n' + FENCE
  const blocks = markdownToNotionBlocks(md)
  assert.equal(blocks[0].type, 'heading_1')
  assert.equal(blocks[0].heading_1.rich_text[0].text.content, '标题')
  assert.equal(blocks[1].type, 'heading_2')
  assert.equal(blocks[2].type, 'bulleted_list_item')
  assert.equal(blocks[3].type, 'bulleted_list_item')
  assert.equal(blocks[4].type, 'paragraph')
  assert.equal(blocks[5].type, 'code')
  assert.equal(blocks[5].code.rich_text[0].text.content, 'code line')
})

test('buildNotionPayload wires parent, title and children', () => {
  const payload = buildNotionPayload('# 标题\n\n正文', '页面名', 'page-123')
  assert.equal(payload.parent.page_id, 'page-123')
  assert.equal(payload.properties.title.title[0].text.content, '页面名')
  assert.ok(payload.children.length >= 2)
})

test('postJson posts to a local server and reports failures', async () => {
  const received = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      received.push({ url: req.url, body })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const result = await postJson('http://127.0.0.1:' + port + '/hook', { a: 1 }, { Authorization: 'Bearer t' })
  assert.equal(result.ok, true)
  assert.equal(result.status, 200)
  assert.equal(JSON.parse(received[0].body).a, 1)
  assert.equal(received[0].url, '/hook')
  await new Promise((resolve) => server.close(resolve))

  const failure = await postJson('http://127.0.0.1:1/unreachable', {})
  assert.equal(failure.ok, false)
})
