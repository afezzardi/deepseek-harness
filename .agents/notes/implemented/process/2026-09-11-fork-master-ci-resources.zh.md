# Agent Note: Fork master CI 资源归属

Status: implemented

[English](2026-09-11-fork-master-ci-resources.md) | 中文

## Problem

Fork 不会继承上游的运行器注册或外部 DeepSeek 凭据。本 fork 使用自托管推理，明确不配置 `DEEPSEEK_API_KEY_EXTERNAL`。

## Decision

[Master CI](../../../../.github/workflows/ci-master.yml) 将上游备用演练和手动运行器集群基准限制在非 fork 仓库中。Fork 仍启用托管运行器上的 Wine 和 Python runtime 打包。

[E2E](../../../../.github/workflows/e2e.yml) 和 [Python runtime 打包](../../../../.github/workflows/build-exe-for-python-sdk.yml) 中的真实 API 预检及测试步骤要求 `github.event.repository.fork == false`。现有的 PR 作者排除条件和缺失密钥时报错的行为仍适用于符合条件的上游运行。Fork 仍启用无密钥的已安装 wheel 检查。外部 API 测试不会重定向到 fork 的推理主机。

[故障切换操作手册](2026-07-26-ci-failover-runbook.zh.md) 和[真实 API 策略](../testing/2026-06-19-real-api-e2e-ci.zh.md) 保留各自独立的上游适用范围。

## Alternatives considered

**在每个 fork 中配置上游资源。** 运行器注册和外部 API 计费需要独立的运维决策。

**跳过所有 master 检查。** 这会丢失托管运行器能够提供的无密钥打包、Wine 和内核隔离证据。

**将测试重定向到自托管推理。** 这会改变被测试的提供方，需要单独定义推理验证任务。

## Consequences

Fork 运行不提供外部 DeepSeek API 或上游备用运行器就绪状态的证据。在 fork 中重新启用这些任务需要明确修改工作流策略。部署和训练仍是独立操作。
