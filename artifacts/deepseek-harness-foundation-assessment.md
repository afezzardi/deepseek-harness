# DeepSeek Harness foundation assessment

Date: 2026-08-20. Checkout `0.1.0-rc.8`.

> **Status: reduced to what only this document holds.** Read
> [the consolidated assessment](deepseek-harness-consolidated-assessment.md) first — it is the decision
> layer over this one.
>
> **Authoritative here:** the benchmark matrix and its Pareto analysis; the pi-ai settings-layer risk
> register; and the criteria for when a custom adapter is justified.
>
> **Spent and removed 2026-08-21.** The four-phase evaluation plan — Phase 2 was executed as the E2
> regression gate and Phase 3 as the prefix-caching and saturation work; results and the queue that
> replaced the plan are in [NEXT-SESSION.md](NEXT-SESSION.md). Do not restart it from here. The
> endpoint-qualification checklist now exists as `probes/`, and the candidate `settings.yaml` as the
> live `dsh-settings.yaml`, whose comments carry the corrected wire-level rationale for every field.
>
> **Superseded and removed.** The system map, composition narrative, capability-modularity discussion,
> turn/tool/persistence lifecycle, investment scorecard, and source trail — rewritten in the
> consolidated assessment, which also corrects four claims made here: 233 workspace packages is 226
> (C7); a turn is zero or more steps, not one or more (C8); `docs/capability-seams.md` is a
> hand-maintained catalog rendered by a generator, not a source-derived graph (C10); and the
> `llm-pi-ai` recommendation omitted that the owning architecture note reserves retiring one of the two
> twin adapters (C9).

## Benchmark interpretation

The supplied matrix, preserved exactly as reported. The dagger annotations are reproduced but not
interpreted, because their definition was never supplied.

| Cell | GSM8K | IFEval | GPQA Diamond | MMLU Pro | HumanEval Chat | Mean | Wall clock |
|---|---:|---:|---:|---:|---:|---:|---:|
| nvfp4/off | 96.7 ±1.6 | 82.5 ±3.5 | 76.7 ±3.9 | 76.2 ±2.9 | 94.2 ±2.1 | 85.2 | 19 min |
| nvfp4/low | 97.5 ±1.4 | 89.2 ±2.8 | 75.8 ±3.9 | 81.0 ±2.7 | 98.3 ±1.2 | 88.4 | 30 min |
| nvfp4/medium | 97.5 ±1.4 | 90.8 ±2.6 | 74.2 ±4.0 | 78.6 ±2.7 | 97.5 ±1.4 | 87.7 | 37 min |
| nvfp4/xhigh | 98.3 ±1.2 | 94.2 ±2.1 | 70.0 ±4.2 †18% | 80.0 ±2.7 | 96.7 ±1.6 | 87.8 | 83 min |
| fp8/off | 96.7 ±1.6 | 85.0 ±3.3 | 81.7 ±3.5 | 78.1 ±2.8 | 96.7 ±1.6 | 87.6 | 23 min |
| fp8/low | 98.3 ±1.2 | 88.3 ±2.9 | 75.0 ±4.0 | 80.0 ±2.7 | 98.3 ±1.2 | 88.0 | 52 min |
| fp8/medium | 99.2 ±0.8 | 91.7 ±2.5 | 76.7 ±3.9 | 80.5 ±2.7 | 100.0 ±0.0 | 89.6 | 40 min |
| fp8/xhigh | 99.2 ±0.8 | 95.0 ±2.0 | 67.5 ±4.3 †17% | 77.6 ±2.8 | 95.8 ±1.8 | 87.0 | 104 min |

The point-estimate Pareto frontier for mean score against wall time is `nvfp4/off` (19 min, 85.2),
`fp8/off` (23 min, 87.6), `nvfp4/low` (30 min, 88.4), and `fp8/medium` (40 min, 89.6). Every other cell
has both a lower mean and a longer wall time than at least one of these.

`fp8/medium` is the best general default: highest mean, tied-best GSM8K, best HumanEval, and faster than
the reported `fp8/low`. It adds 2.0 mean points over `fp8/off` for 17 minutes, and 1.2 over `nvfp4/low`
for 10 minutes.

`fp8/off` is the best latency-oriented quality route and holds the highest GPQA point estimate. That
result argues against assuming more reasoning is always better: GPQA falls from 81.7 at `fp8/off` to
67.5 at `fp8/xhigh` while wall time rises from 23 to 104 minutes. `xhigh` improves IFEval, but its mean
and latency rule it out as a default; keep it an explicit opt-in for tasks whose measured objective
rewards it.

**The intervals overlap for several cells**, so these point-estimate differences are not statistically
significant without the sample design and paired results, neither of which was supplied. Treat
`fp8/medium` over `fp8/off` as a starting default: the 2.0-point margin sits inside the reported
per-benchmark intervals of ±0.8 to ±4.3.

## The pi-ai settings layer: risks that bite when editing a route

- A user patch replaces the **complete** config of the targeted row. Omitting an old field removes it.
- Provider dictionaries merge by key, and there is **no delete operation** for a nested dictionary key.
- Arrays replace wholesale. A configured `models` list replaces the inherited route catalog, so a
  hand-declared route must supply a non-empty list.
- `contextWindow` and `maxTokens` are configuration **claims**, not facts discoverable from most
  OpenAI-compatible model listings. Wrong values break compaction or request admission.
- A modality declaration is never verified against the endpoint. Over-claiming image support can
  durably admit an image and leave the session unable to proceed on a text-only route.
- The generic adapter is intentionally dependency-heavy and inherits pi-ai protocol behavior, so pin
  the exact version and regression-test it. Provider HTTP status is not consistently available through
  its error events, which limits failure diagnostics and routing precision.
- Pre-release persistence formats reject old data rather than promise compatibility. Preserve
  evaluation sessions with the exact checkout and configuration that created them.
- Architectural separation is not proof of enforcement. A foundation decision still needs its own
  review of process confinement, credential flows, remote content, tool approvals, and Web/ACP
  exposure.

## When a custom adapter is justified

Create a dedicated `llm-vllm-qwen` adapter **only** if a captured incompatibility cannot be expressed by
`llm-pi-ai` configuration: a nonstandard SSE event structure, effort control not representable by
`thinkingFormat` plus `chatTemplateKwargs`, unsupported replay fields required for correct multi-turn
reasoning, incorrect tool-call parsing, or missing failure metadata that materially affects policy.

A new adapter is **not** justified to rename a provider, set defaults, or call a private endpoint —
those are configuration. If one becomes necessary, use `llm-deepseek` as the direct HTTP/SSE reference
and expect to own the full stream, catalog, exact-model, reasoning, retry, cancellation, attribution,
replay, documentation, unit, real-composition, snapshot, and real-provider obligations in
[the adapter cookbook](../docs/cookbook/adding-an-llm-adapter.md).

This deployment settled the question by configuration: the route runs on `llm-pi-ai` with a
`chat-template` thinking format against the raw `/engine/v1` surface. The one genuine expressiveness gap
found is sampling — pi-ai writes only `temperature` and has no `top_p`, `top_k`, `min_p`,
`presence_penalty` or `repetition_penalty` — and it is solved at the gateway rather than by an adapter
(NEXT-SESSION.md E5).
