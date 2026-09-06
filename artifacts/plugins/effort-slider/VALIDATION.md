# Effort slider validation — 2026-09-06

The plugin is built and can be enabled with the launch command in [the plugin index](../README.md). It is not installed into the default profile. Acceptance used temporary DSH homes and a temporary workspace; versioned deployment settings were not modified.

## Executed checks

| Check | Result |
|---|---|
| `node artifacts/plugins/effort-slider/setup.mjs` | Local dependency links prepared; repeated setup accepted matching links |
| `node artifacts/plugins/effort-slider/build.mjs` | Host entry, browser factory, source map, and absolute-path overlay emitted |
| `pnpm exec tsc -p artifacts/plugins/effort-slider/tsconfig.json` | Passed against the checkout's prepared upstream declarations |
| `pnpm exec vitest run --config artifacts/plugins/effort-slider/vitest.config.ts` | 12 tests passed, including built-module disposal |
| `pnpm exec oxlint --config artifacts/plugins/effort-slider/oxlint.json artifacts/plugins/effort-slider` | Passed the plugin's explicit correctness rules |
| Fresh-session Web initialization | No browser page errors after declaring the directory creation dependencies |
| Chromium keyboard interaction | Saved `off`, `low`, `medium`, and `xhigh`; focus returned after saving and the native picker reflected changes |
| Page reload | Previously saved selection remained visible |
| Narrow viewport | At 390 × 844, panel bounds were x=16, y=564, width=358, height=196 |
| v2 log decoding | Acceptance session decoded across 14 Zstandard frames, with no torn frame |

The browser connector could not find its Chrome executable. Browser acceptance therefore used the checkout's Playwright dependency and an already installed Chromium executable. Sandbox restrictions initially blocked localhost listeners, Chromium sockets, and tsx IPC; the affected commands were retried with host access. No browser installation was needed.

The final late-failure recovery change was checked by the focused tests and TypeScript after browser acceptance. It changes recovery when another picker updates the selection during a failed request; it does not change the successful request or layout paths shown in the captures.

## Real request and session evidence

The isolated Web profile used a temporary copy of the fork's settings with its base URL directed through the existing request recorder. The recorder forwarded to the configured Qwen endpoint. Two user prompts asked for short, tool-free replies; both completed with HTTP 200 responses.

| Selection | Captured `chat_template_kwargs` | Observed answer |
|---|---|---|
| `off` | `enable_thinking: false`, `preserve_thinking: false`; no `reasoning_effort` member | `OK` |
| `medium` | `enable_thinking: true`, `reasoning_effort: "medium"`, `preserve_thinking: false` | `READY` |

Neither request included a top-level `reasoning_effort`. This deployment uses the provider's chat-template serialization. The recorder also captured one non-thinking session-title request, so its evidence file contains three records. The session log contains four `model/selection` events, preserving `local-qwen` and `chat-model` while recording `xhigh`, `off`, `low`, and `medium` in order. Its two `request/header` records carry `off` and `medium` respectively.

Evidence is deliberately limited to selection fields, request fields, and UI captures; credentials, authentication URLs, system prompts, and full model reasoning are excluded:

- [Persisted selections](validation/20260906/model-selections.json)
- [Recorded request fields](validation/20260906/request-fields.json)
- [Session request observations](validation/20260906/session-observations.json)
- [Desktop capture](validation/20260906/desktop.png)
- [Narrow viewport capture](validation/20260906/narrow.png)

These probes establish selection persistence and request serialization. They do not establish a quality, latency, or reasoning-token difference between `low`, `medium`, and `xhigh`, nor support for providers other than the inspected Qwen configuration. The final tests use isolated stores for failure cases; a deliberate live connection failure and a live addressed-subagent session were not exercised.

## Repository documentation checks

`pnpm run test:docs` initially passed 13 gates and failed two: Markdown wrapping failed with `ENOTDIR` inside the repository's `globSync` discovery, and translation pairing reported missing README counterparts. The two new plugin README pairs were then translated and recorded with the repository verifier.

`pnpm run doc-sync` subsequently passed 31 gates and failed two. The remaining translation failure is the pre-existing missing `artifacts/README.zh.md`; the wrapping failure still points to `snapshots/acp/image-compaction/system-prompt.expected.md/system-prompt.expected.md`. Neither failure points to plugin source. The full output is retained in [documentation-checks.log](validation/20260906/documentation-checks.log). These are failures, not a passing repository documentation result.

Root lint rules target upstream source directories, so the plugin has its own small lint configuration. The explicit local lint command above is the relevant result; a root lint invocation is not evidence that files under `artifacts/` were checked.
