# Agent Note: Gruppo Happy GenAI tracing

Status: implemented

## Decision

The fork owns an opt-in telemetry backend under `artifacts/`. Upstream owns canonical session generations, capture lifecycle, surface/header reconstruction, and token-usage folds. Phoenix owns trace presentation, annotations, datasets, and experiments. This division keeps upstream merges independent of the local observability policy.

The plugin uses a local OTel provider with native GenAI attributes. Phoenix 20.8.0 performs the presentation conversion at ingestion. The GenAI convention is still developing; `gh.mapping.version = 1` identifies this implementation's mapping. No client-side OpenInference converter or global instrumentation provider is installed.

## Consequences

Live and replay data use separate projects and capture-origin labels. Live calls observe harness dispatch/iteration; replay has only recorded chunk timestamps and cannot claim original dispatch latency. Each public `llm.stream` call receives a span, including separate harness retry dispatches. Adapter-internal retry time remains inside that call. Event source identifiers survive content omission, and canonical logs remain authoritative for reconstruction.

The plugin retains bounded rich content, but redaction and truncation prevent treating every span as a lossless training example. The evaluation example retains request/tool definitions and trace provenance; it scores a recorded fixture observation, not unrestricted task success. Semantic recall, ATIF portability, and training dataset curation need their own acceptance criteria.

## Alternatives

Restoring the fork's V2-only parser would duplicate upstream's supported read path. Exporting only stock feedback-triggered OTel logs would omit ordinary live model-call spans. ATIF-only upload would not observe live request timing. A client-side GenAI-to-OpenInference converter would duplicate Phoenix's ingestion mapping. A second event store would create another durability and migration owner before a production dataset use case exists.

## Existing decisions

The scoped supersession check found no fork-local tracing decision to replace. Upstream's [telemetry capture decision](../../../.agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md) and [feedback-default rationale](../../../.agents/notes/implemented/feature/2026-08-25-feedback-gated-telemetry-default.md) remain independently applicable to upstream services and shipped defaults. This note and all implementation files stay under `artifacts/` to honor the fork's isolation requirement.

## Evidence

[VALIDATION.md](VALIDATION.md) separates measured source behavior, the built headless profile, Phoenix ingestion, synthetic evaluation, and blocked deployment checks. The retired scripts remain recoverable from the pre-update Git history; historical results retain their original interpretation.
