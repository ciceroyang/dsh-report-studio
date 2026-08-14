# 从零到发布:给 DeepSeek Harness 写你的第一个插件(实战踩坑全记录)

> 本文是我从"装好 dsh"到"把 dsh-report-studio 发布进社区目录"的完整复盘。
> 读完你就能避开我踩过的每一个坑,直接开始写自己的插件。

## 为什么现在值得做

DeepSeek Harness(简称 dsh)是 DeepSeek 开源的首个 Agent 框架,"一切皆插件":
模型、工具、会话、技能、UI 全部是 Cordis 插件。目前处于开发者预览期,
**核心仓库暂不接受外部 PR**,官方把贡献路径指向生态:

- 发布插件(仓库打 `dsh-plugin` topic 即可被发现)
- 写教程、答社区问题、报 issue

社区已经有 awesome 目录(900+ 公开插件)。空白仍然很多——比如"会话→工作交付物"
(日报/周报/交接文档)一个插件都没有,所以我做了 dsh-report-studio。

## 起步:两种加载方式

**方式一(正式安装,需要 pnpm)**

    dsh plugin --profile <你的profile> add <包名或本地路径>

它转发给 profile 目录里的 pnpm。没有 pnpm 会直接报错——先装:

    npm install -g pnpm

**方式二(本地开发,--patch 覆盖层,不需要 pnpm)**

按官方教程建一个覆盖层文件:

    # my-report.yml
    - insert:
        - id: report-studio
          name: '/绝对路径/dsh-report-studio/index.js'

    dsh --profile headless --patch ./my-report.yml "任务"

## 最小插件骨架(免构建,纯 ESM)

    // index.js
    export const name = 'my-plugin'
    export const inject = ['tools']

    export function apply(ctx) {
      ctx.tools.register(defineTool({
        name: 'greet',
        description: 'Greet someone by name.',
        parameters: {
          name: { type: 'string', required: true, description: 'The name to greet' },
        },
        output: {
          schema: { type: 'string' },
          render: (_args, value) => [{ type: 'text', text: value }],
        },
        async execute(args) {
          return 'Hello, ' + args.name + '!'
        },
      }))
    }

几个关键点:

- `inject: ['tools']` 让 Cordis 等工具注册表就绪后再执行 `apply`。
- `defineTool` 从 `@deepseek-ai/dsh-tools` 导入;
  `parameters` 推断并校验参数,`output.schema` 校验返回值,
  `output.render` 把返回值变成模型看到的内容。
- **object 输出 schema 必须写 `additionalProperties: true`**,否则注册直接失败。
  字符串参数用 `enum: ['a','b']` 约束取值;可选参数直接省略 `required`。

## 打包成可安装的 bundle

profile 清单里的两个概念(bundle 与 profile)由两份 manifest 区分:

    // package.json
    {
      "name": "dsh-report-studio",
      "type": "module",
      "main": "index.js",
      "files": ["index.js", "lib", "skills", "templates", "cordis.patch.yml"],
      "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
    }

    # cordis.patch.yml
    - insert:
        - id: report-studio
          name: dsh-report-studio

`dsh plugin --profile web add github:你的账号/你的仓库` 即装即用。

## 在工具里读当前会话(官方能力,零私货)

工具执行时通过 `exec.agent.session` 拿到当前会话:

    async execute(args, exec) {
      const session = exec.agent?.session
      if (!session) throw new Error('report tools require an agent-bound session')
      for (const event of session.events) {
        // 事件信封:{ seq, time, type, data }
      }
    }

会话是事件溯源日志,常用事件:

| 事件 | data 内容 |
|---|---|
| `turn/start` / `turn/end` | 回合边界与结束原因(kind: completed/blocked/error/aborted/max-tokens) |
| `step/start` / `step/end` | 模型步骤边界 |
| `user/message` | 用户消息(注意 source.kind 区分 direct / plugin 注入) |
| `assistant/message` | 助手消息 + usage(inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens/reasoningTokens) |
| `tool/call` / `tool/result` | 工具调用与结果;raw arguments 是 JSON 字符串,需要自行 parse |
| `todo/write` | 任务清单快照(最新一次为准) |

跨会话查询还有官方 `ctx.sessionQuery` 服务(web 默认不挂载,别当硬依赖)。

## 注册运行时 skill

    const skills = ctx.get('skills')   // 可选服务用 ctx.get,不要写进 inject
    if (skills) {
      skills.register({
        name: 'work-report',            // kebab-case
        description: '一句话路由说明',
        content: readFileSync(SKILL_FILE, 'utf8'),
        source: 'runtime',
        provider: 'dsh-report-studio',
      })
    }

skill 的 Markdown 是**模型视角的说明书**:何时用、分几步、每步调哪个工具、
硬规则(比如"保存前所有 [[待写:…]] 必须清零")。它按需注入,不占常驻 token。

## 我踩过的坑(全部实测)

1. **`--patch` 绝对路径插件的模块解析**:插件里的裸导入(如 `@deepseek-ai/dsh-tools`)
   从插件自己的目录向上找 node_modules,找不到就直接启动失败。
   官方教程之所以能跑,是因为 scratch-plugin 建在仓库 checkout 里。
   本地开发时,给插件目录软链依赖即可:

       mkdir -p node_modules
       ln -s ~/.dsh/profiles/node_modules/@deepseek-ai node_modules/@deepseek-ai

   (正式 `dsh plugin add` 安装不受影响,pnpm 会从 profile 解析 peer 依赖。)

2. **headless bundle 装不进新建 profile**:`@deepseek-ai/dsh-headless` 依赖的
   `@deepseek-ai/dsh-code-runtime-worker` 不在 npm 上。
   想跑 e2e 就用**默认 headless profile + --patch**,别新造 profile。

3. **pnpm 缺失**:`dsh plugin` 报 "pnpm not found on PATH" 就是没装;
   国内网络用镜像 `npm i -g pnpm --registry=https://registry.npmmirror.com`。

4. **Node 26 的 `node --test tests/` 行为变了**:目录参数会被当模块加载;
   直接 `node --test` 让它自动发现 `*.test.js`。

5. **占位符校验要真校验**:我在 report_save 里拒绝残留 `[[待写:…]]` 的报告,
   e2e 时这个守卫真的拦截了一次模型输出——守卫不是摆设,要测到它生效。

## 测试与发布清单

- 单测:纯函数(事件提取/模板渲染/哈希/路径安全)用 node:test 全覆盖,
  哈希断言用已知向量(sha256('abc'))。
- e2e:默认 headless profile + --patch 跑一次真实任务,验证产物文件与凭据哈希。
- 发布:`gh repo create 你的名字/你的仓库 --public --source . --push`,
  然后 `gh repo edit --add-topic dsh-plugin`。
- 收录:给 awesome-deepseek-harness 提 PR(中英双语各加一条,
  没有合适类目就提案新类目,我的 PR 就是这么干的:新类目"输出与交付")。

## 一个可照抄的完整例子

[dsh-report-studio](https://github.com/ciceroyang/dsh-report-studio):
会话 → 日报/周报/交接文档/公众号文章 + 可验证凭据(报告与产物 SHA-256)。
结构一目了然:index.js(宿主插件)+ lib/(纯函数)+ templates/(Markdown 模板)
+ skills/(SKILL.md)+ tests/。MIT,欢迎抄、欢迎 PR。

---

在开源生态里,官方包与社区包同样重要——这是 Harness 官方白纸黑字的态度。
现在空白还多,动手吧。
