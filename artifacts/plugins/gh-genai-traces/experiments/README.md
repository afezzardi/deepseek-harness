# Dataset experiments

English | [中文](README.zh.md)

## Summary

The experiment scripts launch supported DSH profiles, preserve canonical sessions, and compare model answers with independently computed expected values. They produce local candidates for Fireworks managed text SFT and one-turn DPO. They do not upload data or establish renderer compatibility. [Measured results](../../../results/trace-curation-20260908/REPORT.md) include complex UAT and rejected candidates.

## Contents

- [Run and audit](#run-and-audit)
- [Admission and provenance](#admission-and-provenance)
- [Preference sampling](#preference-sampling)
- [Reward environments](#reward-environments)
- [Provider evidence](#provider-evidence)

## Run and audit

Build the plugin before launching a campaign. `campaign.py <output-directory> <trial-count> <root-workers>` allocates fresh homes and fixture directories; repeated invocations allocate new attempt directories. It uses the preserved medium-effort discovery settings as its template and a local recording proxy at port 4107. This fixture template and route make the runner deployment-specific. Use a new output directory for each campaign; aggregate files describe the latest invocation, while per-attempt evidence is retained.

The runner supplies the full tracing config because Cordis config patches replace the entire object. New trials use the stable `gh-training-live` project and metadata for experiment, task family, trial, and split. The initial 240-trial campaign's incomplete config used metadata-only capture in `gh-genai-traces`; its canonical sessions remain available for rich replay.

`prepare-audit.py <campaign-directory>` prepares an audit manifest and overlay. It identifies sessions from storage directory names without decoding them. When trials use independent stores, it copies their bytes into an audit store, preserving every generation. `audit-profile.ts`, loaded as an overlay by `pnpm dsh --profile headless`, reads each session through upstream `sessionQuery`, writes detached snapshots, and invokes the tracing backend's replay method. The audit manifest selects the sessions; it never launches recorded agents. All children need explicit inclusion, and a child without its own independent grade is excluded from training candidates.

## Admission and provenance

The `./curation` library validates complete final assistant answers, supported text/reasoning/tool blocks, tool definitions, JSON argument objects, unique tool-call IDs, call/result pairing, role placement, and loss weights. Earlier assistant messages have weight zero. Final reasoning is retained in source evidence but omitted from the positive-loss target because the answer grader does not establish reasoning quality. Images and unsupported blocks fail closed.

Capture rejection is independent of task grading. Truncated, omitted, redacted, unserializable, incomplete, or privacy-unreviewed content cannot enter a candidate. A captured failing answer remains available for preference assessment but is excluded from SFT. Graders separately report syntax, semantics, tool trajectory, and environment outcome. A successful process exit cannot establish any of those outcomes.

Candidates retain canonical session/version/event identities, source and row hashes, normalized request/tool/config hashes, requested reasoning effort, task-family membership, configuration identity, and grader version. Missing checkpoint, tokenizer, and backend renderer evidence stays unknown. Parent/child relationships, task families, and identical requests form connected split groups; held-out membership takes priority over validation and training. Exact duplicate rows are retained as provenance references but excluded from the reported unique SFT yield.

## Preference sampling

`GH_FROZEN_SAMPLING=1` selects six deterministic problem instances with eight independent samples per instance in a 48-trial run. The explicit `frozen-profile` overlay supplies a complete text policy, no tools or runtime context, medium reasoning, temperature 0.9, and a 2,048-token output budget before upstream records each request. It disables repository-instruction and skill-catalog injection for this isolated text experiment. This is a narrower evaluation than the normal production-agent campaign.

The recording proxy verifies identical serialized provider bodies within each request group. The curation library also requires identical canonical reconstructed requests, including configuration and tools, before constructing a preference. Managed DPO admission additionally requires one user turn, no tools, distinct complete assistant outputs, and an independently passing/failing grade pair under one grader version. Same-task answers with different requests cannot form a pair.

The selected backend is [Fireworks managed SFT](https://docs.fireworks.ai/fine-tuning/fine-tuning-models) and [managed DPO](https://docs.fireworks.ai/fine-tuning/dpo-fine-tuning). Local schema tests cover a conservative subset. Fireworks model eligibility, minimum dataset size, registered renderer, thinking-history behavior, rendered token IDs, and loss masks still need backend verification. Two local preference pairs do not meet the documented three-example minimum. No paid training job was created.

## Reward environments

`GH_REWARD_RESET=1` repeats the write/read-back task with identical initial fixtures in fresh directories. Input hashes are recorded before inference, and output state is observed after the rollout. The `./reward` library provides private fixture allocation and an independent JSON/file-integrity reward. A correct final answer with a wrong file or modified input earns zero filesystem reward. Negative-control tests prove that a fresh reset does not inherit a prior answer file.

These are resettable rollout experiments and deterministic reward observations. They are not token-level RFT training data: sampled token IDs, aligned log probabilities, and a verified inference/training tokenizer relationship are absent. Retokenizing final text cannot recover that evidence.

## Provider evidence

The [recording proxy](../../../recproxy.py) caps actual forwarded requests, including auxiliary and child calls, with `REC_CONCURRENCY` (four for this deployment). Its records distinguish admission, queue wait, first response bytes, status, completion, and client-write failures. `REC_RESPONSE_BYTES` bounds the retained response excerpt. `metrics.py` performs read-only engine scrapes; sampled running/waiting peaks are lower bounds, and engine counters can include other consumers.

`phoenix-export.py` paginates span exports and reports separate execution-root and conversation-model latency distributions. Replay model latency is recorded-chunk time, not inference dispatch latency. Auxiliary calls remain purpose-labelled. Standalone setup-event spans are disabled by default; canonical records remain authoritative for omitted event presentation.
