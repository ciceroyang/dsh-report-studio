# dsh-report-studio

[![CI](https://github.com/ciceroyang/dsh-report-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/ciceroyang/dsh-report-studio/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-00c2ff.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-00c2ff.svg)](https://github.com/topics/dsh-plugin)

**让 agent 干完活,顺手把"干了什么"写成能直接交出去的东西。**

DeepSeek Harness 生态中第一个「会话 → 工作交付物」插件:把一次会话一键变成
**工作日报 / 周报 / 交接文档 / 公众号文章**,并附上可验证的凭据块
(报告哈希 + 产物哈希),让汇报有据可查、无法注水。

> 状态:0.1.0,可用。跟随 Harness 开发者预览节奏,接口可能变化。

## 特性

- **4 套开箱即用模板**:daily(日报)、weekly(周报)、handoff(交接文档)、article(公众号文章)
- **会话硬数据自动提取**:用户诉求、任务清单、回合/步骤统计、Token 账本、工具调用、产出文件、执行命令、错误与阻塞——全部来自会话事件日志,不靠模型回忆
- **可验证凭据块**:每份报告末尾自动追加会话 ID、工作区、生成时间、报告 SHA-256 与产物 SHA-256
- **落盘安全**:目标路径强制限制在会话工作区内,拒绝绝对路径逃逸与 `..` 穿越
- **模板可定制**:内置模板可整体覆盖,占位符见下文
- **免构建**:纯 ESM,直接 `dsh plugin` 安装或 `--patch` 加载,无编译步骤

## 安装

需要 Node.js ≥ 18,以及 DeepSeek Harness(`npx @deepseek-ai/dsh web` 或源码运行)。

### 方式一:plugin 安装(需要 pnpm)

    dsh plugin --profile web add github:ciceroyang/dsh-report-studio

### 方式二:本地 / 源码覆盖层(无需 pnpm)

    # 克隆仓库
    git clone https://github.com/ciceroyang/dsh-report-studio.git

    # 创建覆盖层文件 my-report.yml(注意:插件路径必须是绝对路径)
    # - insert:
    #     - id: report-studio
    #       name: '/absolute/path/to/dsh-report-studio/index.js'

    dsh web --patch ./my-report.yml

## 使用

对 agent 说(二选一):

- "写一份今天的工作日报"
- "把这次会话整理成交接文档,交接给接手人"

agent 会(work-report skill 已教会它):

1. 调用 `report_generate` 生成带硬数据与 `[[待写:…]]` 标记的草稿;
2. 用会话事实填满散文段落;
3. 调用 `report_save` 落盘并追加凭据块;
4. 回复你保存路径与报告哈希。

保存位置默认在工作区 `reports/<kind>-<date>.md`,可在调用时指定 `path`。

也可以直接在输入框敲命令**即时预览草稿**(不消耗模型回合):

    /report daily     # 或 weekly / handoff / article,中文别名 日报/周报/交接/公众号 也行

## 工具

### report_generate

| 参数 | 必填 | 说明 |
|---|---|---|
| `kind` | 是 | `daily` / `weekly` / `handoff` / `article` |
| `title` | 否 | 自定义标题;省略时用会话标题或默认标题 |
| `period` | 否 | 周期说明(如"2026-08-11 ~ 2026-08-17"),周报模板使用 |

返回:完整 Markdown 草稿。散文段为 `[[待写:…]]` 标记,由 agent 在两次调用之间填充。

### report_save

| 参数 | 必填 | 说明 |
|---|---|---|
| `content` | 是 | 最终报告全文(不含凭据块;所有 `[[待写:…]]` 必须已替换) |
| `path` | 否 | 目标路径;省略时 `reports/<kind>-<date>.md` |
| `kind` | 否 | 用于默认文件名;省略时 `daily` |
| `artifacts` | 否 | 产出文件路径列表;存在的文件会被哈希进凭据块 |
| `format` | 否 | `md`(默认)/ `html` — HTML 为独立可转发的文档,原始 Markdown 嵌入隐藏源块,`report_verify` 照常可核验 |

返回:绝对路径 + 报告 SHA-256 + 已核验产物列表。

### report_week

聚合本周工作区内所有历史会话(读 $DSH_HOME/sessions 持久化日志)+ 当前会话,生成周报草稿,附"会话明细"表。历史日志读取需要 Node ≥ 22.15(内置 zstd);更老版本自动降级为仅当前会话。

### report_verify

独立核验已保存报告的凭据块:重算报告 SHA-256 与每个产物哈希,逐项输出 match/missing。交付前自检或复核他人报告用。

| 参数 | 必填 | 说明 |
|---|---|---|
| `path` | 是 | 已保存报告文件路径(工作区内) |
| `dir` | 否 | 批量模式:核验该目录(相对工作区)下全部 .md 报告,输出 匹配/不匹配/无凭据 汇总 |

### report_publish

把报告发布到飞书(自定义机器人 webhook)或 Notion(页面);`target=dry` 只预览载荷不发请求。

| 参数 | 必填 | 说明 |
|---|---|---|
| `target` | 是 | `feishu` / `notion` / `dry` |
| `content` | 否 | 报告全文;省略时从 `path` 读取 |
| `path` | 否 | 已保存报告文件(工作区内) |
| `title` | 否 | 飞书作为前缀,Notion 作为页面标题 |

配置:插件配置 `publish.feishuWebhook` / `publish.notionToken` + `publish.notionParentPageId`,或环境变量 `FEISHU_WEBHOOK` / `NOTION_TOKEN` / `NOTION_PARENT_PAGE_ID`。未配置时真实发布会明确报错,dry 永远可用。

| 参数 | 必填 | 说明 |
|---|---|---|
| `title` | 否 | 自定义标题 |
| `period` | 否 | 周期说明,如"2026-08-11 ~ 2026-08-17" |

## 自定义模板

模板是普通 Markdown 文件,支持以下占位符(数据段由插件确定性填充):

    {{TITLE}} {{DATE}} {{PERIOD}}
    {{META}}    会话 ID / 工作区 / 起止时间 / 标题
    {{TASKS}}   用户诉求 + 任务清单快照
    {{STATS}}   回合 / 步骤 / 工具调用 / Token 账本 / 结束原因
    {{TOOLS}}   工具调用统计表
    {{FILES}}   产出与读取的文件
    {{COMMANDS}} 执行过的 shell 命令
    {{ERRORS}}  工具错误与阻塞
    {{TIMELINE}} 逐回合时间线
    {{SESSIONS}} 周报会话明细表(report_week 聚合)

散文段写 `[[待写:说明]]`,agent 保存前会填满。

放一份同名模板到自定义目录(如 `daily.md`),并在插件配置里声明:

    - insert:
        - id: report-studio
          name: dsh-report-studio
          config:
            templatesDirs:
              - '/absolute/path/to/my-templates'

内置模板在此仓库 `templates/` 目录,可直接复制修改。

## 凭据块样例

    ## 报告凭据 Report Receipt

    | 项 | 值 |
    |---|---|
    | 会话 Session | session-1c1e5d0c-… |
    | 工作区 Workspace | /Users/you/project |
    | 生成时间 Generated | 2026-08-14T08:00:00.000Z |
    | 报告哈希 Report SHA-256 | 9f2c… |
    | 产物 Artifacts | README.md → 3a1b… |

## 定时周报

两条路径(work-report skill 会按会话实际能力选择):

1. **harness 内(官方工具)**:若组合已挂载 dsh-schedule,对 agent 说"每周五 18:00 自动出本周周报",它用 `schedule_create` 落地(时区必须显式)。
2. **系统级(零依赖,数据段全自动)**:仓库 `scripts/auto-weekly.mjs` 不依赖模型,聚合本周全部会话、填好所有数据段、保存草稿(prose 留 [[待写:…]]);配 launchd/cron 每周五 18:00 跑,之后开个会话说"填好并保存"即可。macOS 示例:

       node scripts/auto-weekly.mjs <工作区> --out reports/weekly-auto.md

## 已知限制(0.1.0)

- report_week 跨会话聚合读取 $DSH_HOME/sessions 历史日志(多帧 zstd),历史读取需 Node ≥ 22.15。
- 落盘走 Node 原生 fs,不经过 Harness 的 fs 策略层;路径逃逸防护在插件内实现。
- 报告工具要求调用发生在 agent 会话内(headless 与 web 均满足)。

## 文档与示例

- [中文实战教程:从零到发布](docs/tutorial-zh.md) — 完整开发复盘,含 6 个实测坑
- [插件脚手架](https://github.com/ciceroyang/dsh-plugin-starter) — 一键生成同款插件工程
- [环境体检](https://github.com/ciceroyang/dsh-doctor) — 本地环境一键自诊(端口/依赖/profile/日志)
- [日报样例](demo/report-daily.example.md) — 真实会话产出的日报(含凭据块)

## 贡献

欢迎 Issue 与 PR(拼写修正、模板新增、翻译、测试)。发布前跑:

    npm test

## 许可证与赞助

[MIT](./LICENSE)。如果它帮你省了写日报的时间:

- 国内赞助:[爱发电](https://afdian.com/a/cicero)(提现到支付宝;GitHub Sponsors 不支持大陆收款)
- 海外赞助:[GitHub Sponsors](https://github.com/sponsors/ciceroyang)

---

为开源社区贡献,向 DeepSeek Harness 的"一切皆插件"理念致敬。
