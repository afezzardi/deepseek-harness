# artifacts/

English | [中文](README.zh.md)

Fork-local configuration, instruments, and acceptance checks for DeepSeek Harness with the self-hosted Qwen3.8-27B endpoint. Keep all deployment customizations here so the product tree can sync from upstream.

Start with [NEXT-SESSION.md](NEXT-SESSION.md) for the selected revision and operational status, then use [UAT.md](UAT.md). Current tracing and replay use upstream session services through [gh-genai-traces](plugins/gh-genai-traces/README.md). Dated UAT results remain historical evidence for their recorded revisions.

## Configuration and guidance

| File | Purpose |
|---|---|
| [AGENTS.md](AGENTS.md) | Scope, verification discipline, and inference-host ownership |
| [dsh-settings.yaml](dsh-settings.yaml) | Thinking and non-thinking model routes; credential environment-variable references |
| [dsh-cordis.patch.yml](dsh-cordis.patch.yml) | Home profile overrides for Typert, compaction, titling, and concurrency |
| [web-typert.yml](harness-tests/patches/web-typert.yml) | Web overlay enabling the Typert rows disabled by the home patch |

The YAML files are the versioned deployment configuration. Runtime copies live under `$DSH_HOME` (default `~/.dsh`); verify equality when changing or deploying them. Credentials belong in the process environment or the ignored root `.env`, never in these files.

## Instruments

| File | Purpose |
|---|---|
| [gh-genai-traces](plugins/gh-genai-traces/README.md) | Live GenAI tracing, validated session replay, local Phoenix stack, and an evaluated dataset example |
| [recproxy.py](recproxy.py) | Record request bodies when checking actual sampling and reasoning fields |
| [sample-engine-metrics.sh](harness-tests/sample-engine-metrics.sh) | Sample cumulative engine counters; use bracketing samples for scenario deltas |
| [results/](results/) | Dated evidence, including the [upstream update audit](results/upstream-audit-20260905.md) |

August results record experiments against their stated deployment. They do not establish current engine behavior, plugin counts, UI support, or UAT success. Use fresh UAT evidence for this deployment. Retired endpoint probes are recoverable from Git history.

## Developing plugins

Keep plugin source and its deployment overlay under `artifacts/plugins/`. DSH's [first-plugin tutorial](../docs/user/develop/basic/index.md), [tool tutorial](../docs/user/develop/basic/tool.md), and [packaging guide](../docs/user/develop/basic/publish.md) own development and installation instructions. Browser extensions use [client modules](../docs/subsystems/client-modules.md) and [UI slots](../packages/client/ui-slots/README.md). Prefer those extension points; DOM selectors and injected CSS depend on the current UI implementation and need rechecking after upstream updates.

The inference host owns engine configuration and its consumer guide (`kb-mastra-infra/HOW-TO.md`). Consult that live source for endpoint behavior instead of maintaining another copy here.
