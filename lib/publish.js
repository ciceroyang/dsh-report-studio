/**
 * Report publishing payload builders (Feishu bot webhook + Notion pages).
 *
 * Pure functions: every payload is deterministic and unit-testable. The
 * plugin only performs network I/O after these builders return, so a dry-run
 * path needs no credentials.
 *
 * @module dsh-report-studio/lib/publish
 */

const FEISHU_TEXT_MAX = 28000

/**
 * Build the Feishu custom-bot webhook text payload.
 * @param {string} content - report markdown.
 * @param {string} [title] - optional title prefix.
 * @returns {{msg_type: string, content: {text: string}}} payload.
 */
export function buildFeishuPayload(content, title) {
  const prefix = typeof title === 'string' && title.trim() !== '' ? title.trim() + '\n\n' : ''
  let text = prefix + content
  if (text.length > FEISHU_TEXT_MAX) {
    text = text.slice(0, FEISHU_TEXT_MAX) + '\n\n…(内容过长已截断,完整版见源文件)'
  }
  return { msg_type: 'text', content: { text } }
}

/**
 * Convert minimal Markdown to Notion block objects. Tables and receipt blocks
 * degrade to code blocks; unknown constructs degrade to paragraphs.
 * @param {string} markdown - report content.
 * @returns {Array<object>} Notion children blocks.
 */
export function markdownToNotionBlocks(markdown) {
  const blocks = []
  const lines = markdown.split('\n')
  let code = false
  let codeLines = []
  const flushCode = () => {
    if (codeLines.length > 0) {
      blocks.push({ object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: codeLines.join('\n') } }], language: 'markdown' } })
      codeLines = []
    }
  }
  for (const raw of lines) {
    const line = raw
    if (line.startsWith('```')) {
      if (code) flushCode()
      code = !code
      continue
    }
    if (code) {
      codeLines.push(line)
      continue
    }
    if (line.trim() === '') continue
    if (line.startsWith('### ')) {
      blocks.push({ object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: line.slice(4) } }] } })
    } else if (line.startsWith('## ')) {
      blocks.push({ object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] } })
    } else if (line.startsWith('# ')) {
      blocks.push({ object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } })
    } else if (line.startsWith('- ')) {
      blocks.push({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } })
    } else if (line.startsWith('|')) {
      // Tables are not converted; keep the row text as a paragraph so nothing is lost.
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } })
    } else {
      blocks.push({ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } })
    }
  }
  flushCode()
  return blocks
}

/**
 * Build the Notion page-creation payload.
 * @param {string} content - report markdown.
 * @param {string} title - page title.
 * @param {string} parentPageId - parent page id.
 * @returns {{parent: {page_id: string}, properties: object, children: Array<object>}} payload.
 */
export function buildNotionPayload(content, title, parentPageId) {
  return {
    parent: { page_id: parentPageId },
    properties: {
      title: { title: [{ text: { content: title } }] },
    },
    children: markdownToNotionBlocks(content),
  }
}

/**
 * Post one payload over HTTPS with a bounded timeout.
 * @param {string} url - endpoint.
 * @param {object} body - JSON body.
 * @param {Record<string, string>} headers - extra headers.
 * @returns {Promise<{ok: boolean, status: number, text: string}>} result.
 */
export async function postJson(url, body, headers = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, text: text.slice(0, 400) }
  } catch (error) {
    return { ok: false, status: 0, text: String(error?.message ?? error) }
  } finally {
    clearTimeout(timer)
  }
}
