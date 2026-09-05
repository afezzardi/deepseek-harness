# Deployment runbook

The selected upstream revision is `d347e703908d0406b7a7ef80e3a0e594d86b2215`, tagged `dsh-v0.1.3-alpha.1`. The fork is rebased onto that revision. Local adaptations belong under `artifacts/`; the [update audit](results/upstream-audit-20260905.md) records metric-patch findings and verification status.

## Session format and acceptance

Use fresh Session format v2 sessions. The instruments read `session.v2.jsonl.zstd` or decoded v2 JSONL and reject other versions. Do not use August UAT results as acceptance evidence for this checkout; follow [UAT.md](UAT.md) and record the exact session path, revision, and result.

The required simple session reads a real file, handles a missing file, attempts an out-of-workspace write without escalation, and runs a read-only Git command. Optional Web checks cover approval decline/acceptance and explicit compaction.

## Before running

Use the repository's [development setup](../docs/development.md) for dependencies and build prerequisites. Review [dsh-settings.yaml](dsh-settings.yaml) and [dsh-cordis.patch.yml](dsh-cordis.patch.yml), compare them with the active `$DSH_HOME` files, and supply `LITELLM_MASTER_KEY` through the environment or the ignored root `.env`. Do not print the credential.

Web runs need the [Typert overlay](harness-tests/patches/web-typert.yml) while the home patch disables those rows. Verify browser activation and a real model turn; an HTTP response alone does not prove the client plugins work.

The inference endpoint is external to this checkout. A successful offline instrument test does not verify endpoint availability, sampler behavior, or model quality. Record a blocked real-model run as blocked, with its actual error.

## After running

Persist the v2 session metrics and acceptance-check output under a new dated directory in [results/](results/). Record the model route and exact source revision alongside the results. Keep GUI observations separate from log assertions, and identify checks that were not run.

Current validation results belong in the [update audit](results/upstream-audit-20260905.md). Follow the upstream [plugin tutorials](../docs/user/develop/basic/index.md) when adding behavior; keep local plugin sources and overlays under `artifacts/plugins/`.
