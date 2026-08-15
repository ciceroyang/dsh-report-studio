# DeepSeek 开源了个 Agent 框架,我给它的生态贡献了第一个"工作日报"插件

## 事情是这样的

DeepSeek 最近开源了 Harness——一个"一切皆插件"的 Agent 框架:模型、工具、会话、技能、UI,全是插件。项目两周冲到 6 万多 star,生态里已经冒出来 900 多个社区插件。

我扫了一遍社区目录,发现一个有意思的空白:**没有任何插件负责"把会话变成工作交付物"**。分享对话的有、生成编码收据的有、读写 Office 的有,但"今天 agent 帮我干了什么 → 写成日报/周报/交接文档"这最后一公里,没人做。

所以我写了 dsh-report-studio,顺手把开发过程复盘成了一篇教程——包括我踩过的每一个坑。

## 这个插件干什么

在 DSH 里说一句"写一份今天的工作日报",agent 会:

1. 从会话事件日志里**确定性提取硬数据**——用户诉求、任务清单、回合/步骤统计、Token 账本、工具调用、产出文件、执行命令、错误与阻塞;
2. 套模板生成草稿,填好散文段落;
3. 落盘,并在文末**追加可验证凭据块**:会话 ID、生成时间、报告 SHA-256、产物 SHA-256。

重点是最后一步:报告哈希和产物哈希都能独立复算。日报里声称"交付了 3 个文件",凭据块就能证明这 3 个文件确实存在、内容一字未改。**汇报第一次变得不可注水。**

四种模板开箱即用:日报、周报、交接文档(让接手人不复盘会话也能继续)、公众号文章。

## 从零开发,我踩过的 6 个坑

(完整版见仓库教程:https://github.com/ciceroyang/dsh-report-studio/blob/main/docs/tutorial-zh.md,这里列精华)

1. **`--patch` 绝对路径插件的依赖解析**:插件里的裸导入从插件自己目录向上找 node_modules,找不到就启动失败。本地开发要软链依赖。
2. **headless bundle 装不进新建 profile**:它依赖一个没发到 npm 的私有包;跑 e2e 用默认 headless profile + `--patch`。
3. **pnpm 缺失**:`dsh plugin` 报 "pnpm not found on PATH";国内网络装 pnpm 记得用镜像。
4. **object 输出 schema 必须写 `additionalProperties: true`**,否则工具注册直接失败。
5. **占位符校验要真校验**:我在保存前拒绝残留占位符的报告,e2e 时这个守卫真的拦截了一次模型输出。
6. **DSH 会话日志是多帧 zstd**:想读历史会话时,`zstdDecompressSync` 只解压第一帧——出来的只有一行 header,事件全丢。要先扫描帧结构再逐帧解压,算法官方 format.ts 里就有,直接抄。

## 你可以怎么用

- 已经装了 DeepSeek Harness:看仓库 README 的安装一节,一分钟装上;
- 想学插件开发:教程里有个免构建、纯 ESM、可照抄的完整例子;
- 就是路过:给仓库点个 star,或者看看这份真实会话产出的日报样例:https://github.com/ciceroyang/dsh-report-studio/blob/main/demo/report-daily.example.md

## 一点感想

Harness 官方在贡献指南里写了句话:**"我们不认为官方仓库里的包天生比社区包更重要。"** 核心仓库暂不接受外部 PR,贡献的姿势就是做插件、写教程、答问题。生态还在早期,空白一抓一大把——这正是普通开发者最好的入场时机。

---

**仓库**:https://github.com/ciceroyang/dsh-report-studio
**star、issue、PR 都欢迎**。

付费行业模板包(开发团队 / 运营自媒体)已上架爱发电:https://afdian.com/a/cicero ——插件本身 MIT 免费,模板 19.9 起,买了不亏,不买看教程也欢迎。
