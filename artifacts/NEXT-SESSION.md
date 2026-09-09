# Deployment runbook

## Active work: traces to datasets

Start with the [gh-genai-traces handoff](plugins/gh-genai-traces/HANDOFF.md) and [foundation report](results/fireworks-sft-20260909/REPORT.md). The user is establishing a reliable trace-to-dataset pipeline before selecting a real workload; no near-term fine-tuning is planned. The r5 benchmark and its canonical sources remain preserved. The explicit reasoning-and-action exporter produces 300 targets with frozen splits; authorized Fireworks train/validation uploads and native previews provide destination evidence. Workload quality, DPO pair collection, RFT rollouts, and actual trainer verification remain separate work. No training, paid inference, inference configuration change, or push is authorized.

## Upstream baseline

The fork includes upstream revision `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8` through merge `836e963caba622ae214de2344ed0d26b4794469e`. All fork-only product customizations remain under `artifacts/`. A fresh upstream fetch at the merge confirmed that revision as `upstream/master`.

## Current validation

[gh-genai-traces](plugins/gh-genai-traces/README.md) owns live tracing, recorded-session replay, the local Phoenix stack, and its evaluation example. Its [validation report](plugins/gh-genai-traces/VALIDATION.md) separates source tests, the built headless smoke, native Phoenix ingestion, and deployment blockers. Dated [results](results/) describe their own revisions and are not current deployment acceptance.

The self-hosted inference endpoint was exercised by the [2026-09-09 campaign](results/trace-pipeline-r3-20260909/REPORT.md). The earlier [discovery](results/trace-discovery-20260908/REPORT.md) retains its dated observations. The active user settings still select `xhigh`; discovery uses isolated homes with `agent-default-model.reasoningEffort: medium`. These measurements do not replace the remaining deployment acceptance cases.

## Configuration and acceptance

Keep [settings](dsh-settings.yaml) and the [home patch](dsh-cordis.patch.yml) aligned with runtime copies only when deploying. The tracing overlay is an explicit launch option; it does not install itself into the user's profiles. Web retains the [Typert overlay](harness-tests/patches/web-typert.yml) and [effort slider](plugins/effort-slider/README.md).

[UAT.md](UAT.md) owns live deployment acceptance. The user owns inference too; explain a concrete inference change before applying it or restarting services. Record revision, route, session identities, commands, observed outcomes, and skipped checks with each deployment probe.
