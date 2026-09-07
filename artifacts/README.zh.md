# artifacts/

[English](README.md) | 中文

这里保存 DeepSeek Harness 使用自托管 Qwen3.8-27B 端点时所需的分支本地配置、观测工具和验收检查。所有部署定制都应放在此处，以便产品代码树能够同步上游。

先阅读 [NEXT-SESSION.md](NEXT-SESSION.md) 了解选定版本和运行状态，再使用 [UAT.md](UAT.md)。当前追踪和回放通过 [gh-genai-traces](plugins/gh-genai-traces/README.zh.md) 使用上游会话服务。带日期的 UAT 结果仅作为其记录版本的历史证据。

## 配置和指南

| 文件 | 用途 |
|---|---|
| [AGENTS.md](AGENTS.md) | 工作范围、验证要求和推理主机的职责 |
| [dsh-settings.yaml](dsh-settings.yaml) | 思考和非思考模型路由，以及凭据环境变量引用 |
| [dsh-cordis.patch.yml](dsh-cordis.patch.yml) | 主目录配置中 Typert、压缩、标题生成和并发的覆盖设置 |
| [web-typert.yml](harness-tests/patches/web-typert.yml) | 启用主目录补丁所禁用 Typert 项目的 Web 叠加配置 |

这些 YAML 文件是受版本控制的部署配置。运行时副本位于 `$DSH_HOME`（默认为 `~/.dsh`）；修改或部署时应验证两者一致。凭据应放在进程环境或被忽略的根目录 `.env` 中，不能写入这些文件。

## 观测工具

| 文件 | 用途 |
|---|---|
| [gh-genai-traces](plugins/gh-genai-traces/README.zh.md) | 实时 GenAI 追踪、经过验证的会话回放、本地 Phoenix 栈，以及带评估的数据集示例 |
| [recproxy.py](recproxy.py) | 检查实际采样和推理字段时记录请求正文 |
| [sample-engine-metrics.sh](harness-tests/sample-engine-metrics.sh) | 采样引擎累计计数器；使用场景前后的样本计算增量 |
| [results/](results/) | 带日期的证据，包括[上游更新审计](results/upstream-audit-20260905.md) |

八月的结果记录了针对其指定部署的实验，不能证明当前引擎行为、插件数量、UI 支持或 UAT 成功。此部署应使用新的 UAT 证据。已移除的端点探测工具可从 Git 历史恢复。

## 开发插件

插件源码及其部署叠加配置应保存在 `artifacts/plugins/`。DSH 的[首个插件教程](../docs/user/develop/basic/index.zh.md)、[工具教程](../docs/user/develop/basic/tool.zh.md)和[打包指南](../docs/user/develop/basic/publish.zh.md)提供开发与安装说明。浏览器扩展使用[客户端模块](../docs/subsystems/client-modules.zh.md)和 [UI 插槽](../packages/client/ui-slots/README.zh.md)。优先使用这些扩展点；DOM 选择器和注入的 CSS 依赖当前 UI 实现，上游更新后需要重新检查。

推理主机负责引擎配置及其使用指南（`kb-mastra-infra/HOW-TO.md`）。端点行为应以该实时来源为准，不在此处维护另一份副本。
