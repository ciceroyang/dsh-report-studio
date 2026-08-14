# dsh-report-studio 设计文档

## 定位

DeepSeek Harness 生态里第一个「会话 → 工作交付物」插件:把一次会话一键变成
日报 / 周报 / 交接文档 / 公众号文章,并附可验证的产物凭据(receipt)。

一句话卖点: **让 agent 干完活,顺手把"干了什么"写成能直接交出去的东西。**

市场依据(2026-08-14 社区目录扫描):
- awesome-deepseek-harness 目录 998 个公开插件中,无「日报/周报/汇报生成」产品;
- dsh-share(分享)、coding-receipt(编码收据)只覆盖单点;
- 微信/企微/飞书 remote channel 活跃,说明中文办公场景真实,缺"最后一公里"交付。

## 命名

- GitHub repo / npm 包 / plugin id: dsh-report-studio
- 工具名: report_generate, report_save
- 运行时 skill 名: work-report
- topic: dsh-plugin

## 技术底座(全部来自官方能力,零私货)

- 工具: ctx.tools.register(defineTool(...)),execute 内 exec.agent.session
  → .events(SessionEvent[])、.id、.header(cwd/createdAt)
- 会话事件词汇: turn/start, turn/end(reason), step/start, step/end,
  user/message(用户诉求), assistant/message(usage 令牌账本), tool/call,
  tool/result(error), todo/write, session/title
- skill: ctx.skills.register({name, description, content}) 运行时注册,
  内容来自仓库 skills/work-report/SKILL.md
- 可选服务: ctx.get('sessionQuery')(web 默认不挂载,不作为硬依赖)
- bundle 协议: package.json 的 dsh.bundle.patch + cordis.patch.yml,
  dsh plugin --profile <name> add <pkg> 安装

## 产品形态(免构建,直接可装)

```
dsh-report-studio/
├── package.json            # type:module, main:index.js, dsh.bundle.patch
├── cordis.patch.yml        # insert report-studio 插件行
├── index.js                # 宿主插件:注册 2 个工具 + 1 个运行时 skill
├── lib/
│   ├── extract.js          # 会话事件 → 结构化硬数据(回合/步骤/工具/文件/token/错误)
│   ├── templates.js        # 模板加载(内置 + 用户自定义目录)与占位符渲染
│   ├── receipt.js          # sha256 凭据块(session/时间/报告哈希/产物哈希)
│   └── save.js             # 落盘(会话 cwd 内),路径安全检查
├── skills/work-report/SKILL.md   # skill 全文
├── templates/{daily,weekly,handoff,article}.md
├── tests/*.test.js         # node:test 单测(extract/render/receipt)
├── README.md / README.zh.md
├── LICENSE(MIT)
└── FUNDING.yml             # GitHub Sponsors
```

## 两个工具

1. report_generate {kind, title?, period?}
   → 提取会话硬数据 + 渲染对应模板,返回完整 markdown 草稿;
     散文段标记 [[待写:…]],模型在两次调用之间填充。
   数据段(工具确定性填充):会话元信息、任务清单(user asks + todos)、
   时间线(回合数/步骤数/token 账本)、工具调用统计、产出文件清单、错误与阻塞。
2. report_save {content, path?, kind?}
   → 校验并写盘(session cwd 内),计算 sha256,追加凭据块,返回路径+凭据。

## SKILL:work-report 教模型的事

触发词(日报/周报/交接/公众号文章)→ 选 kind → 生成草稿 → 用会话事实填散文
(禁止编造)→ 保存 → 回应用户路径与摘要。

## 质量规则

- 报告中的事实只允许来自会话事件或文件系统实况,不允许凭空捏造
- 凭据块恒有:session id / workspace / 生成时间 / 报告 sha256 / 引用产物 sha256
- 落盘限制在会话 cwd 内,拒绝绝对路径逃逸与 .. 穿越

## Freemium 边界(开源版全免费)

- 免费: 4 套模板、markdown 导出、凭据、自定义模板目录
- 未来付费(不在这版): 多会话聚合周报、飞书/Notion/公众号发布、团队模板包、
  品牌定制 —— 走 GitHub Sponsors + 付费模板包,代码仍开源

## 验收标准

- 单测: extract/render/receipt 全绿
- e2e: headless 跑「写一份今天的日报」,产出文件 + 凭据可验证
- 发布: repo 打 dsh-plugin topic,README 中英,申请进 awesome 列表
