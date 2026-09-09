# Trace-to-dataset handoff

## Resume here

The user is establishing infrastructure before choosing a real workload, not preparing to fine-tune soon. Read the [foundation report](../../results/fireworks-sft-20260909/REPORT.md), [method comparison](../../results/fireworks-sft-20260909/METHODS.md), and [experiment guide](experiments/README.md). Work stays under `artifacts/` on `fork/qwen38-deployment`.

## Preserved collection evidence

The [r5 campaign](../../results/trace-pipeline-r3-20260909/REPORT.md) has 48 task instances, 144 trials, 111 passes, 30 task failures, and three timeouts. Its 201 canonical sessions and 402 source files remain authoritative. Phoenix holds all 144 experiment outcomes and 300 eligible targets: 111 final answers and 189 independently graded tool decisions. Do not repeat the campaign without a new task revision or a specific diagnostic purpose.

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
| Documentation host issue | The existing Node 24.12 Markdown globber ENOTDIR failure is separate host/upstream work; report current checks exactly. |
| Deployment UAT | The benchmark and dataset checks do not replace [fresh deployment acceptance](../../UAT.md). |

Raw sessions, proxy recordings, Phoenix snapshots, destination JSONL, previews, and backups remain private ignored evidence. Preserve the earlier cleanup backups, including the only retained copy of deleted historical spans. The user owns inference; explain a concrete change before changing its configuration or restarting services.
