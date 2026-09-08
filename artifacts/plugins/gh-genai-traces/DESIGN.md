# Agent Note: Gruppo Happy GenAI tracing

Status: implemented

## Decision

The fork owns an opt-in telemetry backend under `artifacts/`. Upstream owns canonical session generations, capture lifecycle, surface/header reconstruction, and token-usage folds. Phoenix owns trace presentation, annotations, datasets, and experiments. This division keeps upstream merges independent of the local observability policy.

The plugin uses a local OTel provider with native GenAI attributes. Phoenix 20.8.0 performs the presentation conversion at ingestion. The GenAI convention is still developing; `gh.mapping.version = 3` identifies this implementation's mapping. Step and workflow spans explicitly use OpenInference `CHAIN`; Phoenix converts native model/tool attributes. No global instrumentation provider is installed.

## Consequences

Live and replay data use separate projects and capture-origin labels. Live calls observe harness dispatch/iteration; replay has only recorded chunk timestamps and cannot claim original dispatch latency. Each public `llm.stream` call receives a span, including separate harness retry dispatches. Adapter-internal retry time remains inside that call. Event source identifiers survive content omission, and canonical logs remain authoritative for reconstruction.

The plugin retains bounded rich content, but redaction and truncation prevent treating every span as a lossless training example. The evaluation example retains request/tool definitions and trace provenance; it scores a recorded fixture observation, not unrestricted task success. Semantic recall, ATIF portability, and training dataset curation need their own acceptance criteria.

## Alternatives

Restoring the fork's V2-only parser would duplicate upstream's supported read path. Exporting only stock feedback-triggered OTel logs would omit ordinary live model-call spans. ATIF-only upload would not observe live request timing. A client-side GenAI-to-OpenInference converter would duplicate Phoenix's ingestion mapping. A second event store would create another durability and migration owner before a production dataset use case exists.

## Existing decisions

The scoped supersession check found no fork-local tracing decision to replace. Upstream's [telemetry capture decision](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md) and [feedback-default rationale](../../../.agents/notes/implemented/feature/2026-08-25-feedback-gated-telemetry-default.md) remain independently applicable to upstream services and shipped defaults. This note and all implementation files stay under `artifacts/` to honor the fork's isolation requirement.

## Evidence

[VALIDATION.md](VALIDATION.md) separates measured source behavior, the built headless profile, Phoenix ingestion, synthetic evaluation, and blocked deployment checks. The retired scripts remain recoverable from the pre-update Git history; historical results retain their original interpretation.

## Dataset discovery

The [real-workload discovery](../../results/trace-discovery-20260908/REPORT.md) keeps task scores separate from capture eligibility. Its dated candidate exporter trains only the final assistant target and masks earlier assistant messages: a successful task can contain an incorrect intermediate write. Preference candidates require identical complete request content, not merely the same task label. Long-input omission and credential redaction exclude a candidate even when the enclosing span is complete. These checks belong to dataset curation; the tracing backend remains an observer, and canonical sessions remain authoritative.

The existing tracing decision remains active. The discovery adds measured acceptance evidence without replacing its ownership, bounded-capture, or replay rationale; no active note is superseded.

## Recorded ownership and dataset admission

Workflow child roots share the owning workflow's deterministic parent context. Live mapping buffers child records until the parent's canonical membership arrives; a bounded overflow is counted, and unresolved membership remains explicit at disposal. Replay reads ancestor sessions before mapping a child, so importing a child before its parent does not change identities. Version 2 separates the changed trace-parent semantics from version 1 IDs. Setup records remain canonical but do not create zero-duration roots unless explicitly enabled.

Canonical workflow events omit the invoking tool-call ID. Guessing from timestamps, open-tool count, or arrival order would assign false ownership under concurrency. The workflow therefore stays under the step with this limitation recorded as an attribute. Independent background subagents retain session references rather than fabricated synchronous parentage.

Content completeness, actual privacy changes, and task success are separate facts. The curation library admits supported complete requests, selects final-answer losses through backend exporters, requires an independent final-answer grade for SFT, and reserves connected task/session groups before deduplication. Preference comparisons require identical requests, including tools and sampling configuration; the managed-DPO subset rejects tool trajectories. Renderer approval and exact-token RL remain separate acceptance conditions.

The [implementation experiment](../../results/trace-curation-20260908/REPORT.md) records wire-level concurrency, resettable fixtures, rejected candidates, and canonical/live/replay comparisons. This extends the existing note; no other active artifact note is superseded.

## Version-3 dataset pipeline

Phoenix owns immutable published dataset versions, native splits, annotations, and experiments. Canonical DSH sessions remain the reconstruction source; local files are source evidence, resumable stage checkpoints, or tested database/source backups. A second local split ledger would introduce a competing dataset owner. Version metadata freezes native split membership, and conflicts quarantine affected groups instead of relabelling promoted examples.

Replay and curation share upstream live-session/persistence reads and restore validation. Stored generations are never decoded or rewritten by artifact code. Reconstruction retains inherited offsets and in-memory interruption-repair identities. Mapping v3 hashes destination project, origin, and canonical source identity; owned workflow children share their root's presentation session and retain their own canonical IDs.

The backend-neutral candidate v2 separates four-state task observations, execution status, exact privacy-review hashes, and explicit loss selection. Human-intervention trajectories remain evidence but cannot promote under the current policy. Final-answer supervision is a format objective; ungraded reasoning is retained in source evidence and omitted from its target. This does not establish suitability for the production thinking route. Exporters reject masks they cannot represent.

Per-session source/task/grader/configuration checkpoints survive independent telemetry and backend failures. Operational failures remain retryable, and final files replace atomically. Fireworks managed SFT/DPO remain explicit destinations alongside local Qwen reference rendering. No tokenizer-reference result, schema check, or Phoenix publication implies renderer approval or training readiness. The [checkpoint report](../../results/trace-pipeline-v3/REPORT.md) owns measured acceptance and unfinished work.
