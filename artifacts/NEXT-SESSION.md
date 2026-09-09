# Deployment runbook

## Active work: traces to datasets

Start with the [gh-genai-traces handoff](plugins/gh-genai-traces/HANDOFF.md) and [2026-09-09 report](results/trace-pipeline-r3-20260909/REPORT.md). The repaired revision-5 benchmark completed 144 trials: 111 passes, 30 task failures, and three timeouts. Phoenix holds the native experiment and 300 eligible targets. All 201 canonical sessions reconstructed; 524 settled provider requests matched byte-for-byte. Explicit template-trim rendering passes full-example engine token parity for all 111 eligible final answers and twelve pilot answers without changing canonical data or inference configuration. This resolves the observed whitespace blocker, but does not approve production thinking training. Cleanup and tested local backups are recorded in the report. This checkpoint keeps all fork changes under `artifacts/`; push, training, and paid operations remain unauthorized.

## Upstream baseline

The fork includes upstream revision `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8` through merge `836e963caba622ae214de2344ed0d26b4794469e`. All fork-only product customizations remain under `artifacts/`. A fresh upstream fetch at the merge confirmed that revision as `upstream/master`.

## Current validation

[gh-genai-traces](plugins/gh-genai-traces/README.md) owns live tracing, recorded-session replay, the local Phoenix stack, and its evaluation example. Its [validation report](plugins/gh-genai-traces/VALIDATION.md) separates source tests, the built headless smoke, native Phoenix ingestion, and deployment blockers. Dated [results](results/) describe their own revisions and are not current deployment acceptance.

The self-hosted inference endpoint was exercised by the [2026-09-09 campaign](results/trace-pipeline-r3-20260909/REPORT.md). The earlier [discovery](results/trace-discovery-20260908/REPORT.md) retains its dated observations. The active user settings still select `xhigh`; discovery uses isolated homes with `agent-default-model.reasoningEffort: medium`. These measurements do not replace the remaining deployment acceptance cases.

## Configuration and acceptance

Keep [settings](dsh-settings.yaml) and the [home patch](dsh-cordis.patch.yml) aligned with runtime copies only when deploying. The tracing overlay is an explicit launch option; it does not install itself into the user's profiles. Web retains the [Typert overlay](harness-tests/patches/web-typert.yml) and [effort slider](plugins/effort-slider/README.md).

[UAT.md](UAT.md) owns live deployment acceptance. The user owns inference too; explain a concrete inference change before applying it or restarting services. Record revision, route, session identities, commands, observed outcomes, and skipped checks with each deployment probe.
