# 轨迹到数据集实验

[English](README.md) | 中文

## 所有权与就绪状态

Phoenix 管理整理后的数据集、不可变发布版本、原生划分、标注和实验。规范 DSH 会话负责重建。本地快照、清单、回执和备份是源证据及可恢复检查点。历史版本 1 数据集保留其原有含义。数据集准备是后续工作负载的基础设施；本轮不启动训练任务。

[r5 报告](../../../results/trace-pipeline-r3-20260909/REPORT.md) 记录已完成的采集和渲染器验收；[审查处理记录](../../../results/trace-pipeline-r3-20260909/FABLE-REVIEW.md) 记录基准修复。[续作报告](../../../results/trace-pipeline-v3/CONTINUATION.md) 保留历史测量结果。基准包含 12 个任务族的 48 个不同实例，仓库任务和业务任务各占一半。任务族级别的 train/validation/test 划分在执行前固定，每个划分均包含两个领域。修订版 5 向模型提供明确的输出 schema 和工具策略，使用一次性后台委派，并要求按启动顺序返回完整 workflow 子结果。ASCII 转义 Unicode 夹具使字符差异在已部署 tokenizer 的 NFC 规范化后仍得以保留。历史修订版保留原有解释。

## 采集与审计

`benchmark.py <output>` 生成确定性任务定义和 Phoenix 发布输入。任务身份对定义与夹具求哈希，不包含临时工作区路径。`phoenix_dataset.py publish <input> --name <dataset> --receipt <receipt>` 发布稳定示例身份及版本元数据。完全相同的重试协调同一个导出身份。变更导出需要 `--previous <pinned-receipt>`，并通过原生修订更新重叠 ID。新增与更新混合时保留可恢复的暂存版本。发布要求单一写入者；API 调用序列不保证多个写入者之间的原子性。 评分作为元数据快照发布：`humanFeedback` 改变时保留候选行 ID，但导出摘要改变，必须通过 `--previous` 创建新的数据集版本。

`balanced_campaign.py <receipt> <output>` 验证固定版本的任务数据集，并通过受支持的 DSH profile 执行三次重复。它管理录制代理，将包括子智能体在内的实际转发请求限制为四个，并显式设置 medium 推理。每次运行都有私有工作区、记录的子进程 cwd、初始清单、声明的合成审核证据和原子结果。运行身份包含 cwd、已跟踪工作树变更、未跟踪源文件哈希、代理、构建文件及配置。每个活动在 `.implementation/` 下保留精确可执行输入。生命周期 profile 在两轮之间刷新、释放并恢复同一个持久化会话。没有结果回执的中断运行会指出保留的目录，并要求新建活动；其他采集错误不会丢失已完成回执。

`acceptance.py <output> --template <directory> --upstream <URL>` 以 off 和 medium 推理运行八个过渡场景，同时执行两个试验。`--preflight` 不调用推理，验证相同的 16 个配置。输出目录必须为新目录；运行器保留可执行输入，并拒绝运行期间的实现变更。

`balanced_campaign.py <receipt> <output> --preflight` 不调用推理即可检查全部十二个任务族，包括实际拒绝根智能体及子智能体的禁用工具调用。运行器在关闭后验证代理事件数为零。`--pilot --repetitions 1` 为每个任务族采集一个实例，以便在完整活动前验收。根工具与声明的任务策略一致；子工具允许读取及 schema 所属的结构化输出。

`prepare-audit.py <campaign> --receipt <receipt>` 从固定的 Phoenix 版本读取划分。仅重建和评分而不提升数据时，使用 `--audit-only`。脚本识别会话目录，并在需要时复制存储字节；从不解码代际文件。设置 `GH_AUDIT_MANIFEST` 和隔离的 `DSH_HOME` 后，通过 `pnpm dsh --profile headless` 启动其 overlay。审计会禁用普通任务运行器。缺少 cwd 的历史运行需要 `--legacy-cwd <absolute-directory> --legacy-cwd-evidence <recorded-launch-evidence>`；这些字段进入派生审计清单，不改写运行回执。 `--template <directory>` 提供设置与 profile 模板；`--project <name>` 选择审计遥测项目。

共享快照读取器使用实时会话或持久化 API，并通过上游恢复验证。它保留继承长度和事件身份，在不修改存储字节的情况下记录内存中的中断修复。每个检查点绑定父源与所用子源的摘要、任务、配置、显式评分器版本，以及包含环境评分器的构建源清单。评分规则变更要求提升版本；源哈希也使旧缓存失效。操作失败可重试；确定性拒绝持久保存。遥测和后端导出在评分后独立执行，汇总 JSONL 文件通过原子替换写入。

## 准入与目标

版本 3 的后端无关候选保留结构化消息、工具、推理、修复和错误事件、审批事件、请求默认值、源哈希及显式损失目标。必需维度采用带证据的 pass/fail/unknown/not-applicable 观察值。必需维度未知会阻止提升。退出码与超时作为独立事实保留。隐私审核绑定精确的源与转换哈希。人工干预轨迹保留证据，但当前策略禁止提升。

文件系统评分在观察工作区内比较初始哈希、允许的 JSON 输出、删除、意外条目和符号链接。类型化的 read/write/edit 参数、记录结果、恢复顺序及写入后回读顺序提供独立轨迹观察。Write 内容必须解析为预期 JSON 输出。同一路径存在多次修改时，edit 维持 unknown。没有任务专属参数与结果评分器的工具维持 unknown。这些检查不声称能检测观察工作区之外的写入。

关联任务族、任务身份、父子会话、等价请求和合格重复输出共享划分组。已提升的划分发生冲突时，整个关联组被隔离，并保留受影响版本身份。通用失败输出不会连接原本无关的任务族。未分配的组不能提升。原生划分关联可变，因此 Phoenix 版本元数据固定发布时的划分成员。

最终回答 SFT 是格式目标：较早的 assistant 轮次作为上下文，未经评分的最终推理不进入监督内容。它尚未获准用于采用推理的生产路由训练。选定工具决策要求独立的逐调用通过评分和经过验证的根审核。较早完成轮次采用目标专属前缀哈希，并记录审核派生关系。检查点与汇总统计考虑及选取的事件数量，并保留逐事件拒绝原因，包括意外错误。Delegation 检查后台任务身份与结果收集；workflow 检查所属只读子会话、运行顺序、完成状态及有序返回值。相同的子结果无法证明顺序。必须提供规范子会话快照，且已配置的可继续委派不满足基准要求的后台任务协议。Qwen 参考渲染器仅接受最终回答格式目标；Fireworks 结果导出使用独立的推理与行动目标。

## 目标后端与奖励

`./fireworks` 提供仅格式的 `exportFireworksSft`、显式 `exportFireworksOutcomeSft` 以及固定请求的托管 DPO 序列化。结果导出要求任务评分通过，且一个非空推理块之后为选定回答块或独立评分通过的工具调用。它在 `reasoning_content` 中保留目标推理，并屏蔽较早的 assistant 消息。任务结果用于选取示范；推理中的各项陈述没有独立评分。原始候选及其损失选择保持不变；其内容审核描述规范转换，导出清单另行记录派生目标。DPO 要求请求相同、选中回答通过、拒绝回答明确失败、只有一个用户轮次、没有工具且输出不同。

`fireworks_bundle.py <receipt> --objective outcome-reasoning --output <fresh-private-directory>` 验证固定的 Phoenix 版本，输出私有 train/validation/test JSONL、源快照、逐行来源以及内容和实现哈希。`--objective final-answer-format` 保留仅回答的格式实验，并记录排除的工具目标。每行均通过所属 TypeScript 验证器；固定划分及已审核内容不可变更。输出目录已存在时会拒绝执行。导出前先构建插件。`firectl dataset create <dataset-id> <split.jsonl>` 上传数据集而不创建训练任务。测试划分保持留出。

`fireworks_preview.py <dataset-resource> --model <model-resource> --context-length <tokens> --output <fresh-directory>` 采集原生数据集预览，不调用推理或训练；`--page-size` 控制响应批量，默认为一个示例以避免预览总大小超限。凭据来自 `FIREWORKS_API_KEY` 或 firectl 默认 API key 配置。`verify_fireworks_preview.py --bundle <directory> --split <split> --preview <directory> --tokenizer <local-directory> --output <report>` 检查源行身份、有序损失片段及模板文本。显式 `--json-serialization ascii --tool-responses separate` 比较已观察到的 Fireworks 展示方式；默认比较保留推理模板的 JSON 与工具结果分组方式。这些适配要求保留的 Qwen3.8 模板哈希和已验证的 ASCII 过滤器行为；报告从模板提取默认推理强度，并记录库版本、声明的展开方式和数据项数量。与采集设置的差异仍单独报告。验证器需要可选的 Transformers 和 Jinja2 依赖。报告保留远端错误，始终不将数据标记为可训练。[基础设施报告](../../../results/fireworks-sft-20260909/REPORT.md) 保存原生证据；[方法选择](../../../results/fireworks-sft-20260909/METHODS.md) 区分 SFT、DPO 和 RFT 的要求。

`render_qwen.py <candidate> --tokenizer <directory> --output <file>` 检查候选内容哈希，使用固定的本地 tokenizer 渲染，并验证精确最终回答掩码。可选 `--route` 要求已观察到的 checkpoint、tokenizer 和模板证据，之后才与引擎比较请求 token。本地模板必须匹配引擎实际使用的模板，后者可能不同于 checkpoint 随附的模板。已检查的引擎通过请求字段 `reasoning` 接收较早 assistant 消息的推理；本地模板消息使用 `reasoning_content`。默认 `--target-whitespace exact` 拒绝目标变换。显式指定 `--target-whitespace template-trim` 仅允许已验证的模板首尾空白删除，并记录删除字符串、源与渲染哈希、渲染器版本、模板哈希及 tokenizer 文件。规范候选及已通过隐私审核的内容保持不变；此序列化仅删除内容，无需重新进行内容隐私审核。渲染器要求只有一个选定文本块，拒绝 tokenizer 新增 token 字符串，并验证掩码连续且精确解码为 `renderedTargetText`。`--route` 检查请求与完整示例 token 一致性。格式目标不监督最终推理及消息结束 token；生产训练需要独立的目标与训练器审核。对文本重新分词无法恢复生成时 token ID；精确 token RL 仍不支持。

受支持的 `./reward` 导出提供私有重置与独立文件系统奖励。`campaign.py` 及其固定请求模式保留为历史算术回归；由索引生成的实例在不同活动间重叠，不能作为新采集的不同实例计数。已安装适配器的一致性检查在发送前捕获准备好的线上请求，并与私有录制比较，包含损坏对照及未匹配请求分类。该检查不调用推理。一致性清单声明 `recordingScope: complete` 或 `selected-sources`；完整清单拒绝未解决的请求体。选定历史子集可将其他未匹配录制保留为诊断。

`phoenix_dataset.py publish` 对整理后的行要求 `--fidelity <adapter-report>`。提供一致性证据或源清单评分器版本时，每行都必须包含候选元数据。候选请求与源哈希以及选定事件必须匹配逐字节一致的提供者证据。候选文件读取器要求每个选定工具块至少对应一个位于选定请求事件之后的不同通过决策；规范整理流程将各调用绑定到其评分。内部哈希证明一致性，不认证审核者。JSONB 不兼容的源字符串使用无损字段封装；消费者必须通过 `Phoenix.examples()` 解码后再求哈希或读取候选。参见[发布决策说明](../DESIGN.md)。

`experiment_report.py <campaign> --publish-receipt <task-receipt>` 将已记录的回答、评分及执行证据发布为原生 Phoenix 实验。完全相同的重试协调运行身份，并重新提交评估以修复部分发布，依赖 Phoenix 按运行及评估名称执行 upsert。重复运行评分会被拒绝。逐实例的三次至少一次通过率与三次全部通过率包含以独立实例计算的 Wilson 区间。失败分类辅助排查，不确立模型的因果责任。基于任务族的失败责任标签仅辅助排查；提示修复后仍可能保留历史任务规格标签。归因前应检查实际观察证据。

## 保护与恢复

`phoenix_dataset.py protect gh-training-v3-replay` 为新的证据项目分配原生永不过期策略。现有历史项目保留其策略。临时采集继续使用有界保留期。发布元数据记录源清单与哈希；回执标识不可变版本和导出行哈希。

`backup.py create unused --output <fresh-backup> --source <canonical-store>` 创建私有 PostgreSQL 转储和源归档。通过重复 `--source` 包含保留的会话存储与配置证据。`backup.py restore-check <backup> --output <fresh-check>` 恢复到新建数据库，验证数据集、版本、来源及源哈希，然后仅删除该临时数据库。工具支持版本 2 备份清单。备份应放在不会随工作磁盘一起丢失的存储上；工具不创建异地主机归档服务。

原始代理录制文件在创建时即为私有，并且不记录请求头。[交接文档](../HANDOFF.md) 列出当前回执、检查及剩余验收工作。
