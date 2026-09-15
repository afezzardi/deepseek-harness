# Agent Note: pi-ai 请求中的空工具数组

Status: implemented

[English](2026-09-15-pi-ai-empty-tools-wire-policy.md) | 中文

## Problem

当对话历史包含工具调用时，即使当前请求没有工具，pi-ai 也会添加空的 OpenAI Chat Completions `tools` 数组。一些代理需要该字段；选定的自托管 vLLM 端点拒绝它。删除规范历史或添加虚拟工具会改变调查，而不是修正序列化。

## Decision

提供方 profile 暴露 `omitEmptyTools`，仅在显式启用时生效。对于 OpenAI Chat Completions，适配器使用 pi-ai 的载荷回调，仅省略空的 `tools` 字段。规范请求和历史调用/结果保持不变。非空工具定义和其他协议保留其序列化行为。

## Alternatives considered

无条件省略会破坏需要空字段的代理。SOFIA 传输层重写会重复提供方职责。修改 pi-ai 安装文件会使修正在重新安装依赖后消失。在上游提供等效选项之前，由适配器负责显式路由策略。

## Consequences

[adapter.spec.ts](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) 中的本地 HTTP 回归测试检查显式省略、默认代理兼容性、历史保留和非空定义。不改变 Session 格式或 SDK 协议。真实端点验证独立进行。[分叉登记表](../../../../artifacts/FORK-SOURCE-CHANGES.md) 管理 origin/upstream 更新期间的保留和移除；现有 [pi-ai 升级记录](2026-09-05-pi-ai-upgrade-compatibility.zh.md) 继续管理上游字段分类和重放元数据。
