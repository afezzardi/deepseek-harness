# Deployment runbook

The fork includes upstream revision `c389f96bf3a9b6807cb71ed6bdad5849be0df6d8` through merge `836e963caba622ae214de2344ed0d26b4794469e`. All fork-only product customizations remain under `artifacts/`. A fresh upstream fetch at the merge confirmed that revision as `upstream/master`.

## Current validation

[gh-genai-traces](plugins/gh-genai-traces/README.md) owns live tracing, recorded-session replay, the local Phoenix stack, and its evaluation example. Its [validation report](plugins/gh-genai-traces/VALIDATION.md) separates source tests, the built headless smoke, native Phoenix ingestion, and deployment blockers. Dated [results](results/) describe their own revisions and are not current deployment acceptance.

The user reports that the self-hosted inference endpoint is offline. Keyless validation does not establish model behavior. Fireworks AI is an available alternative for a bounded live smoke when credentials are supplied; no Fireworks calls are required by the offline tests.

## Configuration and acceptance

Keep [settings](dsh-settings.yaml) and the [home patch](dsh-cordis.patch.yml) aligned with runtime copies only when deploying. The tracing overlay is an explicit launch option; it does not install itself into the user's profiles. Web retains the [Typert overlay](harness-tests/patches/web-typert.yml) and [effort slider](plugins/effort-slider/README.md).

[UAT.md](UAT.md) owns live deployment acceptance. Preserve the inference host's ownership: do not change its configuration or restart its services. Record revision, route, session identities, commands, observed outcomes, and skipped checks with each deployment probe.
