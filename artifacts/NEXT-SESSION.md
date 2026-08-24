# Next session: state, queue, and traps

State at handoff: branch `fork/qwen38-deployment`, rebased onto `upstream/master` at `b150a551b8` —
the `release/dsh-0.1.1-rc.2` merge, upstream PR #2908. `master` is a pristine mirror of
`upstream/master` (0 ahead, 0 behind); every fork commit is inside `artifacts/`. **Upstream published
nothing newer as of 2026-08-24**: `b150a551b8` is simultaneously `refs/heads/master` and tag
`dsh-v0.1.1-rc.2`, and `master` is the only head the remote exposes. What rc.2 changed for us is in
[the rc.2 section](#what-upstream-011-rc2-changed-for-this-deployment) below. The two
capped-auxiliary-call defects (session titling, compaction summarization) are fixed in `~/.dsh`, and
both fixes are wire-proven and carried in the `dsh-cordis.patch.yml` comments.

**The inference record is the authority on everything engine-side, and this file no longer restates
it.** `kb-mastra-infra/docs/TUNING.md` owns block accounting, prefix-cache geometry, fp8, the shape,
and — in its §6 — the single retraction ledger for both sessions.
`kb-mastra-infra/MESSAGE.md` is the exchange, restructured to a strict question/reply schema on
2026-08-21: **re-read it from the top, do not diff it.** Round 8 (theirs) answered Q17; round 9 (ours)
filed the head-composition correction as Q18 and they answered it the same day. **Every Q1-Q18 is
ANSWERED and nothing is open on either side.** Our handover artifacts are on the host at
`kb-mastra-infra/artifacts/from-harness/`.

## Resume here

**The live activity is the UAT. The user executes [UAT.md](UAT.md); we analyse.** Everything
engine-side is closed and stays closed — do not reopen inference tuning, and do not propose new
measurement of that stack. Their own owner declined further work there on scope grounds, and by both
sessions' arithmetic our traffic uses ~36 s of prefill per day.

**Session 1 (blocks B0-B4) ran on 2026-08-21** — analysis in
[results/uat-20260821/analysis.md](results/uat-20260821/analysis.md). **Session 2 ran partially on
2026-08-23, on the rc.2 rebase**: B5 (delegation) and B6 (interruption and resume) only, analysis in
[results/uat-20260823/analysis.md](results/uat-20260823/analysis.md). Verdicts for both sittings are
in UAT.md's results tables.

**D7 is still unfixed, and session 2 did not expose it**: no summarizing compaction fired anywhere in
the sitting — 0 compactions across nine sessions, max prompt 45,368 against a 104,857 threshold. So
B5 and B6 are sound as recorded, and **B4.1 is still owed a re-run once D7 is fixed**. Blocks that
never touch compaction can run before the fix; B4 cannot.

**Session 3 ran on 2026-08-24**: block B8 (vision), after enabling images — analysis in
[results/uat-20260824/analysis.md](results/uat-20260824/analysis.md).

**Outstanding: B7.1** (real work — the last substantive case), **B3.3** (never attempted in three
sittings), **B3.5** (the rc.2 permission revert) and **B8.4**. Across three sittings: 28 of 31 cases
attempted, **20 PASS, 7 PASS-WITH-NOTE, 1 FAIL, 2 NOT RUN**. See UAT.md.

**When the user reports a sitting is done:**

1. Decode every session from the sitting and fold it with `harness-tests/metrics.mts`.
2. Run `harness-tests/check.sh` for **B1.4, B3.1, B3.2 and B4.1** rather than trusting the recorded
   verdict: each of those four is marked PASS from a screen that looks identical when the thing under
   test never ran. It prints one PASS/FAIL line per criterion and exits with the verdict.
3. Align the engine sampler series (`artifacts/results/engine-metrics-*.jsonl`) to session times.
4. Write the analysis to `artifacts/results/uat-<date>/` and the cycle-2 recommendation.

### D7 — in the web profile the compaction summarizer runs on the THINKING route

Found by B4.1 on 2026-08-21; mechanism, evidence and fix path in
[results/uat-20260821/analysis.md](results/uat-20260821/analysis.md). In short: `web-app` disables
host-plane `compaction-basic` because the backend moves to the per-session preset, the shipped preset
mounts it with no config, and `~/.dsh/cordis.patch.yml` patches the disabled host row — so
`summarizeWithLlm` falls back to the session's own thinking route at the default 8,192-token cap.
**D1b is fixed in headless and unfixed in web**, and the fail-closed throw is live there. The fields
belong in a user preset under `<dshHome>/.agent-presets`, not in the home patch.

The same mismatch silently drops `thresholdRatio: 0.8` in web, which is harmless only because 0.8 is
already `DEFAULT_THRESHOLD_RATIO`. **Check every other home-patch entry against
`dsh --profile web --dump-config` for the same shape** before assuming it applies.

Confirmed still unfixed at rc.2: `packages/compaction` and `packages/preset` took **version bumps
only** across `528c682e06..b150a551b8`, so the defect stands exactly as described.

#### The fix is a 252-line preset copy, which is why it is still open

Read out of the mechanism on 2026-08-24, and it is more expensive than "put the fields in a user
preset" suggests:

- `web-app/cordis.patch.yml` disables host-plane `compaction-basic` and inserts `agent-presets` with
  **`default: standard`**.
- The shipped `standard` preset mounts `compaction-basic` with **no config** — 252 lines, and there is
  **no include or extend mechanism** for a composition.
- **A user preset cannot shadow a shipped id.** `agent-presets` appends the harness-home root *after*
  every configured root and an earlier root wins a duplicate id, so a hand-written
  `~/.dsh/.agent-presets/standard/` loses to the shipped one.
- **The home patch cannot reach preset rows.** Preset compositions load through `Include` in
  `agent-presets/src/mount.ts` with no `applyEntryPatches`, so `~/.dsh/cordis.patch.yml` cannot touch
  the preset's `compaction-basic` row.

So the only route is: copy all 252 lines to `~/.dsh/.agent-presets/<id>/agent.cordis.yml`, add
`thresholdRatio: 0.8` / `summarizationProvider: local-qwen-off` / `summarizationModel: chat-model` to
its `compaction-basic` row, and patch `agent-presets.default` to that id. **That copy silently drifts
from the shipped preset on every upstream sync**, which is the same hazard as editing an upstream
example.

Weigh it against the exposure, which is small and measured: compaction has fired **0** times in 23
recorded sessions, the observed maximum prompt is 45,368 against a 104,857 threshold, and the
tool-result pruner keeps interactive sessions under it on its own (UAT B4.3: five `compaction/prune`
events, 101,202 → 72,636 tokens, no model call). The defect is a **fail-closed throw at the worst
moment** if a session ever does reach the threshold — real, but not yet reachable by our traffic.
**This is a judgement call for the deployment owner, not a mechanical fix**, and it is why queue
item 1 is a decision rather than an edit.

## What upstream 0.1.1-rc.2 changed for this deployment

35 commits, 431 files. **It is almost entirely one feature — the unified image/attachment request
pipeline — plus one revert.** Nothing in it targets a defect we filed, and nothing in it breaks the
deployment.

**That feature is directly relevant to us, which is not how it first read.** The model behind
`chat-model` is image-capable (measured; see below), so rc.2 hardened a path we should be using rather
than one we can ignore. The things that reach us:

| Change | Reaches us how | Action |
|---|---|---|
| Unified image request pipeline: validation, deterministic downscaling, normalized stored encoding | **Bounds the token cost of an image**, which is what makes enabling `read_image` safe at our ceiling | Enable images; run UAT B8 |
| `read_image` description grew **+263 B** (`docs/tool-catalog.md`; args schema unchanged) | One of our 25 wire-mounted tools, so it sits in the **shared prefix** | Re-measure the head; estimate below |
| `LlmAdapter.prepareCall()` added, overridden by pi-ai at `adapter.ts:310` | **Our route.** Binds model metadata and the stream entry point to one adapter generation | None — a robustness fix in our favour |
| `permission/preset` event lost its `origin` field; `refreshDefaultForReuse()` removed (revert of #2608 via #2903) | Web **blank-session reuse** no longer picks up a changed default preset | New UAT case B3.5 |
| pi-ai profile gained `requestImagePixelBudget` / `requestImageMaxBytes` | The per-request image budgets on **our adapter** | Leave at default until B8 gives a baseline |
| `read_image` reports downscaled dimensions and a coordinate scale | Tells the model the geometry it is actually looking at | Covered by B8 |

**Verified inert for us**, each by diffing the package rather than by assuming: `packages/sandbox`,
`packages/compaction`, `packages/preset` and `packages/session` are **version bumps only** — so D6 and
D7 both survive unchanged, `SESSION_FORMAT_VERSION` did not move, and `metrics.mts`,
`check-case.mts` and `read-session-log.mts` need no update. The `origin` field our logs from
2026-08-21 carry and our 2026-08-23 logs do not is read by **none** of our instruments. The three
fixes at the head of the range (`fix(deepseek): decouple files and stream timeouts`,
`fix(llm-deepseek): fall back when Files resolution fails`, `fix(attachment): accept opaque WebP alpha
omission`) touch `llm-deepseek` and `attachment-local` only — **not our route**, which is pi-ai.

`read_image_region` appears in the range as both added and removed; it **never existed in a release
tag**, so our tool-set membership is unchanged at 25.

### The prefix grew by about 64 tokens, and the regime did not change

Priced from the recorded wire bodies in `results/e2-gate-wire-20260821.jsonl`, whose 25 schemas total
27,324 B — identical to the head-composition artifact, which is what makes the ratio usable:

| | rc.1 | rc.2 |
|---|---|---|
| `read_image` schema | 354 B ≈ 86 tokens | 617 B ≈ **~149 tokens** |
| shared cross-session prefix | **7,455** | **~7,519** |

**This is an estimate by byte ratio, not a tokenizer reading** — the distinction that produced four
retractions in `TUNING.md` §6. Re-run `probes/probe_head_composition.py` against a fresh
`recproxy.py` log and persist to `results/` before quoting either number.

Two consequences, and neither is a problem. **~7,519 is still below the 7,840 stride**, so the shipped
regime is unchanged: budget two cold requests per distinct prefix (`TUNING.md` §6 row 22). And the
change **invalidated the cached prefix exactly once**, when the rebase landed — which has already
happened, since the 2026-08-23 sitting ran on rc.2.

### `read_image` is disabled capability, not dead weight — the model sees images

**Measured 2026-08-24, `results/image-capability-20260824.txt`, via `probes/probe_image.py`.
Qwen3.8-27B accepts and correctly understands images on `/engine/v1`, the surface both of our routes
use.** Three solid-colour images were identified correctly (red, blue, green), and the real
`qr-code.png` fixture was described accurately. **It works in thinking mode too** — the exact
`enable_thinking: true` + `reasoning_effort: medium` our main `local-qwen` route sends.

The no-image control is what makes this a measurement rather than a plausible caption: identical text
with no image returns **23 prompt tokens and "I cannot see the image."**, against 89 tokens with one.

| Image | prompt tokens | image cost |
|---|---|---|
| none (control) | 23 | — |
| 64×64, 128×128, 256×256 | 89 | **66** |
| 512×512 | 281 | **258** |
| 1024×1024 | 1,049 | **1,026** |

Cost is flat to 256 px and then scales with tile area, roughly 4× per doubling of the edge. Against
the 114,688-token usable ceiling a 1024² screenshot is ~0.9% — cheap enough to ignore, and rc.2's
downscaling is why it stops there rather than growing with the file.

**So the refusal was ours, not the engine's.** Neither route declared `input`, so `read-image.ts:97`
refused locally with `model "chat-model" does not declare image input` and never issued a request.
Across the 23 sessions recorded before 2026-08-24 `read_image` was never invoked once — because it
could not succeed, not because nobody wanted it.

**Retracted: the purge recommendation.** An earlier version of this section called `read_image` the
clearest purge candidate on the grounds that it "can never execute here". That was reasoned from our
own config and never checked against the endpoint — the exact failure mode `TUNING.md` §6 exists to
record, and the one `deepseek-harness-foundation-assessment.md` warns about in its mirror image
("a modality declaration is never verified against the endpoint"). The ~149 tokens buy working
capability. **Do not purge it.**

### Images are now enabled, and the whole chain is proven

**Applied 2026-08-24** to both routes in `dsh-settings.yaml` and the live `~/.dsh/settings.yaml`:

```yaml
models:
  - id: chat-model
    input: [text, image]
```

**Verified end to end through the harness, not just against the endpoint**, and then exercised as UAT
block B8 the same day — full analysis in [results/uat-20260824/](results/uat-20260824/analysis.md).
B8.1 passes on both surfaces, B8.2 and B8.3 pass with notes, B8.4 is unrun. That closes the one link
`probe_image.py` could not reach: **pi-ai's `toPiContext` produces a wire format the engine accepts.**

**The token cost is cross-confirmed by two independent methods**, which is why no re-measurement is
queued. The probe priced bare images against the endpoint; the session fold prices the same images
through the whole product, as the step-to-step prompt delta:

| Image | probe (bare) | harness (incl. tool-result wrapper) |
|---|---|---|
| 256×256 QR | 66 | **291** and **280**, two runs |
| 1184×1084 screenshot | ~1,250 interpolated | **1,382** |

The ~215-token constant is the `<path>/<type>/<content>` wrapper plus the tool call, stable across both
sizes. **A full screenshot is ~1.2% of the usable ceiling.** Images are cheap here.

Two findings from B8, neither in the image pipeline. `read_image` now reports geometry inline
(`256x256 px, 30477 bytes`), new at rc.2, which is why no run needed a second call for dimensions. And
**an attached image has no path**: asking for `read_image` on a composer attachment sends the model
guessing at `/tmp/<sha>` and costs 172 s and 1,697 output tokens before it recovers from context,
against 4.5 s by path. Nothing tells it the attachment is already visible. Upstream's to fix; ours to
avoid — **do not ask for `read_image` on something you attached.**

**The field is `input`, not `inputModalities`.** That cost a full round trip: `inputModalities` is
`llm-deepseek`'s catalog key, pi-ai reads `entry.input`
(`llm-pi-ai/src/catalog.ts:874`), and **the wrong key is dropped in silence** — no load error, just
`read_image` continuing to refuse with a message that blames the model. Worth knowing what the first
run did with the refusal, because it is the behaviour B8.4 exists to reward: it decoded the PNG bytes
in bash, rendered an ASCII preview, reported 256×256 correctly, and flagged that it could not decode
the payload. Right answer, honest caveat, wrong tool.

### The extractor's timings are the projection's, and one recorded file predates that

The six defects a Codex review found in `metrics.mts` at `beb50dc720` are fixed (2026-08-21). The fold
now takes its timing definitions from `sessionStats`
(`packages/session/session-stats/src/projection.ts`) rather than approximating them, expands packed
chunk rows through the product's own `decodeStorageRecord`, counts one compaction per
`compaction/end`, clamps every duration at zero, and reports unparseable lines and undecodable
sessions instead of dropping them. Verified: the E2 golden session reproduces every non-timing field
exactly, and the 4-token session that reported **zero** TTFT now reports 2,546 ms.

**`results/uat-baseline/all-sessions-backfill.jsonl` was written by the old fold.** Its token, tool,
step and outcome columns are sound; its `ttftMs`/`decodeMs` are not — re-derive rather than quote. It
also holds 15 of the 16 sessions that existed when it ran, with no record of why the sixteenth
(`b52f40b9`, the E2 golden) is absent, which is the selection bias defect 6 named.

Two limits that remain, both in the extractor's own header: the TTFT/decode split is meaningless on a
run recorded through `recproxy.py`, which forwards 4 KiB reads rather than SSE events and collapses
every gap to 0-1 ms; and the proxy-vs-direct comparison behind that warning is **n=1 per arm**, enough
to establish that the proxy destroys the split and not enough to publish a decode rate.

### Still open on the inference side, and neither needs us

| Pending | Whose | State |
|---|---|---|
| **Q10** — fp8 KV re-price at our shape | theirs | Nothing for us to change either way. Re-run E2 afterwards to confirm the route still behaves |
| **Q3** — pushback on making the warm TTFT series the headline | theirs, open to us | Consciously left unanswered. Only worth a reply if we start caring about published TTFT medians |

Q1-Q18 are all ANSWERED. Two standing rules, both of which produced retractions: **hand them numbers,
not derivations**, and **measure a contributor, never fit it** — the 13,253 head was a least-squares
intercept, which describes a total and is silent about composition.

## Claims this file published and that are now dead

From `TUNING.md` §6. **Do not reintroduce any of them.**

| Ours | Row | What is actually true |
|---|---|---|
| "The prompt head is **13,253 ± 8 tokens**", and the 12,544 / 94.6% / 90.7% figures built on it | their Q17 | An **intercept, not a tokenizer reading**. Measured: a 7,455-token shared prefix, then 5,822 constant tokens sitting *after* the varying task string. First-request reuse is 6,272; aggregate 86.1%. Composition table above |
| "Our head is a pure function of (checkout path, model name, mounted tool set)" | their Q17 | True of the 7,455-token prefix only. The 5,822 tokens after it track `AGENTS.md` **file content** and the **installed skill set**, neither of which is in that triple. They were never in the shared prefix, so nothing downstream changes — but do not describe them as invariant |
| "`--max-num-batched-tokens` **never enters** the retention path; retention is block-driven, never step-driven" | 14 | Backwards, and it reversed a *correct* model. Every prefill chunk is clipped to a block boundary and state is written at chunk ends, so the mamba checkpoint stride is `floor(max_num_batched_tokens / block_size) * block_size` = **7,840** as shipped. It governs the **first** request against a prefix only, which is why the flag is still a weak lever — for a different reason (row 20) |
| "`align` retains one snapshot per block per group, densely"; "≈12.4-12.8 pages/group"; `84 + 3x12 = 120` blocks/request | 15 | One **real** page is materialised per step and earlier slots are null-padded. A request holds ~**1-2 real** mamba blocks per group. The `12` was a back-fit from an observed overflow, never a retention measurement |
| "`VLLM_PREFIX_CACHE_RETENTION_INTERVAL=0` is the highest-value inference-layer experiment outstanding" | 16 | With ~1-2 real mamba blocks per request there is nearly nothing for sparse retention to remove. **Demoted from first to last** — to close the question, not to fix anything |
| Our reuse figures: 98.8%, 81.2%, 40.6%, 77-86% | 18 | **No artifact exists for any of them.** Confirmed here: every probe under `probes/` prints to stdout and persists nothing, so those numbers exist only as transcriptions into this file and cannot be reproduced as recorded. Their reproducible equivalents are 95.6% on a repeated 32,787-token prompt and 88.1% on a byte-identical 4-way replay |

Three lessons, all of which cost real time: read the implementation before publishing a mechanism;
**persist the output of any probe whose number you intend to quote** — a figure with no artifact is not
a measurement; and **do not let a fitted constant stand in for a measured one.**

Two of their answers close questions of ours outright: `max_tokens` is **not** a KV lever (their Q6),
and pool exhaustion **preempts, never 5xxes**, so `maxRetries: 0` is safe (their Q7). Only *admission*
returns 400, when `prompt + max_tokens > max_model_len`.

## The measured workload: 13-19k tokens, not 117-131k

**Headless only.** One interactive web session on 2026-08-21 reached p50 69,959 and max 101,202
prompt tokens over 19 turns, so the figures below describe the headless profile rather than the
product's ceiling exposure; the interactive numbers live in
[results/uat-20260821/analysis.md](results/uat-20260821/analysis.md).

All 14 sessions recorded **before the UAT**, decoded logs, 31 main-route requests + 14 titling calls.
The three sittings added fifteen more sessions, including the first child sessions this deployment has
produced and the first carrying images, so these figures are a headless baseline rather than the
current population — re-deriving them over all 29 is queue item 6:

| | mean | p50 | p95 | max |
|---|---|---|---|---|
| prompt tokens | 15,459 | 13,729 | 18,192 | 19,403 |
| output tokens (reasoning included) | 198 | 120 | 514 | 961 |

Steps per session: mean 2, max 8. Turns per session: **1** — headless runs one task per process.
Compaction has fired **0** times and cannot at these sizes. Peak simultaneous engine requests: **2**,
for 0.4-3.4 s at session start, where the auxiliary titling call overlaps main step 1.

### The head, measured on the wire rather than fitted

`artifacts/results/head-composition-20260821.json`, via `probes/probe_head_composition.py`. This
replaces the 13,253-token "head" — that figure was a **regression intercept**, so it described a
per-session total and said nothing about what was in it or where the reusable part ended.

**Measured at 0.1.1-rc.1.** rc.2 adds roughly 64 tokens to the tool schemas via `read_image`; the
table below is not re-measured, and the estimate and its caveat are in the rc.2 section above.

| Contributor | bytes | rendered tokens | |
|---|---|---|---|
| system prompt | 4,148 | 836 | shared |
| tool schemas (25) | 27,324 | 6,619 | shared |
| **shared cross-session prefix** | | **7,455** | |
| user task | 440 | 98 | **diverges** |
| workspace instructions (root `AGENTS.md`) | 16,374 | 3,748 | after divergence |
| runtime context snapshot | 481 | 98 | after divergence |
| skill catalog | 8,971 | 1,976 | after divergence |
| step-1 total | | 13,375 | |

**The reusable prefix ends at 7,455 tokens, not 13,253.** 5,822 tokens of content that is constant
across sessions is emitted *after* the per-session task string, so it re-prefills on every new
session. A new session's first request therefore reuses `floor(7455/1568)*1568 = 6,272`, not 12,544.
Tool schemas are **89% of everything cacheable** — the lever that matters is the tool set, not the
system prompt.

Still true, and now verified over all five contributors rather than the two we shipped in Q13: **no
volatile bytes** — no date, timestamp, session id or git state. Two claims got stronger:
**append-only is now wire-proven**, SHA-256 per message object, each request a strict prefix-extension
of the last, with `tools` and the system message byte-identical throughout; and `artifacts/AGENTS.md`
(7,146 B) is injected **lazily** on first touch of that directory, appended after a tool result, so it
does not break the prefix.

Aggregate reuse for the deepest recorded session is **86.1%** (138,361 submitted, 19,193 uncached),
not the 90.7% published here before. Their independent replay measured **85.0%**: the base difference
was theirs (a 6,392-token warm base), the constant was ours, and 1.1 points apart by independent
methods is now recorded in their §4 as the strongest cross-check on `floor(P / 1568) * 1568` either
session can produce.

**Both numbers above are cross-confirmed, not just ours.** Their independent pricing of the same bytes
came to 7,499 raw / **7,446** scaffold-adjusted against our 7,455, with tool schemas at **6,619 —
identical to the token**. Two methods, two sides, no shared code.

One consequence they took into their record: at 7,455 we sit **below the 7,840 stride**, which is the
regime where warm-up is one *or* two requests unpredictably (`TUNING.md` §6 row 22). For us that is the
**shipped case, not a corner case** — budget two cold requests per distinct prefix.

**So the saturation work models a workload we do not produce.** Our largest request ever needs
`ceil(20364/1568) + 6 = 19` blocks against the 90 a full-context request needs. Their Q17 reply settles
what follows: 4 is over-provisioned, so is everything else, and that is fine — over-provisioning costs
nothing here and re-tuning it costs a boot for no measurable win. Our recorded two days are ~36 s of
prefill per day.

## Config applied on our side (live `~/.dsh` in sync with `artifacts/`)

| Change | Was | Now | Why |
|---|---|---|---|
| `maxTokens`, both routes | 32768 | **16384** | Admission is `prompt + max_tokens <= max_model_len`, so this is subtracted from usable prompt: the ceiling rises 98,304 → **114,688** (their Q6). Largest output ever observed is 961 tokens, so 16384 is ~17x headroom |
| `compaction-basic.thresholdRatio` | 0.7 | **0.8** | Compaction fires at 104,857 under a 114,688 ceiling: margin **9,831**, against 6,554 before. `retainTokens` resolves to `floor(131072*0.16) = 20,971`, which the loader requires to be below the threshold |
| `workflow-worker-thread.maxConcurrentAgents` | 0 (derived 16) | **4** | Our own ceiling. Originally pinned to engine admission; their Q17 unpinned it. Above 4 needs an observed `vllm:num_requests_waiting`, not arithmetic |

Validated by `--dump-config` (81 rows) and by a **full E2 gate run under this exact pair**
(2026-08-21) — see E2 below. `max_tokens: 16384` confirmed on the wire, not just in config.

## Queue

| # | Item | Cost | Owner |
|---|---|---|---|
| 1 | **Run B7.1** — the real-work case. The last substantive gap, and the one that decides cycle 2 | user's time | **user** |
| 2 | **Decide D7** — the fix is a 252-line preset copy that drifts on every upstream sync, against an exposure of 0 compactions in 29 sessions. Copy it, or accept the defect and record that. Not a mechanical edit | a decision | **user** |
| 3 | Finish the tail of the suite — **B3.3**, **B3.5**, **B8.4** | user's time | user |
| 4 | **Re-measure the head on rc.2** — `probes/probe_head_composition.py` against a fresh `recproxy.py` log, persisted to `results/`. Replaces the ~7,519 estimate with a tokenizer reading | none | ours |
| 5 | Write the cycle-2 recommendation once B7.1 lands | none | ours |
| 6 | Re-derive the backfill's timing columns with the fixed extractor, over the full post-UAT session set (29 sessions now, not 14) | none | ours |
| 7 | **`metrics.mts` fails silently on a `.zstd` path** — prints nothing, exits 0. Its header names the decoded log as input, but silent success on wrong input is the false-pass shape this suite exists to catch. Make it report | none | ours |
| 8 | Two upstream issues worth filing: **an attached image has no path** and nothing tells the model it is already visible (172 s of path-guessing, B8.3); and **D6**, `/tmp` not shared between the fs tools and bash | none | ours |
| 9 | Their **Q10** fp8 re-price at our shape (p95 output 514, max 961, all below their 1,355 crossover) | 1 boot if taken | inference |
| 10 | **E5** — instruct alias; gateway restart only. Low value while nothing of ours uses instruct mode | none | inference |

Done 2026-08-24: the rc.2 delta analysis, **images enabled and verified** (`input: [text, image]`,
both routes), UAT block B8, and the E2 gate re-run under the new declaration.

Done 2026-08-23: UAT session 2 blocks B5 and B6, and the rebase onto rc.2. **Purge ledger A3 is
withdrawn as a candidate** — B5 exercised `subagent`, `workflow` and `skill` correctly at three-way
concurrency, so the ~1,800 tokens it would remove are working capability, not dead weight
([why](results/uat-20260823/analysis.md)).

E3 (compaction) and E4 (fan-out) are **superseded by the UAT**, which covers both from the surface a
user actually drives: B4 exercises compaction through `/compact` rather than a synthetic 100k task, and
B5 exercises delegation.

Done 2026-08-21: the E2 re-run under the new `maxTokens`/`thresholdRatio` pair (passed), and the head
composition measurement that replaced the intercept.

`--max-num-batched-tokens 3136` stays **declined**, and the corrected geometry strengthens rather than
weakens the case. Under the stride model they have since withdrawn (row 21), a 7,455-token prefix would
reuse **0** at the shipped stride and 6,272 at 3,136 — so the benefit is 6,272 tokens once per prefix
lifetime, not the 4,704 we told them, against a prefix that has not changed in 45 requests. The cost is
unchanged: ~60% fewer tokens per prefill step forever, and our warm prefills fit in one 8,192-token step
today. `VLLM_PREFIX_CACHE_RETENTION_INTERVAL` is last, per row 16.

**Declined by both sessions, recorded so it is not rediscovered as new.** 5,822 tokens of
per-session-constant content sit after the varying task string, so they re-prefill every session.
Emitted *before* the task they would extend the shared prefix to ~13,277 tokens and lift first-request
reuse from 6,272 to 12,544, which also moves us from just under the 7,840 stride to just over it. Their
pricing, which supersedes our first estimate: **~0.93 s off first-turn TTFT, ~6.5 s/day at 7
sessions/day, ~40 min/year.**

Two counterweights, the second theirs and the one we had missed. It is a one-line ordering change rather
than a boot, so the cost side is unusually low, and it is **user-perceptible at session start** in a way
a throughput number is not. Against that: **moving the task string after 5,822 tokens of workspace
instructions changes what the model reads last**, which is an instruction-following risk neither session
can price, and not one to accept blind for 40 minutes a year. Their recommendation, which we adopt: **do
it only if already touching that assembly code.** We are not, so it stays undone and this is not an open
thread.

The general rule generalised past us and is now consumer guidance in their `HOW-TO.md` caveat 3 —
`system → tools → remaining constant context → the variable part last`. Read it there.

Still genuinely open and ours to answer: whether `preserve_thinking: true` wins in interactive
multi-turn use (below), and whether the nvfp4 arm meets its own `>= 6` boot gate (theirs, unverified
since 2026-08-20).

```sh
cd /home/andrea/management/deepseek-harness
set -a && . ./.env && set +a          # LITELLM_MASTER_KEY
ssh afezzardi@100.108.76.12 hostname  # NOT the ~/.ssh/config alias; that IP is the reachable one
```

---

## E2 — the deployment regression gate

```sh
pnpm dsh --profile headless "Read artifacts/README.md and report its first heading. \
  Then try to read artifacts/does-not-exist.md and report exactly what happened. \
  Then write the single line OK to the absolute path /home/andrea/dsh-gate-approval.txt and report \
  exactly what happened, including any error text verbatim. Do not retry with a different path and \
  do not attempt any sandbox escalation. \
  Finally run 'git rev-parse --short HEAD' and report the commit."
```

Verify from the **decoded** session log, never stdout:

```sh
node --import tsx/esm artifacts/read-session-log.mts \
  "$(ls -t ~/.dsh/sessions/*/session-*/session.jsonl.zstd | head -1)" /tmp/s.jsonl
```

Required: `turn/end {kind: completed}`; `request/header` carrying the expected route; the failing read
yielding a stable `error: {name: "FsError", code: "FS_NOT_FOUND"}` that the model recovers from rather
than aborting the turn; the out-of-workspace write denied with `FS_SANDBOX_DENIED` and **no file
created**; and a later step consuming earlier results.

**Passed on 0.1.1-rc.2 with images enabled (2026-08-24, `a755bef631`).** Run after adding
`input: [text, image]` to both routes, to confirm the modality change altered nothing else. From the
decoded log: `turn/end {kind: completed}`, 2 steps, the failing read yielding `FS_NOT_FOUND` and
recovered from, the out-of-workspace write refused with `FS_SANDBOX_DENIED` and **no file created**,
and a later step consuming earlier results. Route unchanged:
`provider: local-qwen, model: chat-model, maxTokens: 16384, reasoningEffort: medium`.

**Passed on the aligned 0.1.1-rc.1 revision, and passed again under `maxTokens: 16384` /
`thresholdRatio: 0.8` (2026-08-21, `61ff124e62`).** All five criteria met on the second run; wire
bodies in `results/e2-gate-wire-20260821.jsonl`. Route confirmed on the way past:
`provider: local-qwen, model: chat-model, maxTokens: 16384, reasoningEffort: medium`, and
`max_tokens: 16384` verified on the wire rather than only in config. D1 is confirmed fixed end to end,
not just by route: `session/title-llm-request` carries `route: {provider: local-qwen-off}` and the
resulting `session/title` has `source: {kind: provider}`. The earlier `{kind: fallback}` title is the
optimistic one written before the call, and is expected.

**Why the gate targets a path outside `/tmp`.** The original version wrote to `/tmp/dsh-gate.txt` and
could not test its own approval criterion: `workspace-write` grants `/tmp` by design
(`packages/sandbox/sandbox/src/roots.ts:54` returns `[workspaceRoot, '/tmp', tmpdir()]`), so a `/tmp`
write raises no approval and asserts nothing.

**The full write → approval → decision chain is proven** by a variant that permits the escalation
retry: step 1 denies as above; step 2 re-sends the identical write carrying
`sandbox_permissions: "danger-full-access"`, which produces `approval/asked` → `approval/decided
{outcome: "unavailable"}` → `Error: sandbox escalation ... requires approval, but no approval channel
is available`. Headless has no approval channel, so `ask` resolves `unavailable` and fails closed.
**One asymmetry when asserting:** the denial carries a structured `error: {name, code}`, but the
escalation refusal carries `error: null` — the reason exists only as model-visible prose. Assert the
`approval/decided` event for that step, not an error code.

### D6 — `/tmp` is not a shared channel between the fs tools and bash on Linux

`packages/sandbox/sandbox-local/src/profiles.ts:19` mounts `--tmpfs /tmp` for the bwrap dialect — a
fresh empty tmpfs — while the in-process fs fence derives its allow-list from `writableRoots` and so
grants the **real** `/tmp`. The two planes disagree about the same declared grant. This deployment
selects bwrap (0.9.0; the Landlock native addon is not installed), and the Landlock dialect would not
have the problem, since `profiles.ts:33` grants the real `/tmp` read-write.

This is a **known per-runner difference, not a contradiction**: `roots.ts:5-11` says so and even names
the direction it guards ("so 'the write tool cannot write /tmp but bash can' asymmetries cannot
arise"). D6 is the **inverse** direction, which that guarantee does not cover, and `local.spec.ts:72`
pins the bwrap argv rather than cross-runner observable behavior. **Still present at 0.1.1-rc.2** —
`packages/sandbox` took version bumps only across the rc.1→rc.2 range, so the `--unshare-pid` addition
noted at rc.1 remains upstream's only change here.

**Consequence: `/tmp` is unusable as a handoff between the fs tools and bash on Linux.** Stage such
files inside the workspace. Worth an upstream issue; not worth a fork patch.

Also observed, recorded rather than acted on: **a bash timeout is not flagged as an error to the
model** — a `find /` that timed out returned `isError: false` with only the text `[timed out after
60000ms] [killed by signal: SIGTERM]`.

### `test:snapshot` cannot target `local-qwen`, and recording one would prove nothing

Settled by reading the harness. **Replay — the keyless default — never contacts a provider**, so there
is no route to point anywhere: `resolveConfigPath` (`packages/boot/app-boot/src/index.ts:61-68`)
rewrites the config basename to `cordis.snapshot.yml` only when `$DSH_SNAPSHOT === 'replay'`; those
overlays disable the real adapter and insert `llm-replay`, which serves every call from the recorded
log, as a catch-all `ctx.on('llm/stream', …)` waterfall when no `providers` are configured
(`packages/test-support/llm-replay/src/index.ts:781-784`).

Two facts make targeting the local route impossible rather than merely awkward: **record mode boots the
live `cordis.yml`**, which hardcodes `deepseek-official`, so pointing it at `local-qwen` means editing
an upstream example that conflicts on every sync; and **every snapshot runner isolates `$DSH_HOME` into
a generated temp dir** (`acp-snapshot/src/harness.ts:255`, `loader-smoke/src/index.ts:185`), so our
`~/.dsh/settings.yaml` — the only place `local-qwen` exists — is unreadable by design, in record mode
as well as replay.

So a committed fixture would change only the replayed chunk *content*; the replay run would execute
zero deployment code while *looking* like deployment coverage. The deployment gate is the E2 command
above, run by hand.

### `preserve_thinking` stays `false`

- **It is a no-op in headless.** `chat_template.jinja:116` keeps a turn's `<think>` when
  `loop.index0 > ns.last_query_index`, and `last_query_index` (lines 88-97) is the last *real* user
  message — `<tool_response>` content and `tool`-role messages never advance it. With one user turn
  every assistant turn is after it. Confirmed via `/tokenize`: one user turn renders **75 tokens either
  way**; a second user turn makes it 84 (`true`) vs 76 (`false`). This is why our headless traffic is
  append-only on the wire, which is what we told them in Q11.
- **Interactively it is a real trade.** `false` retroactively strips thinking from turns at or before
  the new last user query, rewriting history and voiding the shared prefix from the first stripped turn
  on. `true` keeps the prefix append-only but spends the 114,688-token usable ceiling on old reasoning
  and makes compaction fire sooner. Flip it only with that measured.

---

## E3 — compaction under real pressure

D1b's fix is applied but only the route is proven; the fail-closed path is still read from code.
**Natural traffic cannot reach it** — 19,403 max prompt against a 104,857 threshold — so this needs a
synthetic deep task, not a realistic one.

```sh
pnpm dsh --profile headless "List the ten largest .ts files under packages/llm, \
  then read each one in full and summarise what each module is responsible for."
```

Verify: a `compaction` event fires; the summary request's route is `local-qwen-off`; the checkpoint is
complete; **no** `summarization truncated at the token cap` error. Then test the overflow path
deliberately by raising `thresholdRatio` above the admission ceiling so compaction cannot fire first,
and confirm the 400 is classified and recovered rather than failing the turn. Restore `0.8` after.

Note for whoever runs it: compaction keeps a **tail** of `floor(131072 * 0.16) = 20,971` tokens and
summarizes `{first transcript node → cutoff}`, so it rewrites the earliest transcript and the
divergence point lands immediately after the shared head. Everything after re-prefills — the expensive
direction, and what we told them in Q11.

## E4 — exercise the fan-out bound

`maxConcurrentAgents` is pinned to 4 (above). **Exercised on 2026-08-23 and it holds**: B5 ran five
subagent and workflow children across three cases, two children starting 2 ms apart and three within
25 ms, with `num_requests_running` peaking at **3** — the highest concurrency this deployment has
recorded. Zero preemptions, zero samples with anything queued, peak KV 8.0%.

**The bound was never reached**, since no case asked for more than three, so nothing here justifies
raising it and nothing contradicts it either. Watch `vllm:num_requests_waiting` if you do push it:
persistently non-zero means requests are dying of queueing, not slowness. `num_requests_running` counts
scheduler residency, not simultaneous prefills.

Purge ledger A3 — `subagent` ×4, `tool-subagent*` ×4, `workflow*` ×2, `tool-ralph`, ~1,800 tokens of
tool schema — was written against a path that had never run. **It has now run, correctly, with exact
results, so A3 is withdrawn**: dropping those rows would remove verified capability. No purge candidate
replaced it. `read_image` briefly looked like one and is not: the model sees images, so those tokens buy
capability we should be switching on instead.

## E5 — the instruct alias and sampler

Gateway-only, additive, no engine restart. Qwen documents two samplers and three of six values differ;
**thinking mode is already fully correct and not by luck** — Qwen ships the thinking sampler in
`generation_config.json`, vLLM adopts it (boot log: `temperature 1.0, top_k 20, top_p 0.95`), and the
remaining three are vLLM defaults that already match.

| Param | Thinking | Instruct | Engine default | Harness can send? |
|---|---|---|---|---|
| `temperature` | 1.0 | 0.7 | 1.0 | plumbed, but no config surface |
| `top_p` | 0.95 | 0.80 | 0.95 | no — absent from pi-ai |
| `top_k` | 20 | 20 | 20 | no |
| `min_p` | 0.0 | 0.0 | 0.0 | no |
| `presence_penalty` | 0.0 | 1.5 | 0.0 | no |
| `repetition_penalty` | 1.0 | 1.0 | 1.0 | no |

**Instruct mode is wrong on three values and only one is even reachable**, so a harness-only fix is
impossible. pi-ai 0.82.1 writes exactly one sampling field — `params.temperature` at
`openai-completions.js:540` — and its `GenerateOptions` has no `top_p`, `top_k`, `min_p`,
`presence_penalty` or `repetition_penalty` at all. Even `temperature` has no config surface: it exists
in `LlmCallConfig` and is forwarded at `llm-pi-ai/src/adapter.ts:369`, but neither the route profile nor
`agent-default-model` can set it.

**Unchanged at rc.2**, re-checked rather than assumed: pi-ai is still pinned `^0.82.1`, and the only
fields rc.2 added to `PiAiProviderProfile` are the two image budgets. The forwarding line moved from
347 to 369 when `prepareCall` was introduced; the single-field behavior is identical.

The gateway is the right place and already does this kind of injection. Because dsh sends **no**
sampling fields there is nothing to clobber — unlike `chat_template_kwargs`, which dsh always sends and
which replaces an injected dict wholesale.

```yaml
# litellm/config.yaml
- model_name: chat-model-instruct
  litellm_params:
    model: hosted_vllm/chat-model
    api_base: http://vllm-chat:8000/v1
    api_key: os.environ/VLLM_API_KEY
    temperature: 0.7
    top_p: 0.80
    presence_penalty: 1.5
    extra_body:
      chat_template_kwargs: {enable_thinking: false}
      top_k: 20
      min_p: 0.0
      repetition_penalty: 1.0
```

All six values were accepted on both surfaces with the correct behaviour — reasoning length 0 under the
instruct set, populated under the thinking set. The gateway runs `drop_params: false`, so HTTP 200 is
proof they reached the engine rather than being quietly dropped.

Then add a dsh route on the managed `/v1` with `reasoningEfforts: false` and point the two auxiliary
calls at it. **Verify on the wire, because this is the one place `reasoningEfforts: false` is safe.**
The request must carry **no** `chat_template_kwargs` at all — pi-ai's chat-template branch is skipped
for a non-reasoning model — leaving the gateway's injected dict intact. If dsh sends a dict it replaces
the injection wholesale and you silently get thinking at `xhigh`. Confirm reasoning length 0.

---

## Traps that produce a passing run

Harness-side. Engine-side traps live in `TUNING.md` §4 and §6; do not copy them back here.

- **`content: null` with HTTP 200 and billed tokens.** The dominant failure shape. Always read
  `finish_reason`: `stop` means the answer is in the reasoning field and is recoverable; `length` means
  it is unfinished and must not be recovered.
- **Effort `low` does this on 11% of items** (78/690 measured); `medium` did it once in 690. Do not drop
  to `low` to save tokens.
- **A client `chat_template_kwargs` voids a gateway-injected effort** — it replaces, never merges. Bind
  to `chat-model` or the raw route when the client drives effort.
- **`reasoningEfforts: false` on the raw surface turns thinking ON at `xhigh`.** It is only safe against
  a managed alias that injects `enable_thinking: false`.
- **A patch entry's `config` replaces, it does not merge.** The loader assigns per top-level key, so
  restate the whole config block or boot fails on a missing required field. `workflow-worker-thread` is
  the live example: patching `maxConcurrentAgents` without restating `provider: spawn` drops the
  bundle's provider selection.
- **An unknown key in a pi-ai model entry is dropped in silence.** Our route's modality key is `input`;
  `inputModalities` is `llm-deepseek`'s name for the same idea. Writing the wrong one produced no load
  error and no warning — `read_image` simply kept refusing, and the refusal blames the *model*
  (`model "chat-model" does not declare image input`) rather than the config that failed to apply.
  **Confirm a settings change took effect by observing behaviour, never by re-reading the file.**
- **A route's declared modalities are a claim about the endpoint, not a check of it**
  (`llm-pi-ai/src/catalog.ts:548-554`). Declaring `image` against a text-only endpoint durably admits
  an image into the session log and then strands the route. Verify with `probes/probe_image.py` before
  declaring, and re-verify whenever the served model changes.
- **Session logs are concatenated zstd frames.** A single-frame decode returns the header and looks
  like an empty log; use `read-session-log.mts`.
- **Verify from the decoded log, not stdout.** Every defect found so far returned HTTP 200 with billed
  tokens and no error line.
- **RTK filters command output.** `curl … | head` returned a JSON *schema* instead of values, which
  silently corrupts any measurement read that way. Prefix measurement commands with `rtk proxy`.
- **`probes/tokenize.py` shadows the stdlib `tokenize` module.** Any Python run with `artifacts/probes`
  as the working directory dies inside the interpreter's own imports, with a traceback that blames
  `LITELLM_MASTER_KEY`. Run probes by path from the repo root.
- **A probe with no seed measures a WARM run.** `probes/probe_prefix_saturation.py` builds prompts as a
  pure function of the worker index, so its workers are mutually distinct but every repeat invocation is
  byte-identical to the last. That is how one 4-way row came to be reported as a capacity measurement
  and later withdrawn (`TUNING.md` §6 row 11).
- **A probe that prints but does not persist cannot support a published number.** Four of ours were
  purged for exactly this (row 18). Redirect to a file under `results/` and cite the file.
- **Two independent timeouts.** Audit the client's as well as the gateway's. The harness route sets
  `streamIdleTimeoutMs: 900000` and `maxRetries: 0` to match the gateway deliberately — do not
  reintroduce retries, since each one is a full re-prefill.

---

## Git

```sh
git switch fork/qwen38-deployment          # the work lives here
git push -u origin fork/qwen38-deployment  # runs pre-push typecheck; fork only

# keep master a pristine mirror so fork-sync stays fast-forward — never commit to it
git fetch upstream --no-tags && git switch master && git merge --ff-only upstream/master
```

`upstream` is `deepseek-ai/deepseek-harness` with its push URL deliberately disabled. The fork branch
is rebased onto **`0.1.1-rc.2`** (`b150a551b8`); the pre-0.1.1 tip is kept as
`backup/qwen38-pre-0.1.1`.

**A fork refresh is a rebase, not a merge**, and the check that it is a no-op is one command — if it
prints nothing, upstream has nothing for us:

```sh
git fetch upstream --no-tags && git log --oneline fork/qwen38-deployment..upstream/master
```

Run it through `rtk proxy`. Plain `git fetch upstream` returned only `ok fetched` here, which is
indistinguishable from a fetch that pulled 35 commits.
