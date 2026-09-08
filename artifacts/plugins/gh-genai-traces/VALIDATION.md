# Validation — 2026-09-07

Upstream `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8` is merged as `836e963caba622ae214de2344ed0d26b4794469e`. The committed comparison against upstream contains no differences outside `artifacts/`. New fork implementation and documentation also stay under `artifacts/`.

## Executed checks

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed; 285 workspaces |
| `pnpm run build` | Passed on the merged upstream checkout |
| `node artifacts/plugins/gh-genai-traces/build.mjs` | Passed |
| `pnpm exec tsc -p artifacts/plugins/gh-genai-traces/lib/tsconfig.check.json` | Passed |
| Plugin Vitest suite with Docker Phoenix and Collector endpoints | 26 passed, 1 benchmark skipped; 4.50 seconds |
| Effort-slider build and tests | Passed; 12 tests |
| Two overlapping headless integration processes | Both passed; separate ports and temporary directories |
| Plugin oxlint | Passed |
| Separate stream benchmark | Passed; 25 measured trials after 4 warmups |
| Compose startup | Postgres healthy; Phoenix and Collector running; volume initializer exited 0 |

[Suite output](validation/tests.log) records the full plugin run. It includes a built headless profile with a mock model and real shell, canonical-session replay, eight interleaved workflow children, retry/auxiliary-call separation, redaction, bounded capture, and exporter failure accounting.

The Docker test used `GH_PHOENIX_URL=http://127.0.0.1:6006 GH_GENAI_OTLP_ENDPOINT=http://127.0.0.1:4318/v1/traces pnpm exec vitest run --config artifacts/plugins/gh-genai-traces/vitest.config.ts`. [Phoenix evidence](validation/phoenix-compose.json) records 6 exported and stored spans, including 2 model spans and 1 tool span. Phoenix converted prompt token counts to 12 and 22 and materialized system messages and tool schemas. Reimport retained 6 original spans; a distinct ingestion barrier added exactly 1. A dataset example, experiment run, and evaluation retain source trace linkage. The fixture observation matched expected `42`, scoring 1.0; this is not a general task-quality result.

## Documentation gates

`pnpm run doc-sync` completed 31 of 33 gates successfully. Translation pairing initially failed and was repaired by adding the missing artifacts README counterpart and refreshing both edited pairs. The subsequent repository-wide pairing check passed; [output](validation/translation-pairing.log) records the successful run. The remaining Markdown-wrap gate fails before checking prose: Node v24.12.0 `fs.globSync("snapshots/**/system-prompt.expected.md")` raises `ENOTDIR` for `snapshots/acp/image-compaction/system-prompt.expected.md/system-prompt.expected.md`. A standalone Node invocation reproduces the same failure without plugin imports. No upstream scanner code was changed. [Gate output](validation/doc-sync.log) and [isolated reproduction](validation/glob-reproduction.log) retain the failure.

## Measured stream cost

The [benchmark samples](validation/stream-benchmark.json) compare consuming 1,001 synthetic chunks (16,000 payload characters) with and without the stream observer on Node v24.12.0, Linux. Median duration was 0.164799 ms without capture and 0.912222 ms with capture, a difference of 0.747423 ms. Observed p95 was 2.353208 ms. Capture errors: 0. This measures only the stream wrapper; it excludes event mapping, SDK export, network, and model latency and does not establish application-wide overhead.

## Stack and limits

Phoenix is pinned to 20.8.0, Postgres to 16.13-alpine, and the Collector to the pulled 0.160.0 image digest recorded in Compose. The Collector runs as UID/GID 10001; a one-time service sets ownership of its named queue volume. The initializer reuses the Postgres image and exits before Collector startup. No database or queue volume was deleted. The initial Docker registry TLS failure was resolved externally before this successful run; TLS verification was not disabled by this implementation.

The Collector file-storage extension requires a writable directory. Persistent exporter queues survive supported restarts, but acceptance into earlier in-memory batches is not a durability guarantee. A downstream outage/restart check passed: stop Phoenix, submit one synthetic span to Collector (HTTP 200), observe export retries, restart Collector, start Phoenix, then query the exact trace ID. Collector logged recovery of one stored item; Phoenix stored exactly one matching span. [Recovery evidence](validation/queue-recovery.json) retains its identity. Power-loss durability, disk exhaustion, and production load have not been exercised here. See the [storage documentation](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/main/extension/storage/filestorage/README.md) and [Collector resiliency guidance](https://opentelemetry.io/docs/collector/resiliency/).

All model output in these checks is synthetic or recorded. Local inference remains offline; no Fireworks or other paid inference calls were made. Semantic recall, SFT/DPO curation, general task evaluation, and production cost accounting require further implementation and measured acceptance cases.

## Version-3 checkpoint

The [2026-09-08 checkpoint report](../../results/trace-pipeline-v3/REPORT.md) records the version-3 mapping, candidate-v2 checks, native Phoenix sessions, tokenizer-reference masks, browser recording, and PostgreSQL/source restoration. Earlier sections retain their dated measurements. The balanced baseline, deployed renderer parity, provider fidelity, curated publication, and Fireworks approval remain unfinished.
