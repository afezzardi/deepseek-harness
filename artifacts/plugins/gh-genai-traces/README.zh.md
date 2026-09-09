---
description: "在自托管 Phoenix 中采集 DSH 执行记录、回放会话，并将评估样例关联到源轨迹。"
kind: "package-reference"
---
# gh-genai-traces

[English](README.md) | 中文

## 摘要

Gruppo Happy 可以在 Phoenix 中检查模型请求、工具调用、提供者用量和会话结果。显式 profile 覆盖层启用实时采集；历史回放通过共享的上游实时会话和持久化 API 读取数据，并导出到独立项目。丰富内容经过脱敏且有大小限制；省略内容时仍保留源标识符。规范会话仍是重建数据的依据。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

安装并构建上游 DSH 后，从仓库根目录运行命令。此私有包位于根 pnpm 工作区之外；它自己的 npm 锁文件固定外部依赖。

```sh
npm ci --prefix artifacts/plugins/gh-genai-traces --legacy-peer-deps --ignore-scripts
node artifacts/plugins/gh-genai-traces/setup.mjs
node artifacts/plugins/gh-genai-traces/build.mjs
node artifacts/plugins/gh-genai-traces/stack/setup.mjs
docker compose -f artifacts/plugins/gh-genai-traces/stack/compose.yml up -d
pnpm dsh --profile headless --patch artifacts/plugins/gh-genai-traces/lib/overlay.yml "your task"
```

栈在 `http://127.0.0.1:6006` 暴露 Phoenix，在 `http://127.0.0.1:4318/v1/traces` 暴露 OTLP/HTTP。生成的覆盖层启用 `rich-redacted` 采集并替换默认遥测后端。不使用覆盖层时，此插件不会加载。Web 可以将同一个覆盖层与现有 Typert 和推理强度滑块覆盖层一起使用。

Compose 服务使用命名卷，临时轨迹默认保留 30 天。显式实验保护操作为保留证据的 v3 项目分配不会自动过期的原生策略。`PHOENIX_PORT`、`OTLP_HTTP_PORT` 和 `PHOENIX_RETENTION_DAYS` 配置此栈。`stack/setup.mjs` 仅创建一次私有且被 Git 忽略的数据库凭据；`docker compose ... down` 保留卷。栈禁用 Phoenix 分析遥测及外部 UI 资源。

设置 `GH_GENAI_OTLP_ENDPOINT` 可更改完整轨迹端点，设置 `GH_GENAI_PROJECT` 可更改项目。在启动 profile 前，将 `GH_GENAI_REPLAY_SESSIONS` 设为逗号分隔的会话 ID，即可通过配置的 DSH 存储回放它们。回放导出到 `<project>-replay`，不会启动或重写记录的会话。源码变更后重新构建；重启 profile 以应用其覆盖层。

### 采集控制

[配置 schema](src/config.ts) 定义所有接受的字段和默认值。直接挂载插件时默认使用 `metadata`；生成的覆盖层显式选择丰富内容。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `metadata` / `exportStandaloneEvents` | `{}` / `false` | 实验、任务和试次标签；显式启用零时长独立事件 span |
| `content` | `metadata` | `rich-redacted` 包含有大小限制的消息、工具 schema、参数、结果及模型输出的推理内容 |
| `secretEnv` | 三个指定的提供者密钥变量 | 从导出内容中删除其字面值 |
| `redactKeys` | 常见凭据字段 | 删除匹配的 JSON 字段；同时脱敏凭据赋值和 bearer token |
| `maxContentBytes` | 65,536 | 每个内容属性的最大编码字节数；超限 JSON 被省略并标记为截断 |
| `maxStreamBytes` | 262,144 | 每次模型调用采集的块表示大小上限；仍保留终结用量 |
| `maxPendingRecords` / `maxActiveSpans` | 1,024 / 4,096 | 限制排队的映射任务及并发 span 状态 |
| `maxEventsPerSpan` / `maxTurnEvents` | 128 / 8,192 | 限制事件展示和轮次用量折叠 |
| `maxQueueSize` / `maxExportBatchSize` | 2,048 / 128 | 限制 SDK 导出接纳数量及批量大小 |
| `exportTimeoutMillis` / `shutdownTimeoutMillis` | 3,000 / 5,000 | 限制导出及插件关闭的等待时间 |

每个内容字段区分 `complete`、实际修改的 `redacted`、`truncated`、`omitted` 以及序列化失败的 `withheld`。模型 span 分别记录采集资格、拒绝原因、请求的推理强度、请求/工具/配置哈希，以及尚未评分的任务结果。脱敏仅修改导出的副本。已知密钥移除并非完整的个人信息检测。截断和脱敏都可能使轨迹不适合训练；数据集整理必须检查这些标记并获取所需源记录。

### 验证与评估

```sh
pnpm exec tsc -p artifacts/plugins/gh-genai-traces/lib/tsconfig.check.json
pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts
GH_PHOENIX_URL=http://127.0.0.1:6006 GH_GENAI_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts tests/phoenix.spec.ts
```

常规测试包括使用模拟模型和真实 shell 的已构建插件 headless 测试。Phoenix 测试会在名称唯一的验证项目中创建合成轨迹、数据集、实验及标注记录。[评估示例](examples/evaluation.ts) 通过包的 `./evaluation` 入口导出 `evaluateReadFixture(baseURL, project, expected)`。它将记录的读取观察值与测试夹具定义的预期值比较，并在数据集样例中保留完整请求、工具定义及源关联。它不是通用任务成功评估器。

[VALIDATION.md](VALIDATION.md) 记录确切命令、测量及部署限制。实时推理和模型质量需要独立证据；单元测试和合成 Phoenix 示例均无法证明这些行为。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现与数据所有权</summary>

`SessionTelemetryCoordinator` 提供独立的实时记录；后端补充其规范封装引用并将映射工作入队。`llm/stream` waterfall 提供请求时的 harness 输入及惰性流计时。每个轨迹组织一轮执行，模型调用与工具位于 step span 下；记录的工作流子会话 ID 在同一轨迹中建立父 span 上下文。实时子记录在有界缓冲区中等待成员关系发布；回放通过上游服务解析祖先关系。工作流和 step span 使用 Phoenix 的 `CHAIN` 类型。辅助模型调用带有独立用途。插件不安装进程全局 tracer provider 或异步上下文管理器。

回放使用共享快照读取器、上游增量 surface 重建和 header 折叠及上游紧凑流读取器。它在每次记录的 assistant 结算前重建模型输入，并将模型时长标记为首个记录块至最后记录块的间隔。它不导出重建的派发延迟。当记录完整时，上游 token-meter 轮次辅助函数提供精确轮次总量；无法证明输入总量时，每次调用的 token 属性会省略该总量。工具时长覆盖记录的调用至结果间隔，包括期间等待。

SDK 批量导出 OTLP protobuf。诊断计数区分记录接纳、映射错误、span 接纳与丢弃、成功导出回调、失败回调及待处理 span。成功回调表示接收端确认，不证明 Phoenix 已持久化存储。Collector 的持久化队列保护已接纳的下游批次，无法恢复丢失的 SDK 队列。基于源生成的稳定回放 ID 允许在已测试的 Phoenix 版本中重复导入而不产生重复 span。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [设计决策](DESIGN.md)：源所有权、替代方案及兼容性。
- [上游遥测](../../../packages/session/session-telemetry/README.zh.md)：采集与生命周期语义。
- [上游 session-query](../../../packages/session-query/session-query/README.zh.md)：经过验证的历史读取。
- [GenAI 约定](https://github.com/open-telemetry/semantic-conventions-genai)：开发中的互操作规范。
- [Phoenix 原生转换](https://arize.com/docs/phoenix/release-notes/05-2026/05-15-2026-otel-semconv-conversion)：接收端展示转换。

<a id="model-experience"></a>
## 模型体验

此插件不增加工具、提示词或模型可见的会话事件。观察保留下游块、异常及迭代器关闭行为；导出不会在模型或工具的热路径上等待。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

[整理库](src/curation.ts) 通过 `./curation` 生成版本 2 的后端无关候选，包含明确评分、审核哈希、审批证据及选定损失目标。Phoenix 管理固定版本的划分。`./fireworks` 保留托管 SFT/DPO 序列化；`./reward` 提供文件系统观察。仅格式导出省略目标推理。显式结果推理导出保留选定推理以及回答或已评分工具决策，不改写规范候选；任务结果不独立评价推理中的陈述。[基础设施报告](../../results/fireworks-sft-20260909/REPORT.md) 记录 Fireworks 数据集上传、原生预览及剩余兼容性限制。这些数据是后续工作负载的管线夹具，不代表生产训练批准。[实验指南](experiments/README.zh.md) 说明规范审计、固定文本采样、可重置夹具和独立评分。[r5 报告](../../results/trace-pipeline-r3-20260909/REPORT.md) 验证 Qwen 最终回答序列化与已观察引擎的一致性；[交接文档](HANDOFF.md#pending-work) 记录剩余验收工作。本地 schema 验证及 token 一致性不代表训练后模型改进。

- 请求采集表示适配器序列化前的 harness 输入；不采集提供者 HTTP 请求体、tokenizer ID、隐藏推理及附件原始字节。
- 回放无法恢复会话中没有记录的实时计时或辅助请求细节。冷读取可能包含上游生成的中断关闭记录，并在轮次级别明确标识。
- 队列丢失、进程崩溃、延迟挂载及热重载可能导致轨迹不完整。为获取完整实时证据，在新轮次前重启采集；使用回放查看完整的已存储轮次。
- 跨进程子轨迹要求加载插件并能读取祖先成员记录。未解析或独立子会话保留会话关系，不伪造嵌套。工作流记录没有调用工具的 ID，因此工作流位于 step 下。映射版本 3 按项目、来源和规范源身份隔离轨迹、span 与 Phoenix 会话 ID；工作流子会话共享所属根会话的展示身份。
- 自动语义召回、ATIF 导出、特定训练器的渲染及损失验证、精确 token RL、定价策略及通用评估器均为延后工作。Phoenix 自身的定价估算不代表经过验证的推理成本。

### 开发备注

测量证据位于 [VALIDATION.md](VALIDATION.md)。GenAI 映射与持久化 DSH 会话格式独立版本化。
