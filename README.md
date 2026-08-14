# dsh-report-studio

[![CI](https://github.com/ciceroyang/dsh-report-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/ciceroyang/dsh-report-studio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-00c2ff.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-00c2ff.svg)](https://github.com/topics/dsh-plugin)

**When your agent finishes work, have it write up what happened — into something you can actually hand over.**

The first "session → work deliverable" plugin in the DeepSeek Harness ecosystem:
turn one session into a **daily report / weekly report / handoff document / WeChat-article draft**,
each sealed with a verifiable receipt block (report hash + artifact hashes), so reports
cannot be embellished.

> Status: 0.1.0, usable. Tracks the Harness developer preview; interfaces may change.

## Features

- **4 ready templates**: `daily`, `weekly`, `handoff`, `article`
- **Deterministic session extraction**: user asks, todo snapshots, turn/step stats,
  token ledger, tool calls, produced files, shell commands, errors and blocks —
  all read from the durable session event log, never from the model's memory
- **Verifiable receipt block**: session id, workspace, generation time, report
  SHA-256 and artifact SHA-256 appended to every saved report
- **Safe persistence**: target paths are confined to the session workspace;
  absolute-path escapes and `..` traversal are rejected
- **Customizable templates**: override built-in templates wholesale (placeholders below)
- **No build step**: plain ESM; install via `dsh plugin` or load with a `--patch` overlay

## Install

Requires Node.js ≥ 18 and DeepSeek Harness.

### Option 1: plugin install (needs pnpm)

    dsh plugin --profile web add github:ciceroyang/dsh-report-studio

### Option 2: local source overlay (no pnpm)

    git clone https://github.com/ciceroyang/dsh-report-studio.git

    # my-report.yml (the plugin path MUST be absolute):
    # - insert:
    #     - id: report-studio
    #       name: '/absolute/path/to/dsh-report-studio/index.js'

    dsh web --patch ./my-report.yml

## Usage

Tell the agent either of:

- "Write today's work report."
- "Turn this session into a handoff document for the next person."

The bundled `work-report` skill teaches the agent the full workflow:

1. `report_generate` produces a draft with hard data plus `[[待写:…]]` prose slots;
2. the agent fills the slots from session facts only;
3. `report_save` writes the file and appends the receipt;
4. the agent replies with the saved path and the report hash.

Default save location: `reports/<kind>-<date>.md` inside the workspace.

For an instant draft preview without a model round trip, type the slash command:

    /report daily     # weekly / handoff / article also work

## Tools

### report_generate

| Argument | Required | Meaning |
|---|---|---|
| `kind` | yes | `daily` / `weekly` / `handoff` / `article` |
| `title` | no | custom title; falls back to the session title |
| `period` | no | period label (e.g. "2026-08-11 ~ 2026-08-17") for weekly |

Returns the full Markdown draft; prose sections are `[[待写:…]]` markers.

### report_save

| Argument | Required | Meaning |
|---|---|---|
| `content` | yes | final Markdown (receipt is appended automatically) |
| `path` | no | target path; defaults to `reports/<kind>-<date>.md` |
| `kind` | no | used for the default filename |
| `artifacts` | no | produced file paths; existing files get hashed into the receipt |

Returns the absolute path, report SHA-256, and verified artifact hashes.

### report_week

Aggregates every persisted session of the current workspace (logs under
`$DSH_HOME/sessions`) plus the live session into a weekly draft with a
per-session table. Reading historical logs needs Node ≥ 22.15 (built-in zstd);
older Node degrades gracefully to the current session only.

| Argument | Required | Meaning |
|---|---|---|
| `title` | no | custom title |
| `period` | no | period label, e.g. "2026-08-11 ~ 2026-08-17" |

## Custom templates

Templates are plain Markdown with stable placeholders (data sections are filled
deterministically by the plugin):

    {{TITLE}} {{DATE}} {{PERIOD}}
    {{META}}    session id / workspace / time range / title
    {{TASKS}}   user asks + latest todo snapshot
    {{STATS}}   turns / steps / tool calls / token ledger / end reasons
    {{TOOLS}}   tool call table
    {{FILES}}   produced and read files
    {{COMMANDS}} shell commands run
    {{ERRORS}}  tool errors and blocks
    {{TIMELINE}} per-turn timeline
    {{SESSIONS}} weekly session table (report_week aggregation)

Prose sections are written as `[[待写:…]]` and must be filled before saving.

Point the plugin at a custom directory:

    - insert:
        - id: report-studio
          name: dsh-report-studio
          config:
            templatesDirs:
              - '/absolute/path/to/my-templates'

Copy any file from this repo's `templates/` directory as a starting point.

## Receipt example

    ## 报告凭据 Report Receipt

    | 项 | 值 |
    |---|---|
    | 会话 Session | session-1c1e5d0c-… |
    | 工作区 Workspace | /Users/you/project |
    | 生成时间 Generated | 2026-08-14T08:00:00.000Z |
    | 报告哈希 Report SHA-256 | 9f2c… |
    | 产物 Artifacts | README.md → 3a1b… |

## Known limitations (0.1.0)

- Weekly aggregates the **current session**; cross-session aggregation is on the roadmap.
- Persistence uses Node's `fs` directly, outside the Harness fs policy layer;
  path-escape protection lives inside the plugin.
- Report tools require an agent-bound session (web and headless both qualify).

## Docs & examples

- [中文实战教程:从零到发布](docs/tutorial-zh.md) — 完整开发复盘,含 5 个实测坑
- [Example daily report](demo/report-daily.example.md) — 真实会话产出的日报样例(凭据块)

## Contributing

Issues and PRs welcome (typos, new templates, translations, tests). Before pushing:

    npm test

## License & funding

[MIT](./LICENSE). If this saves you from writing another daily report:

- Mainland China: [Afdian](https://afdian.com/a/cicero) (pays out to Alipay; GitHub Sponsors cannot pay out there)
- Elsewhere: [GitHub Sponsors](https://github.com/sponsors/ciceroyang)

---

Built for the open-source community, in the spirit of DeepSeek Harness:
everything is a plugin.
