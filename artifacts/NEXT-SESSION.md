# Deployment runbook

## Active work: traces to datasets

Start with the [gh-genai-traces handoff](plugins/gh-genai-traces/HANDOFF.md), [continuation report](results/trace-pipeline-v3/CONTINUATION.md), and dated [checkpoint](results/trace-pipeline-v3/REPORT.md). The restored self-hosted inference route completed 144 medium baseline trials. Phoenix holds the recorded experiment and 126 eligible targets; none is training-ready. Provider fidelity passed for 593 settled requests, and one fixture passed observed request-token parity. Task-definition defects limit score interpretation; Fireworks remote renderer verification remains deferred under the no-paid-operations constraint. All changes remain under `artifacts/`. Fable 5.1 feedback has been addressed in the [review dispositions](results/trace-pipeline-v3/FABLE-REVIEW.md), with separate deterministic-v5 re-audit evidence. The original baseline and published versions remain unchanged. The user authorized this checkpoint commit after the second Fable review. Final source grading is deterministic-v6; the preserved v5 re-audit and all 126 historical candidates pass offline consistency checks. Continue with task-revision planning and remaining renderer acceptance. Push, training, and paid operations remain unauthorized.

## Upstream baseline

The fork includes upstream revision `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8` through merge `836e963caba622ae214de2344ed0d26b4794469e`. All fork-only product customizations remain under `artifacts/`. A fresh upstream fetch at the merge confirmed that revision as `upstream/master`.

## Current validation

[gh-genai-traces](plugins/gh-genai-traces/README.md) owns live tracing, recorded-session replay, the local Phoenix stack, and its evaluation example. Its [validation report](plugins/gh-genai-traces/VALIDATION.md) separates source tests, the built headless smoke, native Phoenix ingestion, and deployment blockers. Dated [results](results/) describe their own revisions and are not current deployment acceptance.

The self-hosted inference endpoint was exercised on 2026-09-08. The [trace-to-dataset discovery](results/trace-discovery-20260908/REPORT.md) records real workloads at `medium` reasoning, canonical replay, Phoenix evaluations, and dataset limitations. The active user settings still select `xhigh`; discovery uses isolated homes with `agent-default-model.reasoningEffort: medium`. These measurements do not replace the remaining deployment acceptance cases.

## Configuration and acceptance

Keep [settings](dsh-settings.yaml) and the [home patch](dsh-cordis.patch.yml) aligned with runtime copies only when deploying. The tracing overlay is an explicit launch option; it does not install itself into the user's profiles. Web retains the [Typert overlay](harness-tests/patches/web-typert.yml) and [effort slider](plugins/effort-slider/README.md).

[UAT.md](UAT.md) owns live deployment acceptance. Preserve the inference host's ownership: do not change its configuration or restart its services. Record revision, route, session identities, commands, observed outcomes, and skipped checks with each deployment probe.
