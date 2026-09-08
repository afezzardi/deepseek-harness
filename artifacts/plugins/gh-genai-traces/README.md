---
description: "Capture DSH execution in self-hosted Phoenix, replay recorded sessions, and link evaluated examples to their source traces."
kind: "package-reference"
---
# gh-genai-traces

English | [中文](README.zh.md)

## Summary

Gruppo Happy can inspect model requests, tool calls, provider usage, and session outcomes in Phoenix. An explicit profile overlay enables live capture; historical replay uses upstream session-query and exports to a separate project. Rich content is redacted and bounded, with source identifiers retained when content is omitted. Canonical sessions remain the reconstruction source.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Run commands from the repository root after installing and building upstream DSH. This private package lives outside the root pnpm workspace; its own npm lockfile pins its external dependencies.

```sh
npm ci --prefix artifacts/plugins/gh-genai-traces --legacy-peer-deps --ignore-scripts
node artifacts/plugins/gh-genai-traces/setup.mjs
node artifacts/plugins/gh-genai-traces/build.mjs
node artifacts/plugins/gh-genai-traces/stack/setup.mjs
docker compose -f artifacts/plugins/gh-genai-traces/stack/compose.yml up -d
pnpm dsh --profile headless --patch artifacts/plugins/gh-genai-traces/lib/overlay.yml "your task"
```

The stack exposes Phoenix on `http://127.0.0.1:6006` and OTLP/HTTP on `http://127.0.0.1:4318/v1/traces`. The generated overlay enables `rich-redacted` capture and replaces the stock telemetry backend. Without the overlay, this plugin is absent. Web can use the same overlay alongside the existing Typert and effort-slider overlays.

The Compose services use named volumes and retain traces for 30 days by default. `PHOENIX_PORT`, `OTLP_HTTP_PORT`, and `PHOENIX_RETENTION_DAYS` configure the stack. `stack/setup.mjs` creates a private ignored database credential once; `docker compose ... down` preserves the volumes. The stack disables Phoenix analytics and external UI resources.

Set `GH_GENAI_OTLP_ENDPOINT` to change the complete trace endpoint and `GH_GENAI_PROJECT` to change the project. Set `GH_GENAI_REPLAY_SESSIONS` to comma-separated session IDs before launching the profile to replay them through the configured DSH store. Replay exports to `<project>-replay`; it does not launch or rewrite the recorded sessions. Rebuild after source changes; restart the profile to apply its overlay.

### Capture controls

The [configuration schema](src/config.ts) owns every accepted field and default. Direct plugin mounting defaults to `metadata`; the generated overlay explicitly selects rich content.

| Field | Default | Meaning |
|---|---|---|
| `metadata` / `exportStandaloneEvents` | `{}` / `false` | Campaign/task/trial labels; opt in to zero-duration standalone event spans |
| `content` | `metadata` | `rich-redacted` includes bounded messages, tool schemas, arguments, results, and model-emitted reasoning |
| `secretEnv` | Three named provider-key variables | Remove their literal values from exported content |
| `redactKeys` | Common credential fields | Remove matching JSON fields; credential assignments and bearer tokens are also redacted |
| `maxContentBytes` | 65,536 | Maximum encoded bytes per content attribute; oversized JSON is omitted with a truncation marker |
| `maxStreamBytes` | 262,144 | Maximum captured chunk representation per model call; terminal usage remains available |
| `maxPendingRecords` / `maxActiveSpans` | 1,024 / 4,096 | Bound queued mapping jobs and concurrent span state |
| `maxEventsPerSpan` / `maxTurnEvents` | 128 / 8,192 | Bound event presentation and turn-usage folding |
| `maxQueueSize` / `maxExportBatchSize` | 2,048 / 128 | Bound SDK export admission and batch size |
| `exportTimeoutMillis` / `shutdownTimeoutMillis` | 3,000 / 5,000 | Bound export and plugin shutdown waits |

Each content field distinguishes `complete`, actual `redacted` changes, `truncated`, `omitted`, and `withheld` serialization. Model spans separately report capture eligibility, rejection reasons, requested reasoning effort, request/tool/configuration hashes, and an ungraded task outcome. Redaction changes exported copies only. Known-secret removal is not comprehensive PII detection. Both truncation and redaction can make a trace unsuitable for training; dataset curation must inspect their markers and obtain the required source records.

### Verification and evaluation

```sh
pnpm exec tsc -p artifacts/plugins/gh-genai-traces/lib/tsconfig.check.json
pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts
GH_PHOENIX_URL=http://127.0.0.1:6006 GH_GENAI_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts tests/phoenix.spec.ts
```

The ordinary suite includes a built-plugin headless test with a mock model and a real shell. The Phoenix test creates synthetic trace, dataset, experiment, and annotation records in a uniquely named validation project. The [evaluation example](examples/evaluation.ts) exports `evaluateReadFixture(baseURL, project, expected)` through the package's `./evaluation` entry. It checks the recorded read observation against a fixture-owned expected value and retains full request/tool definitions and source linkage in the dataset example. It is not a general task-success evaluator.

[VALIDATION.md](VALIDATION.md) records exact commands, measurements, and deployment limitations. Live inference and model quality require separate evidence; neither unit tests nor the synthetic Phoenix example establish them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation and data ownership</summary>

`SessionTelemetryCoordinator` supplies detached live records; the backend adds their canonical envelope references and enqueues mapping. The `llm/stream` waterfall supplies request-time harness inputs and lazy-stream timing. One trace groups a turn, with model calls and tools under step spans; recorded workflow child IDs establish parent span contexts in the same trace. Live child records wait in a bounded buffer for membership publication; replay resolves ancestors through upstream services. Workflow and step spans use Phoenix’s `CHAIN` kind. Auxiliary model calls carry a separate purpose. No process-global tracer provider or asynchronous context manager is installed.

Replay uses session-query, upstream surface/header folds, and the upstream compact-stream reader. It reconstructs model inputs before each recorded assistant settlement and labels model duration as first-recorded-chunk to last-recorded-chunk. It does not export a reconstructed dispatch latency. The upstream token-meter turn helper supplies exact turn totals when the record is complete; per-call token attributes omit unprovable aggregate input counts. Tool duration covers the recorded call-to-result interval, including any intervening waits.

The SDK batches OTLP protobuf exports. Diagnostic counters distinguish record admission, mapping errors, span admission/drop, successful exporter callbacks, failed callbacks, and pending spans. A successful callback is receiver acknowledgement, not proof of durable Phoenix storage. The Collector's persistent queue protects accepted downstream batches; it cannot recover a lost SDK queue. Stable source-derived replay IDs permit repeated import into the tested Phoenix release without duplicate spans.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Design decision](DESIGN.md): source ownership, alternatives, and compatibility.
- [Upstream telemetry](../../../packages/session/session-telemetry/README.md): capture and lifecycle semantics.
- [Upstream session-query](../../../packages/session-query/session-query/README.md): validated historical reads.
- [GenAI conventions](https://github.com/open-telemetry/semantic-conventions-genai): developing interoperability specification.
- [Phoenix native conversion](https://arize.com/docs/phoenix/release-notes/05-2026/05-15-2026-otel-semconv-conversion): server-side presentation.

<a id="model-experience"></a>
## Model Experience

This plugin contributes no tools, prompts, or model-visible session events. Observation preserves downstream chunks, exceptions, and iterator closure; export does not wait on the model or tool hot path.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

The [curation library](src/curation.ts), exported as `./curation`, validates final-answer SFT candidates, grouped splits, and exact-request managed-DPO pairs. The [experiment guide](experiments/README.md) describes canonical auditing, frozen text sampling, resettable fixtures, and independent grades. Local schema validation does not establish renderer compatibility or trained-model improvement.

- Request capture represents the harness input before adapter serialization; provider HTTP bodies, tokenizer IDs, hidden reasoning, and attachments' raw bytes are not captured.
- Replay cannot recover live-only timings or auxiliary request details absent from the session. Cold reads may include upstream-generated interruption closers, explicitly identified at the turn level.
- Queue loss, process crashes, late attachment, and hot reload can leave incomplete traces. Restart capture before a new turn for clean live evidence; use replay for a complete stored turn.
- Cross-process child traces require the plugin and access to recorded ancestor membership. Unresolved or independent children retain their session relationship without fabricated nesting. Workflow records lack the invoking tool-call ID, so the workflow stays under the step. Mapping version 2 uses a separate deterministic ID namespace.
- Automatic semantic recall, ATIF export, backend renderer approval, exact-token RL, pricing policy, and a general-purpose evaluator are deferred. Phoenix's own pricing estimates are not validated inference costs.

### Dev Note

Measured evidence lives in [VALIDATION.md](VALIDATION.md). The GenAI mapping is versioned independently of the durable DSH session format.
