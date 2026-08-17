#!/usr/bin/env node
/**
 * Deterministic weekly report draft generator.
 *
 * Runs without a model: reads the workspace's persisted session logs (the
 * dsh-report-studio engines), aggregates the week, renders the weekly template
 * with all DATA sections filled, and saves the draft with [[待写:…]] prose
 * slots left for a human or an agent to complete. Pairs with launchd/cron
 * (see README "定时周报"); the official dsh-schedule tools remain the
 * in-harness option when that plugin is mounted.
 *
 * Usage:
 *   node scripts/auto-weekly.mjs <workspace-path> [--out reports/weekly-auto.md]
 *
 * @module dsh-report-studio/scripts/auto-weekly
 */

import { resolve, join } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { defaultSessionRoot, readWorkspaceSessions } from '../lib/sessions.js'
import { aggregateSessions } from '../lib/aggregate.js'
import { loadTemplate, renderTemplate } from '../lib/templates.js'

function main() {
  const argv = process.argv.slice(2)
  const outFlag = argv.indexOf('--out')
  const outPath = outFlag >= 0 && argv[outFlag + 1] ? argv[outFlag + 1] : null
  const cwdArg = argv.find((a) => !a.startsWith('--') && a !== (outFlag >= 0 ? argv[outFlag + 1] : undefined))
  if (!cwdArg) {
    console.error('usage: node scripts/auto-weekly.mjs <workspace-path> [--out <relative-path>]')
    process.exit(2)
  }
  const cwd = resolve(cwdArg)
  const entries = readWorkspaceSessions(defaultSessionRoot(), cwd, '')
  const data = aggregateSessions(entries, null, cwd)
  data.period = '自动生成(本周)'
  data.titleOverride = '本周工作周报(自动草稿)'
  const template = loadTemplate('weekly')
  const draft = renderTemplate(template, data)
  const target = resolve(cwd, outPath ?? 'reports/weekly-auto.md')
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, draft, 'utf8')
  console.log('auto draft saved: ' + target + ' (' + data.sourceCount + ' sessions, ' + data.stats.turns + ' turns)')
  console.log('prose slots left unfilled: [[待写:…]] — open a DSH session and say "填好并保存" to finish.')
}

main()
