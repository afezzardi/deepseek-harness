# Fork source changes

This register tracks product corrections outside `artifacts/` that require review when merging or updating from `origin` or `upstream`. It supplements the complete fork-only Git diff; it is not an exhaustive inventory of older merged corrections.

The root `AGENTS.md` explicitly requires this register and regression checks during origin/upstream updates. Its previous 1,950-word budget was fully occupied; the fork raises the ceiling to 2,120 words to retain all standing instructions plus the requested fork-maintenance rule with more than 5% headroom.

## Empty tool arrays after tool history

Base revision: `78feb30d6db8299f3b2ff1fbea4f761930f2789a`. The correction belongs to `features/road-to-agent`. Publishing this source change does not deploy it or authorize a second live trial.

The SOFIA manager reports that its SDK/PTC attempt `attempt-eJdbVY` completed two tool-enabled requests and failed at the tools-free synthesis request because vLLM rejected `tools: []`. The original canonical failure and trace remain the evidence for that attempt. The maintenance bridge does not require an SDK extension.

The [pi-ai adapter](../packages/llm/llm-pi-ai/src/adapter.ts) exposes provider-level `omitEmptyTools: true` through [configuration](../packages/llm/llm-pi-ai/src/config.ts). It removes an empty `tools` field from OpenAI Chat Completions payloads after pi-ai serialization. Canonical tool arrays, historical calls/results, and nonempty tool definitions remain intact. Omission or `false` preserves pi-ai's proxy compatibility behavior. Configure this on the selected isolated trial provider; global home settings are not changed.

The [decision note](../.agents/notes/implemented/bug-fix/2026-09-15-pi-ai-empty-tools-wire-policy.md) records the tradeoff. The focused regression is `pnpm exec vitest run packages/llm/llm-pi-ai/tests/adapter.spec.ts -t 'preserves tool history'`; it uses an ephemeral local HTTP server and no model. Three cases pass. Package compilation with `pnpm exec tsc -b packages/llm/llm-pi-ai/tsconfig.json` passes. Live vLLM acceptance remains pending with the SOFIA manager.

### Local artifact and validation

The rebuilt artifact is `packages/llm/llm-pi-ai/lib/index.js`, SHA-256 `0445516c5d6955e960ea55f5f5ef72f2c3d1da716075fc3444da2e1b659e7b11`. Build command: `pnpm exec tsdown --filter @deepseek-ai/dsh-llm-pi-ai --env.DSH_BUILD_FACE host`, following the package TypeScript build above. The full adapter file passes all 53 tests. A temporary built-artifact smoke (`/tmp/check-pi-empty-tools-built.mjs`) sends synthetic tool history to an ephemeral local server that rejects any `tools` field; it passes with history preserved and canonical `[]` intact. Focused type-aware lint passes. These are local checks, not evidence of live vLLM acceptance. The SOFIA manager must explicitly repin before a later authorized trial.

### Merge and dependency-update review

Inspect incoming `toPiContext`, adapter payload hooks, profile schemas, and pi-ai's OpenAI serializer. Preserve both omission-on and omission-off behavior. Run the focused regression against the new dependency graph and rebuild `packages/llm/llm-pi-ai/lib/index.js`; a matching Git revision alone does not attest rebuilt or locally modified artifacts. Repin the artifact hash explicitly before any later authorized trial.

Retire this fork option only when an upstream implementation provides equivalent configurable behavior and the wire regression passes. Migrate every configured `omitEmptyTools` consumer before removing the field. Do not remove history, add a dummy tool, change canonical `[]`, or replay the failed attempt to conceal its error.
