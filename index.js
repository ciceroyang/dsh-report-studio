/**
 * dsh-report-studio host plugin.
 *
 * Registers two model tools (report_generate, report_save) and one runtime
 * skill (work-report). The skill teaches the agent the full workflow; the
 * tools do deterministic data extraction, template rendering, safe persistence
 * and receipt hashing. No client half in this version: reports are plain
 * Markdown files in the session workspace.
 *
 * @module dsh-report-studio
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { extractSession } from './lib/extract.js'
import { loadTemplate, renderTemplate, REPORT_KINDS, hasUnfilledProse, parseReportKind } from './lib/templates.js'
import { saveReport } from './lib/save.js'
import { defaultSessionRoot, readWorkspaceSessions } from './lib/sessions.js'
import { aggregateSessions } from './lib/aggregate.js'
import { buildFeishuPayload, buildNotionPayload, postJson } from './lib/publish.js'
import { verifyReportFile } from './lib/verify.js'
import { verifyReportDirectory } from './lib/verify-dir.js'

export const name = 'report-studio'

export const inject = ['tools']

/** Skill body shipped inside this package. */
const SKILL_FILE = fileURLToPath(new URL('./skills/work-report/SKILL.md', import.meta.url))

const SKILL_NAME = 'work-report'
const SKILL_DESCRIPTION = '会话工作交付:把当前会话生成工作日报/周报/交接文档/公众号文章并落盘(附可验证凭据)'

/** Validate and normalize the plugin config from cordis.patch.yml. */
function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  let templatesDirs = []
  if (Array.isArray(raw.templatesDirs)) {
    templatesDirs = raw.templatesDirs.filter((entry) => typeof entry === 'string' && entry !== '')
  } else if (typeof raw.templatesDirs === 'string' && raw.templatesDirs !== '') {
    templatesDirs = [raw.templatesDirs]
  }
  const publish = {}
  if (raw.publish && typeof raw.publish === 'object') {
    publish.feishuWebhook = typeof raw.publish.feishuWebhook === 'string' ? raw.publish.feishuWebhook : null
    publish.notionToken = typeof raw.publish.notionToken === 'string' ? raw.publish.notionToken : null
    publish.notionParentPageId = typeof raw.publish.notionParentPageId === 'string' ? raw.publish.notionParentPageId : null
  }
  return {
    templatesDirs,
    publish: {
      feishuWebhook: publish.feishuWebhook ?? process.env.FEISHU_WEBHOOK ?? null,
      notionToken: publish.notionToken ?? process.env.NOTION_TOKEN ?? null,
      notionParentPageId: publish.notionParentPageId ?? process.env.NOTION_PARENT_PAGE_ID ?? null,
    },
  }
}

/**
 * Bind the caller session of a tool execution.
 * @param {object} exec - ToolRunContext.
 * @returns {object} the agent session.
 */
function callerSession(exec) {
  const agent = exec.agent
  if (!agent || !agent.session) {
    throw new Error('report tools require an agent-bound session')
  }
  return agent.session
}

/**
 * Register tools and the work-report skill.
 * @param {import('@deepseek-ai/cordis').Context} ctx - cordis context.
 * @param {object} [config] - optional plugin config.
 */
export function apply(ctx, config) {
  const settings = normalizeConfig(config)

  const disposers = []

  // Runtime skill: teaches the agent the full report workflow on demand.
  const skills = ctx.get('skills')
  if (skills && typeof skills.register === 'function') {
    try {
      const content = readFileSync(SKILL_FILE, 'utf8')
      disposers.push(skills.register({
        name: SKILL_NAME,
        description: SKILL_DESCRIPTION,
        content,
        source: 'runtime',
        provider: 'dsh-report-studio',
      }))
    } catch (error) {
      ctx.logger?.warn?.('dsh-report-studio: failed to register work-report skill: ' + String(error))
    }
  }

  // Human command: instant draft preview without a model round trip.
  const commands = ctx.get('commands')
  if (commands && typeof commands.register === 'function') {
    disposers.push(commands.register({
      name: 'report',
      description: '即时预览本次会话的报告草稿(daily/weekly/handoff/article)',
      input: { hint: 'daily | weekly | handoff | article' },
      handler(invocation) {
        try {
          const kind = parseReportKind(invocation.rawInput)
          const session = invocation.agent?.session
          if (!session) return { kind: 'error', text: '/report 需要一个进行中的会话。' }
          const data = extractSession(session.events, session)
          const template = loadTemplate(kind, settings.templatesDirs)
          const draft = renderTemplate(template, data)
          return {
            kind: 'success',
            text: '已生成 ' + kind + ' 草稿预览(占位段落待填)。发送「填好并保存到 reports/」让我完成剩余步骤。\n\n' + draft,
          }
        } catch (error) {
          return { kind: 'error', text: String(error?.message ?? error) }
        }
      },
    }))
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'report_generate',
    description:
      '把当前会话整理成工作交付文档草稿(日报/周报/交接文档/公众号文章)。' +
      '返回带会话硬数据(任务、统计、工具、文件、错误)与[[待写:…]]标记的 Markdown 草稿;' +
      '填充完所有标记后用 report_save 保存。',
    parameters: {
      kind: {
        type: 'string',
        enum: REPORT_KINDS,
        required: true,
        description: '文档类型: daily=工作日报, weekly=周报, handoff=交接文档, article=公众号文章',
      },
      title: {
        type: 'string',
        description: '可选自定义标题;省略时使用会话标题或默认标题',
      },
      period: {
        type: 'string',
        description: '可选周期说明,如"2026-08-11 ~ 2026-08-17";周报模板使用',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const session = callerSession(exec)
      const data = extractSession(session.events, session)
      if (typeof args.title === 'string' && args.title.trim() !== '') {
        data.titleOverride = args.title.trim()
      }
      if (typeof args.period === 'string' && args.period.trim() !== '') {
        data.period = args.period.trim()
      }
      const template = loadTemplate(args.kind, settings.templatesDirs)
      return renderTemplate(template, data)
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'report_week',
    description:
      '聚合本周工作区内所有历史会话(读取 $DSH_HOME/sessions 下的持久化日志)+ 当前会话,' +
      '生成周报草稿。历史日志读取需要 Node >= 22.15(内置 zstd),更老版本只聚合当前会话。' +
      '填充完所有 [[待写:…]] 标记后用 report_save 保存。',
    parameters: {
      title: {
        type: 'string',
        description: '可选自定义标题;省略时使用默认周报标题',
      },
      period: {
        type: 'string',
        description: '可选周期说明,如"2026-08-11 ~ 2026-08-17"',
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(args, exec) {
      const session = callerSession(exec)
      const cwd = session.header?.cwd ?? process.cwd()
      const entries = readWorkspaceSessions(defaultSessionRoot(), cwd, String(session.id))
      const data = aggregateSessions(entries, {
        id: session.id,
        header: session.header ?? {},
        events: session.events,
      }, cwd)
      if (typeof args.title === 'string' && args.title.trim() !== '') {
        data.titleOverride = args.title.trim()
      }
      if (typeof args.period === 'string' && args.period.trim() !== '') {
        data.period = args.period.trim()
      }
      const template = loadTemplate('weekly', settings.templatesDirs)
      return renderTemplate(template, data)
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'report_publish',
    description:
      '把报告发布到飞书(自定义机器人 webhook)或 Notion(页面),target=dry 时只预览载荷不发请求。' +
      '飞书需要配置 publish.feishuWebhook 或环境变量 FEISHU_WEBHOOK;' +
      'Notion 需要 publish.notionToken + publish.notionParentPageId(或 NOTION_TOKEN / NOTION_PARENT_PAGE_ID)。' +
      'content 直接传报告全文;或省略 content 改用 path 读取已保存的报告文件。',
    parameters: {
      target: {
        type: 'string',
        enum: ['feishu', 'notion', 'dry'],
        required: true,
        description: '发布目标: feishu=飞书机器人, notion=Notion 页面, dry=只预览载荷',
      },
      content: {
        type: 'string',
        description: '报告 Markdown 全文;省略时从 path 读取',
      },
      path: {
        type: 'string',
        description: '已保存报告文件的路径(工作区内);content 省略时使用',
      },
      title: {
        type: 'string',
        description: '可选标题;飞书作为前缀,Notion 作为页面标题',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: '发布结果: ' + value.target + ' ok=' + value.ok + ' status=' + value.status + ' — ' + value.detail,
      }],
    },
    async execute(args, exec) {
      const session = callerSession(exec)
      const cwd = session.header?.cwd ?? process.cwd()
      let content = typeof args.content === 'string' ? args.content : ''
      if (content.trim() === '' && typeof args.path === 'string' && args.path.trim() !== '') {
        const { readFileSync } = await import('node:fs')
        const { resolveInside } = await import('./lib/save.js')
        content = readFileSync(resolveInside(cwd, args.path), 'utf8')
      }
      if (content.trim() === '') throw new Error('publish needs content or a readable path')
      const title = typeof args.title === 'string' ? args.title.trim() : '工作交付报告'

      if (args.target === 'dry') {
        const feishu = buildFeishuPayload(content, title)
        const notionParent = settings.publish.notionParentPageId ?? 'NOTION_PARENT_PAGE_ID'
        const notion = buildNotionPayload(content, title, notionParent)
        return {
          target: 'dry',
          ok: true,
          status: 0,
          detail: '载荷预览(未发送)',
          preview: {
            feishu: { msg_type: feishu.msg_type, bytes: feishu.content.text.length },
            notion: { parent: notionParent, blocks: notion.children.length },
          },
        }
      }

      if (args.target === 'feishu') {
        const webhook = settings.publish.feishuWebhook
        if (!webhook) throw new Error('未配置飞书 webhook: cordis 配置 publish.feishuWebhook 或环境变量 FEISHU_WEBHOOK')
        const payload = buildFeishuPayload(content, title)
        const result = await postJson(webhook, payload)
        return { target: 'feishu', ok: result.ok, status: result.status, detail: result.ok ? '已发送' : result.text }
      }

      const token = settings.publish.notionToken
      const parent = settings.publish.notionParentPageId
      if (!token || !parent) throw new Error('未配置 Notion: publish.notionToken + publish.notionParentPageId(或 NOTION_TOKEN / NOTION_PARENT_PAGE_ID)')
      const payload = buildNotionPayload(content, title, parent)
      const result = await postJson('https://api.notion.com/v1/pages', payload, {
        Authorization: 'Bearer ' + token,
        'Notion-Version': '2022-06-28',
      })
      return { target: 'notion', ok: result.ok, status: result.status, detail: result.ok ? '已创建页面' : result.text }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'report_verify',
    description:
      '独立核验已保存报告的凭据块:重算报告 SHA-256 与每个产物哈希,逐项给出 match/missing。' +
      '交付前用它自检,或复核别人交来的报告是否被改动。',
    parameters: {
      path: {
        type: 'string',
        required: true,
        description: '已保存报告文件路径(工作区内);dir 未提供时核验单文件',
      },
      dir: {
        type: 'string',
        description: '可选:核验整个目录下的全部 .md 报告(相对工作区);提供时忽略 path 的单文件语义',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: value.mode === 'batch'
          ? '批量核验: ' + value.total + ' 份报告中 ' + value.matched + ' 匹配 / ' + value.mismatched + ' 不匹配 / ' + value.noReceipt + ' 无凭据'
          : '核验结果: 报告哈希 ' + (value.reportMatch ? '✓ 匹配' : '✗ 不匹配') +
            (value.artifacts.length > 0
              ? ' | 产物 ' + value.artifacts.filter((a) => a.match).length + '/' + value.artifacts.length + ' 匹配' +
                (value.artifacts.some((a) => a.missing) ? '(含缺失)' : '')
              : ''),
      }],
    },
    async execute(args, exec) {
      const session = callerSession(exec)
      const cwd = session.header?.cwd ?? process.cwd()
      const { resolveInside } = await import('./lib/save.js')

      if (typeof args.dir === 'string' && args.dir.trim() !== '') {
        const summary = verifyReportDirectory(cwd, args.dir.trim())
        return { mode: 'batch', ...summary }
      }

      const result = verifyReportFile(resolveInside(cwd, args.path), cwd)
      if (!result.receiptPresent) {
        return {
          mode: 'single',
          reportMatch: false,
          receiptPresent: false,
          claimed: null,
          actual: result.actual,
          artifacts: [],
          detail: '文件不含凭据块,无法核验',
        }
      }
      return {
        mode: 'single',
        reportMatch: result.reportMatch,
        receiptPresent: true,
        claimed: result.claimed,
        actual: result.actual,
        artifacts: result.artifacts,
        detail: result.reportMatch ? '报告与产物全部一致' : '发现不一致,逐项见 artifacts',
      }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'report_save',
    description:
      '把填好的报告 Markdown 写入会话工作区并追加可验证凭据块(会话/时间/报告哈希/产物哈希)。' +
      'content 传最终稿全文(不含凭据块);artifacts 传产出文件路径列表;path 省略时存到 reports/ 目录。',
    parameters: {
      content: {
        type: 'string',
        required: true,
        description: '最终报告 Markdown 全文,所有[[待写:…]]标记必须已替换',
      },
      path: {
        type: 'string',
        description: '目标文件路径(相对或工作区内绝对路径);省略时自动生成 reports/<kind>-<date>.md',
      },
      kind: {
        type: 'string',
        enum: REPORT_KINDS,
        description: '文档类型,用于默认文件名;省略时用 daily',
      },
      artifacts: {
        type: 'array',
        description: '报告引用的产出文件路径列表(可空);存在的文件会被哈希进凭据',
      },
      format: {
        type: 'string',
        enum: ['md', 'html'],
        description: '输出格式;md=Markdown(默认),html=独立可转发的 HTML 文档(凭据以可核验原文块嵌入)',
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{
        type: 'text',
        text: '已保存: ' + value.path + '\n报告 SHA-256: ' + value.sha256 +
          (value.artifacts.length > 0 ? '\n已核验产物: ' + value.artifacts.map((a) => a.path).join(', ') : ''),
      }],
    },
    async execute(args, exec) {
      const session = callerSession(exec)
      const content = typeof args.content === 'string' ? args.content : ''
      if (content.trim() === '') throw new Error('empty report content')
      if (hasUnfilledProse(content)) {
        throw new Error('report still contains unfilled [[待写:…]] slots; fill every slot before saving')
      }
      const kind = typeof args.kind === 'string' && REPORT_KINDS.includes(args.kind) ? args.kind : 'daily'
      const format = args.format === 'html' ? 'html' : 'md'
      const today = new Date().toISOString().slice(0, 10)
      const ext = format === 'html' ? '.html' : '.md'
      const path = typeof args.path === 'string' && args.path.trim() !== ''
        ? args.path.trim()
        : 'reports/' + kind + '-' + today + ext
      const artifacts = Array.isArray(args.artifacts)
        ? args.artifacts.filter((entry) => typeof entry === 'string' && entry !== '')
        : []
      const result = saveReport({
        cwd: session.header?.cwd ?? process.cwd(),
        path,
        content,
        format,
        sessionId: String(session.id),
        generatedAt: new Date().toISOString(),
        artifacts,
      })
      return { path: result.path, sha256: result.sha256, artifacts: result.artifacts }
    },
  })))

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // disposal failures must not break unload
      }
    }
  }
}
