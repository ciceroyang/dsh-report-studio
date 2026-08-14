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
  return { templatesDirs }
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
      const today = new Date().toISOString().slice(0, 10)
      const path = typeof args.path === 'string' && args.path.trim() !== ''
        ? args.path.trim()
        : 'reports/' + kind + '-' + today + '.md'
      const artifacts = Array.isArray(args.artifacts)
        ? args.artifacts.filter((entry) => typeof entry === 'string' && entry !== '')
        : []
      const result = saveReport({
        cwd: session.header?.cwd ?? process.cwd(),
        path,
        content,
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
