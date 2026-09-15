# Agent Note: Empty tool arrays in pi-ai requests

Status: implemented

English | [中文](2026-09-15-pi-ai-empty-tools-wire-policy.zh.md)

## Problem

pi-ai adds an empty OpenAI Chat Completions `tools` array when conversation history contains tool calls, even when the current request declares no tools. Some proxies require that field; the selected self-hosted vLLM endpoint rejects it. Removing canonical history or adding a dummy tool changes the investigation instead of correcting serialization.

## Decision

The provider profile exposes `omitEmptyTools`, disabled unless explicitly enabled. For OpenAI Chat Completions, the adapter uses pi-ai's payload callback to omit only an empty `tools` field. Canonical requests and historical calls/results are unchanged. Nonempty tool definitions and other protocols retain their serialization.

## Alternatives considered

Unconditional omission breaks proxies that require the empty field. A SOFIA transport rewrite duplicates provider ownership. Changing pi-ai installation files makes the correction disappear on dependency installation. The adapter owns the explicit route policy until upstream offers an equivalent option.

## Consequences

The local HTTP regression in [adapter.spec.ts](../../../../packages/llm/llm-pi-ai/tests/adapter.spec.ts) checks opt-in omission, default proxy compatibility, preserved history, and nonempty definitions. No Session format or SDK protocol changes. Live endpoint validation is separate. The [fork register](../../../../artifacts/FORK-SOURCE-CHANGES.md) governs preservation and retirement during origin/upstream updates; the existing [pi-ai upgrade note](2026-09-05-pi-ai-upgrade-compatibility.md) continues to govern upstream field classification and replay metadata.
