# Next session: state, queue, and traps

State at handoff: branch `fork/qwen38-deployment`, rebased onto `upstream/master` at `528c682e06` —
the `release/dsh-0.1.1-rc.1` merge, upstream PR #2890. `master` is a pristine mirror of
`upstream/master` (0 ahead, 0 behind); every fork commit is inside `artifacts/`. The two
capped-auxiliary-call defects (session titling, compaction summarization) are fixed in `~/.dsh`, and
both fixes are wire-proven and carried in the `dsh-cordis.patch.yml` comments.

**The inference record is the authority on everything engine-side, and this file no longer restates
it.** `kb-mastra-infra/docs/TUNING.md` owns block accounting, prefix-cache geometry, fp8, the shape,
and — in its §6 — the single retraction ledger for both sessions.
`kb-mastra-infra/MESSAGE.md` is the exchange, restructured to a strict question/reply schema on
2026-08-21: **re-read it from the top, do not diff it.** Round 8 (theirs) answered Q17; round 9 (ours)
filed the head-composition correction as Q18. Our handover artifact is on the host at
`kb-mastra-infra/artifacts/from-harness/`.

## Resume here

**Nothing is blocked on the inference side, and nothing on our side is waiting on a boot.** Their Q17
reply closed the last engine-side dependency: N is not our constraint, `maxConcurrentAgents` is
unpinned from their admission, and every capacity figure either session argued about defends headroom
our traffic never touches. Read `MESSAGE.md` from the top and `docs/TUNING.md` §6 before writing down
any mechanism claim — six entries there are now ours.

| Pending | Whose | State |
|---|---|---|
| **Q18** — head composition: the shared prefix is 7,455 tokens, not 13,253 | ours, filed | Sent as a correction, not a request. It explains their 85.0% replay against our 90.7% claim. Nothing for them to boot |
| **Q10** — fp8 KV re-price at our shape | theirs | Nothing for us to change either way. If they unset `KV_CACHE_DTYPE_FP8` the pool shrinks ~1.845x, which we do not care about at 19 blocks/request. Re-run E2 afterwards to confirm the route still behaves |
| **Q3** — pushback on making the warm TTFT series the headline | theirs, open to us | Consciously left unanswered. Only worth a reply if we start caring about published TTFT medians |

Two standing rules, both of which produced retractions: **hand them numbers, not derivations**, and
**measure a contributor, never fit it** — the 13,253 head was a least-squares intercept, which
describes a total and is silent about composition.

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

All 14 recorded sessions, decoded logs, 31 main-route requests + 14 titling calls:

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
not the 90.7% published here before. Their independent replay of that geometry measured **85.0%** and
they attributed the gap to a base difference; it was our error, and the corrected figure lands 1.1
points from their measurement.

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
| 1 | **E3** — compaction under real pressure. It cannot happen naturally at 19k prompts; it needs a synthetic deep task | none | ours |
| 2 | **E4** — fan-out at the bound of 4. No recorded session has ever run a subagent, so the path is unexercised rather than known-good | none | ours |
| 3 | Their **Q10** fp8 re-price at our shape (p95 output 514, max 961, all below their 1,355 crossover) | 1 boot if taken | inference |
| 4 | **E5** — instruct alias; gateway restart only. Low value while nothing of ours uses instruct mode | none | inference |

Done 2026-08-21: the E2 re-run under the new `maxTokens`/`thresholdRatio` pair (passed), and the head
composition measurement that replaced the intercept.

`--max-num-batched-tokens 3136` stays **declined**, and the corrected geometry strengthens rather than
weakens the case. Under the stride model they have since withdrawn (row 21), a 7,455-token prefix would
reuse **0** at the shipped stride and 6,272 at 3,136 — so the benefit is 6,272 tokens once per prefix
lifetime, not the 4,704 we told them, against a prefix that has not changed in 45 requests. The cost is
unchanged: ~60% fewer tokens per prefill step forever, and our warm prefills fit in one 8,192-token step
today. `VLLM_PREFIX_CACHE_RETENTION_INTERVAL` is last, per row 16.

**Not worth chasing, recorded so it is not rediscovered as new.** 5,822 tokens of per-session-constant
content sit after the varying task string, so they re-prefill every session. Emitted *before* the task
they would extend the shared prefix to ~13,277 tokens and lift first-request reuse from 6,272 to 12,544
— worth ~1.1 s of prefill per session start, ~8 s/day at our recorded 7 sessions/day. That is an
upstream prompt-assembly observation, not a fork patch, and it is below the bar either session applies
to a boot. It is only worth revisiting at a much higher session rate.

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
pins the bwrap argv rather than cross-runner observable behavior. Still present at 0.1.1-rc.1;
upstream added only `--unshare-pid`.

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

`maxConcurrentAgents` is now pinned to 4 (above). No recorded session has ever run a subagent, so the
path is unexercised rather than known-good. Watch `vllm:num_requests_waiting` during the run:
persistently non-zero means requests are dying of queueing, not slowness. `num_requests_running` counts
scheduler residency, not simultaneous prefills.

Purge ledger A3 covers `subagent` ×4, `tool-subagent*` ×4, `workflow*` ×2, `tool-ralph`, and removes
~1,800 tokens of tool schema with them. If you drop them, re-run E2 first: A3 is one of the purges the
gate exists to protect.

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
in `LlmCallConfig` and is forwarded at `llm-pi-ai/src/adapter.ts:347`, but neither the route profile nor
`agent-default-model` can set it.

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
was rebased onto `0.1.1-rc.1`; the pre-rebase tip is kept as `backup/qwen38-pre-0.1.1`.
