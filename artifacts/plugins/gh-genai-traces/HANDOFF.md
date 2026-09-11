# Trace-to-dataset handoff

## Resume here

The first workload is advanced SecOps with InspectX, investigative skills and corporate KB, driven by DSH SDK + PTC. `gh-genai-traces` is part of the first composition; training remains deferred. The [next-session entry point](../../NEXT-SESSION.md#main-objective-build-the-first-secops-agent) owns the implementation direction and final presentation. Read the [foundation report](../../results/fireworks-sft-20260909/REPORT.md), [method comparison](../../results/fireworks-sft-20260909/METHODS.md), and [experiment guide](experiments/README.md). Deployment remains pending manual acceptance.

The active checkout is `/home/andrea/management/deepseek-harness` on `features/road-to-agent`, created from the fork's merged `master`. [PR #1](https://github.com/afezzardi/deepseek-harness/pull/1) merged on 2026-09-11 as `77b16a8229f07790d91771622173a397c711ba67`, including upstream `c291e7961a515f6d7af9304e7fd1d257929aef26`, the tracing transition, and CI corrections. The user authorized the merge, then this branch and a local session commit; the [next-session entry point](../../NEXT-SESSION.md) records the active checkout and first follow-up. Earlier [artifact guidance](../../AGENTS.md) reserving `master` as an upstream mirror predates that authorization. The `upstream` remote remains read-only. Keep deployment customizations under `artifacts/`; the merged integration also includes authorized workflow, test, and lifecycle corrections outside that directory.

The `/tmp/dsh-v3-transition` worktree on `fork/qwen38-v3-transition` and `/tmp/dsh-ci-native-diagnosis` diagnostic worktree are older checkpoints, not the active checkout. Resume on `features/road-to-agent`; no rebase is needed for this handoff.

## CI and merge evidence

All applicable PR checks passed at `436933a4e1f71777514baf93b3e745ae8308b2dc`, including Linux and Windows coverage, Windows native tests, snapshots, fork artifacts, and packaging; [the final PR CI run](https://github.com/afezzardi/deepseek-harness/actions/runs/34636886136) completed successfully before the merge. Real-API E2E and upstream-hosted integrations were skipped by their PR conditions. Local validation of the final correction passed 95 gate-runner tests, all 34 `doc-sync` gates, lint, and the pre-push typecheck. The earlier Node 24.12 Markdown globber failure did not recur in that validation.

The final fix makes [process-table traversal](../../../scripts/run-gates.ts) visit each PID once, exclude the root, and append children without spreading function arguments. Cycles, duplicate rows, and wide tables have deterministic regressions. The Windows failure was a sampler `RangeError`, not a test assertion. Synthetic PID cycles reproduced it; Windows PID reuse is a supported explanation, but the failing runner's process-table snapshot was not retained. PID-only observations still cannot prove process identity after reuse. The [gate-runner decision](../../../.agents/notes/implemented/process/2026-07-06-parallel-pre-push-gates.md) records the resulting behavior; [earlier CI evidence](../../results/transition-v4/CI.md) describes preceding corrections.

Merging triggered separate `push` workflows on `master`; switching the local checkout did not trigger them. The [next-session workflow table](../../NEXT-SESSION.md#first-follow-up-master-workflows) owns their last-observed statuses and run links. Refresh those statuses before diagnosing further. This branch includes the reviewed fork-specific conditions for upstream runners and external-API jobs. They are not pushed; the remote runs do not exercise these fixes. Do not add credentials or enable paid API calls merely to make the workflow green.

## Preserved collection evidence

The [r5 campaign](../../results/trace-pipeline-r3-20260909/REPORT.md) has 48 task instances, 144 trials, 111 passes, 30 task failures, and three timeouts. Its 201 canonical sessions and 402 source files describe that development run. Phoenix holds all 144 experiment outcomes and 300 eligible targets: 111 final answers and 189 independently graded tool decisions. These datasets and their provenance are disposable development evidence; rebuilding them is authorized. The V3 transition has a fresh small acceptance campaign; its [review resolution](../../results/transition-v4/FABLE-RESOLUTION.md) records current checks and remaining acceptance gaps.

The existing local Qwen final-answer renderer passed token parity on 123 real rows with explicit template trimming. Its format-only loss excludes target reasoning and termination. That historical result does not describe Fireworks’ managed loss or establish production thinking behavior.

## Foundation evidence

The explicit Fireworks outcome export retains selected reasoning plus an answer or graded tool calls, with earlier assistant messages masked. Source candidates, privacy reviews, and Phoenix versions are unchanged; per-line derivation hashes identify the separate destination objective. The complete private bundle has 223 train, 40 validation, and 37 held-out test rows. The user authorized train/validation uploads for dataset and renderer verification. Their READY status, download hashes, native preview results, diagnostic limits, and precise command evidence live in the foundation report. These synthetic rows validate the pipeline, not future workload quality.

Dataset upload and pre-training rendering are separate from training jobs. Native previews expose reasoning-history modes, template text, and segment loss weights without a training job; exact trainer token IDs still require separate evidence. No paid inference, training, deployment, or inference-host change was performed in the foundation work.

## Pending work

| Work | Status and next action |
|---|---|
| Real workload | User will define tasks, expected behavior, failure preferences, and rewards. Collect representative complete traces and freeze connected splits then. |
| SFT objective | Outcome-reasoning export is implemented and exercised as infrastructure. Serving/training effort, history, and template compatibility need workload-specific choices; preview text is not trainer-token or quality evidence. |
| DPO | Existing r5 evidence has zero identical-request pass/fail pairs. Collect alternatives for the same complete request once useful preferences are defined. Current managed exporter supports one-turn text without tools; a same-request repeat collector and tool/multi-turn exporter remain infrastructure work. |
| RFT | Reuse resettable tasks and graders when adapting the real workload to fresh policy rollouts. A rollout environment adapter and reward service remain infrastructure work. Historical sampled token IDs are absent; exact-token replay RL remains unsupported. |
| Training | Intentionally deferred. Do not launch a training job or interpret dataset acceptance as authorization to train. |
| Backup durability | Earlier local restores passed. Both private pre-cleanup and final backups still need an off-host destination before relying on disk-loss survival. |
| Master-push workflows | Start with the [workflow table](../../NEXT-SESSION.md#first-follow-up-master-workflows), refresh run statuses, and diagnose failures from their own logs. |
| Deployment UAT | The benchmark and dataset checks do not replace [fresh deployment acceptance](../../UAT.md). |

Raw sessions, proxy recordings, Phoenix snapshots, destination JSONL, previews, and backups remain private ignored evidence. Preserve the earlier cleanup backups, including the only retained copy of deleted historical spans. The user owns inference; explain a concrete change before changing its configuration or restarting services.
