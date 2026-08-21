# Next session: experiments, in order

State at handoff: commit `3d9a0f5a07` on branch `fork/qwen38-deployment`. `master` is a pristine
mirror of `upstream/master` (0 ahead, 0 behind). Two defects fixed in `~/.dsh` and wire-proven; see
`qwen38-harness-remediation.html`.

**E1 is done (2026-08-20) and it changed the ranking — read §E1 result before planning anything.**
Prefix caching is ON in the fp8 arm and measured working. Two consequences: D3's 13.3k prefill is no
longer the dominant cost, and the shape holds 4 near-full-context sequences warm — but **not cold**,
per the 2026-08-21 correction inside §E1 result. Read that correction; the 4-way row was warm.

**E2 is done (2026-08-21): the gate passes, and it is now the deployment regression gate.** Its
write criterion turned out untestable as written, one new defect (D6) came out of it, and the
`test:snapshot` sub-task is settled — it **cannot** target `local-qwen` and recording one would prove
nothing. All three in §E2 result.

**Remaining queue, re-ranked after both:** the highest-value item left is inference-layer and new —
**`VLLM_PREFIX_CACHE_RETENTION_INTERVAL=0`**, read out of the installed source on 2026-08-21 and
handed over in `MESSAGE.md` §R3. It is one env var, it is the direct dial on the retained mamba
snapshots that caused the cold-4-way preemptions, and it preserves prefix reuse by construction. Then
E3 (compaction under real pressure, plus R3), then E4 (fan-out, purely harness-side and needing no
boot). `--max-num-batched-tokens 32768` is **demoted** back to what it was always for — confirming the
prefill-serialization ladder — because it provably does not touch retention. E5 is unchanged and
still gateway-only.

**A model I published in `MESSAGE.md` §R2.4 and then retracted in §R3 the same day:** that retained
align pages scale with scheduler steps, and therefore with `--max-num-batched-tokens`. The source
says retention is block-driven. Do not revive it; the retraction explains why, and §R3.3 has the
mechanism that replaced it.

Read first: the remediation report, then §6/§7 of the consolidated assessment (purge ledgers), then
§Evaluation plan of the foundation assessment (this file operationalises its Phases 2 and 3).

```sh
cd /home/andrea/management/deepseek-harness
set -a && . ./.env && set +a          # LITELLM_MASTER_KEY
ssh afezzardi@100.108.76.12 hostname  # NOT the ~/.ssh/config alias; that IP is the reachable one
```

---

## E1 result — Prefix caching, align mode: KEEP IT (measured 2026-08-20)

`--enable-prefix-caching` is now in the fp8 arm's `command:` list, with the full measured record in
the comment above the flag. The false claim that this checkpoint "cannot prefix-cache" is corrected
in both arms' shape comments. Revert is deleting the flag; nothing else depends on it.

**All four boot gates passed**, and the source reading was confirmed exactly:

| Check | Result |
|---|---|
| mode selected | `Mamba cache mode is set to 'align' ... when prefix caching is enabled` |
| feature on | `enable_prefix_caching=True`, `enable_chunked_prefill=True` |
| shape held | `Maximum concurrency ...: 5.27x` (was 5.45x) — still ≥ `CHAT_MAX_NUM_SEQS=5` |
| no preemption | 0 across every hit-rate and correctness run |

**Cost is +3.45% KV per sequence, not the 4x a per-block checkpoint would imply.**
`MambaSpec.max_memory_usage_bytes` (`v1/kv_cache_interface.py`) returns
`page_size_bytes * (2 + num_speculative_blocks)` for `align` against `(1 + ...)` for `none`: align
reserves *two* mamba pages per GDN layer per sequence — the running state plus one boundary
checkpoint — not one per block. That is +48 pages of 3.0625 MiB, and it predicts the new KV size to
the token: `714,116 × 1392/1440 = 690,312`, measured 690,312. `max_num_blocks_per_req` returns
`cdiv(max_len, block_size)` = 84, but that bounds the *address space*, not the reservation; a code
comment at that site says so. Block size is not a dial here — the mamba page is padded to exactly the
attention page, so the two effects cancel and total mamba bytes per sequence are invariant.

**Reuse is real and large.**

| Shape | Measured |
|---|---|
| identical 38,102-token prompt twice | 98.8% (37,632/38,102), 7.32s → 0.28s. The 470-token miss is `38,102 mod 1568` — the trailing partial block |
| append-only chain, 31k → 62k (agent tool loop) | 0%, 76.8%, 80.8%, 83.7%, 85.9%; each step's hits equal the previous request's full-block count exactly |
| shared prefix + long unique suffix | 0%, 43.1%, 54.6%, 54.6% |
| real `dsh --profile headless`, same task, NEW session | 12.22s → 8.86s, 40.6% → 81.2% |

The last row is the one that matters: the ~13.3k system+tools prefix is reused **across sessions**,
not only within a run, so **D3 is demoted** — that prefill is now paid once and reused, and the
tool-schema purge is an optional context-budget cleanup rather than the dominant cost lever.

**But cross-session reuse is evictable, and the floor is lower than the headline.** Running the
saturation tests below — five distinct 117k-token prompts — evicted the shared prefix, and the very
next `dsh` run fell back to 40.6%; an immediate repeat returned to 81.2%. So 81.2% is what a warm
cache gives, 40.6% is the guaranteed floor (the intra-run reuse of step 2 over step 1, which cannot
be evicted mid-run), and heavy unrelated full-context traffic moves you between the two. Plan on the
floor, not the headline.

**Correctness holds, tested the right way.** GDN backends are not batch-invariant, so cached and
fresh generations are not bit-exact and a token diff is the wrong test. `probe_prefix_correctness.py`
instead checks recall of needles embedded *inside* the reused region: 15/15 exact across 3 trials,
including an arm that asks a different question against the same cached prefix, plus byte-identical
tool-call arguments over repeats.

**Two limits worth knowing.** Granularity is the 1568-token block, so a shared prefix shorter than
one block can never hit. And vLLM reports no `cached_tokens`: `prompt_tokens_details` is `null` even
on a direct authenticated call to the engine, so this is **not** a gateway artifact — monitor with
`vllm:prefix_cache_queries_total` / `vllm:prefix_cache_hits_total`.

`#45238` does not describe this build. 0.27.1's `MambaManager` sets
`supports_fine_grained_hash_lookup` and tracks `_producer_partial_tail_reqs` / `last_state_block_idx`
with copy-on-write of the boundary state, which is why the shared-prefix shape reuses 43-55% instead
of the 0% that issue predicts.

**CORRECTED 2026-08-21 — this paragraph originally claimed `VLLM_PREFIX_CACHE_RETENTION_INTERVAL` is
"not the mechanism" because "`envs.py` says it applies to sliding-window attention, not Mamba/linear
attention". That is wrong, and it was read from the env var's prose instead of the implementation.**
It applies to **both**, and it is the direct dial on retained mamba pages:

- `_validate_prefix_cache_retention_interval` (`v1/core/kv_cache_coordinator.py:30`) states
  "Retention sparsifies sliding-window and Mamba (linear-attention) checkpoints; full-attention and
  chunked-local groups cache densely and ignore it", and **raises** when the model has neither a
  `SlidingWindowSpec` nor a `MambaSpec` group. This model has three `MambaSpec` groups.
- The coordinator passes `retention_interval` to **every** manager unconditionally (lines 287, 682);
  each manager decides, and `MambaManager.reachable_block_mask` (`single_type_kv_cache_manager.py:1359`)
  implements it in full: `None` → **dense, every block (the default)**; `0` → only the
  `reachable_boundaries`, i.e. the replay boundary and any detected shared-prefix junction; a positive
  multiple of `scheduler_block_size` → one per segment plus those boundaries.

Two consequences that outrank most of the queue:

1. **`align` retains one mamba snapshot per block per group, densely, by default.** The estimator's
   `page_size × (2 + num_speculative_blocks)` is a *reservation* figure, not a retained count — which
   is the whole reason the boot line under-counts. Prefer that framing over "the estimator is wrong":
   it is a provisioning and admission number, plausibly conservative by design, and the ~12 is a
   runtime observation, so the two are different kinds of quantity. Retention is block- and
   alignment-driven, never step-driven: `cache_blocks` uses `num_tokens // block_size`, and
   `alignment_tokens` is `scheduler_block_size` = `math.lcm(*group_block_sizes)`
   (`kv_cache_utils.py:659`), so `--max-num-batched-tokens` **never enters this path**.
   Corroboration from the numbers alone: dense snapshotting over a 125,708-token sequence would
   generate ~80 snapshot events per group while only ~12 blocks are held, so the **eviction** path,
   not the snapshot path, sets the steady state.
2. ~~Dense snapshots are evictable, so `kv_cache_usage_perc` near 1.000 does not prove the live
   working set does not fit.~~ **RETRACTED same day — this was wrong, and `block_pool.py` says so.**
   `get_usage()` is `1.0 - get_num_free_blocks() / (num_gpu_blocks - 1)` where
   `get_num_free_blocks()` returns `free_block_queue.num_free_blocks`, and that queue is **unified**:
   the class docstring says a cached block "may be used by running requests **or in the
   free_block_queue that could potentially be evicted**", and the free path pushes a block there as
   soon as `ref_cnt` hits 0 (`blocks_without_hash` prepended, `blocks_with_hash` appended). Eviction
   is synchronous with allocation — `popleft_n` takes a cache-tagged block and drops its hash. So a
   cached-but-unreferenced snapshot **already counts as free**, and `free_blocks == 0` means no
   `ref_cnt == 0` block exists anywhere. **1.000 is genuine exhaustion.**

   Two consequences. **The occupancy-based pass/fail criterion below is void** — evictable blocks were
   never in the numerator, so sparse retention has no guaranteed effect on this metric and the
   direction is unknown; do not predict one. And at 1.000 all 473 blocks are *referenced*: live KV is
   `4 × 81 = 324` attention + `4 × 3 = 12` running mamba states = 336, leaving **~137 referenced
   blocks that are not live working set**. The source names a mechanism that fits — `_apply_cow` takes
   "an extra ref beyond the one handed to the request", and `take_partial_tail_offloads` documents the
   lifetime as "pinned here and **unpinned when the request's blocks are freed**". That is a
   request-lifetime pin, not a short window, so align's retained boundary states are not raidable
   cache. That CoW pinning dominates the ~137 is inference, not measured.

   **So cold 4-way genuinely does not fit, and N=3 is better supported than the retraction above
   implied.** What survives of that objection is only the 81-vs-84 arithmetic point: the *derivation*
   does not reach the conclusion, but the observation does. One distinct alternative remains unruled:
   `get_num_blocks_to_allocate(..., apply_admission_cap=True)` can preempt with free blocks available,
   so check whether that path was active before attributing everything to capacity.

`VLLM_PREFIX_CACHE_RETENTION_INTERVAL=0` is consequently the highest-value inference-layer experiment
outstanding — one env var, validated at boot, and it preserves the reuse points prefix caching depends
on by construction rather than by luck. Handed over in `MESSAGE.md` §R3.

**Judge it on preemption delta, warm reuse percentage, and aggregate throughput — never on
occupancy**, and hold no prior about which way occupancy moves. The original justification for that
instruction ("occupancy always falls, because evictable blocks leave the numerator") was **wrong** and
is retracted in item 2 above; the instruction survives its own rationale, because the metric now has
no predicted response to the lever at all. Whether sparse retention reduces the ~137 request-lifetime
CoW pins is the open question the experiment answers.

**But run the free test first, before any boot** (`MESSAGE.md` §R4.2). Warm 4-way peaked at 0.755 with
0 preemptions against cold's 0.989/1.000 at the *same* 125,708-token final length, so that pair
already isolates retention from sequence length: a fixed per-request cap would read alike, and the
0.23-of-pool gap is instead the signature of hits sharing resident blocks. It costs nothing — the data
exists — and it tells you whether the retention lever is attacking the cold path specifically, which
determines which runs the pass criteria should be read off.

### The shape finding that came out of it: 5 is oversubscribed, 4 is right

The boot concurrency line is a nominal KV figure and does **not** mean N sequences co-reside. A
short-output concurrency test proves nothing: each request finishes before the next has prefilled, so
`kv_cache_usage_perc` reads one request's occupancy (0.178 measured) and preemptions stay 0 while the
sequences never overlap. Forcing long outputs (`min_tokens` + `ignore_eos`) is what creates pressure.

At 117,708-token prompts + 8,000 forced output tokens each:

| Concurrency | Resident | Peak KV | New preemptions | Wall | Aggregate output |
|---|---|---|---|---|---|
| 5 | **4** (1 always waiting) | 0.989 | **1** | 684.1s, one request starved 684s vs ~487s | 58.5 tok/s |
| 4 (**warm** — see below) | 4 | 0.901 | 0 | 377.4s, all within 1s of each other | **84.8 tok/s** |

**Five concurrent is 45% slower in aggregate than four.** The compose default for this arm was
already `CHAT_MAX_NUM_SEQS_FP8:-${CHAT_MAX_NUM_SEQS:-4}` with the comment "0.70 affords exactly 4";
the `.env` override to `CHAT_MAX_NUM_SEQS=5` was what oversubscribed it.

**CORRECTION (2026-08-21): the 4-way row above is a WARM run and must not be read as a capacity
measurement.** The inference-layer owner could not reproduce "zero preemptions at 4-way" and ran it
three times cold: peaks 0.989 / 1.000 (pool exhausted) with **+1 and +2 preemptions**, against a
warm repeat that read 0.755 with zero. The cause is in our probe, not in their runs:
`probes/probe_prefix_saturation.py:49` builds each prompt as
`" ".join(f"s{k}q{i % 983}" for i in range(n_words))` — a pure function of the worker index with
**no seed**, so the workers are mutually distinct but *any repeat invocation reproduces
byte-identical prompts*. The 5-way run went first, so the 4-way replayed prompts the engine had
just prefilled. 0.901 ≈ 4×106 blocks sits between their warm 0.755 and their cold 0.989, which is
what partial reuse gives, and it also explains the aggregate throughput gap (84.8 vs their 74.8
tok/s): the warm run skipped part of the prefill. Sampling is *not* the explanation — the probe
selects its peak scrape lexicographically by `(running, kv_usage)` (line 112), so 0.901 is a genuine
joint single-scrape observation, of a warm run.

**Cold 4-way does NOT fit at full context — but that is an observation, not a derivation.** One
shared pool of 473 usable blocks; the 64 layers group into 1 attention + 3 mamba groups of 16
(`kv_cache_utils.py` splits to equal sizes), and the boot line sums over all four:
`84 + 3×2 = 90` blocks/request → `474/90 = 5.27x`, which also yields `690,312` exactly. That much is
correct as written.

**The block back-solve, however, used the wrong attention count, and corrected it says 4 fits.**
`84 = ceil(131072/1568)` is the max-model-len **address space** — right for the boot estimator's worst
case, wrong for a back-solve, because paged attention KV is allocated against tokens actually
processed. Those requests were `117,708 + 8,000 = 125,708` tokens, so actual consumption is
`ceil(125708/1568) = **81**` blocks, not 84:

| attention blocks | at 12 mamba pages/group | ×4 | vs 473 |
|---|---|---|---|
| 84 (as originally derived) | `84 + 36 = 120` | 480 | overflows by 7 |
| **81 (actual)** | **`81 + 36 = 117`** | **468** | **fits, 5 spare**; `floor(473/117) = 4` |

So the arithmetic does not establish the overflow. **The overflow is established directly** by the
preemption deltas and a single scrape reading `473/473`. The inference runs the other way: overflow
was observed, and it *pins* retention at **≈12.4-12.8 pages per group** (overflow at 81 attention
blocks requires > 12.42). Quote the retention as ≈11-13, not 12; the `480 → 120 → 12` chain is a
back-fit that happened to round to a multiple of 4.

**Consequently `floor(473/120) = 3` is not a result** and N=3 must not be promoted to the record — see
also the evictability argument below, which independently undercuts reading occupancy as a capacity
requirement.

Two corollaries that do stand: lowering `--max-num-seqs` does **not** free mamba pages (they are taken
per running request from a pool whose sizing has no `max_num_seqs` term, so 5→4 bought admission
control, not capacity), and prefix caching **buys KV headroom** because a hit shares resident blocks
instead of allocating new ones — an independent second argument for the flag, and the best explanation
of why the warm 4-way run peaked at 0.755 against cold's 0.989/1.000 at *identical* final sequence
length.

**The setting stays 4**, decided jointly and recorded in `MESSAGE.md` Q1: preemption here is a
latency event, not a correctness one; a preempted sequence resumes from its last cached boundary;
warm agentic traffic is where this deployment lives and 4 is clean warm; and in the exact cold
full-context regime where 4-way preempts, the 4th slot is already latency-bound by prefill
serialization rather than throughput-bound. N is also the wrong instrument — the mechanism is
retained align pages, which `--max-num-batched-tokens` addresses and N does not. Monitor
`vllm:num_preemptions_total` delta > 0 instead; it now has a known cause and means "this workload
left the warm regime".

**Applied by the inference-layer owner, verified on the host 2026-08-20:**
`kb-mastra-infra/.env` now has `CHAT_MAX_NUM_SEQS=4`, the running container's argv carries
`--max-num-seqs 4`, and `--enable-prefix-caching` is on both the fp8 and nvfp4 arms so the A/B still
measures only the checkpoint. The boot line is unchanged at **5.27x**, which is now a comfortable
margin over 4 instead of 5.27 against 5. The nvfp4 arm's own gate (≥ 6) is still unverified and must
be read from its boot line before that arm ever serves.

Not yet attributed: whether the single preemption at 5-way is *caused* by align mode's +3.45% or
would happen without it. Settling it needs the same saturation run with the flag removed. The
decision does not depend on it — 4-way is clean either way, and with caching a preempted sequence
resumes from its last cached boundary instead of token 0 — but the record should not claim it.

### `preserve_thinking` re-decided: stays `false`, for a new reason

The old justification is now void, so do not reason from it: it said `false` was free because this
deployment could not reuse KV. It can. But `false` should still stay, on measured grounds:

- **It is a no-op in headless mode.** `chat_template.jinja:116` keeps a turn's `<think>` when
  `loop.index0 > ns.last_query_index`, and `last_query_index` (lines 88-97) is the last *real* user
  message — `<tool_response>` content and `tool`-role messages never advance it. With one user turn
  every assistant turn is after it. Confirmed via `/tokenize`: one user turn renders **75 tokens
  either way**; add a second user turn and it becomes 84 (`true`) vs 76 (`false`).
- **In interactive multi-turn use it is a real trade, not a free win.** `false` retroactively strips
  thinking from turns at or before the new last user query, which rewrites history and invalidates
  the shared prefix from the first stripped turn on. `true` keeps the prefix append-only and fully
  reusable, but accumulates every past reasoning block against a usable prompt ceiling of 98,304,
  making compaction fire sooner. Which wins depends on reasoning length per turn and session length;
  that is now a well-defined measurement, not an assumption. Flip it only with that measurement.

---

## E2 — The Day-1 regression gate

**DONE 2026-08-21 — jump to §E2 result.** The brief below is the original specification, kept
because the result corrects one of its criteria rather than merely satisfying it.

The gap the bring-up report opened with, still unclosed. Foundation assessment Phase 2 names the
exact coverage: read a file, **write under approval policy**, run a command, **one failing tool**,
and a second model step. The two never exercised are the write and the failure.

```sh
pnpm dsh --profile headless "Read artifacts/README.md and report its first heading. \
  Then try to read artifacts/does-not-exist.md and report exactly what happened. \
  Then write the single line OK to /tmp/dsh-gate.txt. \
  Finally run 'wc -l < /tmp/dsh-gate.txt' and report the number."
```

Verify from the decoded session log, not from stdout:

```sh
node --import tsx/esm artifacts/read-session-log.mts \
  "$(ls -t ~/.dsh/sessions/*/session-*/session.jsonl.zstd | head -1)" /tmp/s.jsonl
grep -o '"type":"[^"]*"' /tmp/s.jsonl | sort | uniq -c | sort -rn
```

Required: the failing tool produces a stable error code the model then recovers from (not a turn
abort); the write goes through the approval path rather than bypassing it; a second model step
consumes both results.

### E2 result — PASSES, but the gate as written cannot test its own write criterion (2026-08-21)

One turn, 8 model steps, 9 tool calls, `turn/end reason: {kind: completed}`. Verified from the
decoded log, not stdout. Route confirmed on the way past: `request/header` carries
`provider: local-qwen, model: chat-model, maxTokens: 32768, reasoningEffort: medium`.

| Criterion | Verdict |
|---|---|
| failing tool yields a stable error code | **PASS.** `error: {name: "FsError", code: "FS_NOT_FOUND"}`, model-visible text `Error: cannot read "…": not found`, `isError: true` |
| model recovers rather than aborting the turn | **PASS.** Step 1 read both files in one step; the turn continued through step 8 and ended `completed` |
| write goes through the approval path | **See below — the gate cannot test this with a `/tmp` target.** Tested separately and it passes |
| a second model step consumes both results | **PASS.** 8 steps over 9 calls; step 2 acted on step 1's two results |

**The write criterion is untestable as written, and that is a defect in the gate, not the harness.**
The write to `/tmp/dsh-gate.txt` raised no `approval/asked` and returned `Created file` — correctly,
because `workspace-write` grants `/tmp` **by design**: `writableRoots` (`packages/sandbox/sandbox/src/roots.ts:54`)
returns `[workspaceRoot, '/tmp', tmpdir()]`, and the preset's own description is "Write inside the
workspace and permitted temporary directories". A `/tmp` write can never exercise approval under this
preset. Two follow-up runs closed the coverage properly, targeting a path outside every grant root:

```sh
pnpm dsh --profile headless "Write the single line OK to the absolute path \
  /home/andrea/dsh-gate-approval.txt. Report exactly what happened, including any error text \
  verbatim. Do not retry with a different path and do not attempt any sandbox escalation."
```

- **Denial is fail-closed and stably coded**: `error: {name: "FsError", code: "FS_SANDBOX_DENIED"}`,
  model-visible `Error: [sandbox: file access denied under workspace-write mode]` plus an escalation
  hint naming `sandbox_permissions`. No file was created. The model reported it verbatim.
- **The full write → approval → decision chain is proven** by a second variant that permitted the
  escalation retry. Step 1 denies as above; step 2 re-sends the identical write carrying
  `sandbox_permissions: "danger-full-access"` and a justification, which produces
  `approval/asked {toolName: "write", reason: "escalate sandbox to danger-full-access: …"}` →
  `approval/decided {outcome: "unavailable"}` → `Error: sandbox escalation to "danger-full-access"
  requires approval, but no approval channel is available`. No file was created. Headless has no
  approval channel, so `ask` resolves `unavailable` and fails closed — the correct headless behavior,
  and what the gate should assert. The main run reaches the same pair via a `bash` escalation at
  step 7, so both executors are covered.

**Rewrite the gate's write step** to target a path outside the workspace *and* outside `/tmp` and
`os.tmpdir()`; assert `FS_SANDBOX_DENIED`, then an `approval/asked` / `approval/decided` pair on the
escalation retry. A `/tmp` target asserts nothing.

**One asymmetry to know when asserting on this:** the denial carries a structured
`error: {name, code}`, but the *escalation-refusal* result carries `error: null` — the reason exists
only as model-visible prose. Assert the `approval/decided` event, not an error code, for that step.

### D6 (new) — `/tmp` is not a shared channel between the fs tools and bash on Linux

The main run's final step could not succeed on this platform, for a reason unrelated to the model.
`bash: line 1: /tmp/dsh-gate.txt: No such file or directory`, while `read` on the same path returned
`1: OK` and `totalLines: 1`. From inside bash, `ls -la /tmp` shows an **empty** directory whose parent
is owned `nobody nogroup`.

Cause, exactly: `packages/sandbox/sandbox-local/src/profiles.ts:19` — the bwrap dialect mounts
`--tmpfs /tmp`, a fresh empty tmpfs, while the in-process fs fence derives its allow-list from
`writableRoots` and so grants the **real** `/tmp`. The two planes disagree about the same declared
grant. This deployment selects bwrap (0.9.0 at `/usr/bin/bwrap`; the Landlock native addon is not
installed) — and the Landlock dialect would *not* have this problem, since `profiles.ts:33` grants
the real `/tmp` read-write.

This is a **known and deliberate** per-runner difference, not a code/design contradiction:
`roots.ts:5-11` says so, and even names the direction it guards ("so 'the write tool cannot write
/tmp but bash can' asymmetries cannot arise"). What E2 hit is the **inverse** direction, which that
guarantee does not cover, and `local.spec.ts:72` pins the bwrap argv rather than cross-runner
observable behavior. Cost measured here: 5 wasted steps and one 60s bash timeout while the model
diagnosed it — it got the diagnosis right and then correctly attempted an escalation, which
fail-closed.

Consequence for us: **`/tmp` is unusable as a handoff between the fs tools and bash on Linux.** Any
task that writes a file with `write` and then processes it with a shell command must stage it inside
the workspace. Worth an upstream issue; not worth a fork patch.

Two smaller observations from the same log, both recorded rather than acted on:

- **D1 is now confirmed fixed end to end**, not just by route: `session/title-llm-request` carries
  `route: {provider: local-qwen-off, model: chat-model}` and the resulting `session/title` has
  `source: {kind: provider, …}`. The earlier `{kind: fallback}` title is the optimistic one written
  before the call, which is expected.
- **A bash timeout is not flagged as an error to the model.** Step 5's `find /` returned
  `isError: false` with only the text `[timed out after 60000ms] [killed by signal: SIGTERM]`. The
  model handled it, but a timeout is indistinguishable from ordinary output by the `isError` flag.

### The snapshot sub-task, settled: `test:snapshot` cannot target `local-qwen`, and recording one would prove nothing

Resolved by reading the harness rather than by trying it. **Replay — the keyless default — never
contacts a provider at all**, so there is no route to point anywhere:

1. `resolveConfigPath` (`packages/boot/app-boot/src/index.ts:61-68`) rewrites the `cordis.yml`
   basename to `cordis.snapshot.yml` **only** when `$DSH_SNAPSHOT === 'replay'`.
2. Every `*.cordis.snapshot.yml` overlay disables the real adapter and inserts the replay plugin —
   `- id: llm-deepseek … disabled: true` plus `- id: llm-replay`.
3. `dsh-llm-replay` serves every call from the recorded session log, either as a routed adapter or,
   with no `providers` configured, as a catch-all `ctx.on('llm/stream', …)` waterfall
   (`packages/test-support/llm-replay/src/index.ts:748-751`).

So `provider: deepseek-official` in the example's agent config is an inert label under replay. Two
further facts make targeting the local route impossible rather than merely awkward:

- **Record mode boots the LIVE `cordis.yml`**, which hardcodes the `llm-deepseek` adapter with
  `deepseek-official` / `deepseek-v4-flash`. Pointing it at `local-qwen` means editing an upstream
  example — a file that conflicts on every sync, and that every committed fixture was recorded from.
- **Every snapshot runner isolates `$DSH_HOME` into a generated temp dir**
  (`packages/test-support/acp-snapshot/src/harness.ts:255`,
  `packages/test-support/loader-smoke/src/index.ts:185`). Our `~/.dsh/settings.yaml` — the only place
  `local-qwen` exists — is therefore unreadable by design, in record mode as well as replay.

**So: do not record a snapshot for this deployment.** Even if recorded against `local-qwen`, the
committed fixture would only change the replayed chunk *content*; the replay run would still execute
zero deployment code — no route resolution, no `chat_template_kwargs`, no gateway, no engine. It
would assert that this repo's agent loop is deterministic, which `pnpm run test:snapshot` already
asserts, while *looking* like deployment coverage. That is the trap this queue's own discipline warns
about, and it is the reason to decline.

The deployment-level regression gate is the E2 command above plus the two write variants, verified
from the decoded session log. It belongs in `artifacts/`, run by hand, not in `test:snapshot`.

---

## E3 — Compaction under real pressure

D1b's fix is applied but only the route is proven. The fail-closed path is still read from code, and
C6/R3's arithmetic is still arithmetic.

```sh
# force the session past the 91,750-token threshold with real tool results
pnpm dsh --profile headless "List the ten largest .ts files under packages/llm, \
  then read each one in full and summarise what each module is responsible for."
```

Verify: a `compaction` event fires; the summary request's route is `local-qwen-off`; the checkpoint
is complete; **no** `summarization truncated at the token cap` error appears.

Then test the overflow path deliberately. Temporarily set `thresholdRatio: 0.95` in
`~/.dsh/cordis.patch.yml` so compaction cannot fire before the 98,304 admission ceiling, and confirm
the 400 is classified and recovered rather than failing the turn. Restore `0.7` afterwards.

**While here, settle R3.** Set `maxTokens: 16384` and `thresholdRatio: 0.8` and re-run. Predicted:
ceiling 114,688, compaction at 104,857, margin 9,831 — strictly better than today on both margin and
usable context. Confirm nothing in the agent loop needs more than 16k of output.

---

## E4 — Reproduce and bound the fan-out defect (D4)

```sh
nproc   # 24 here, so maxConcurrentAgents resolves to min(16, 22) = 16, against 5 engine slots
```

**E1 made this worse than "16 against 5", in two measured ways.** The engine holds 4 near-full-context
sequences, not 5 (§E1 result), and long prefills do not run in parallel: 5 concurrent 123,598-token
requests produced latencies 40.3 / 78.4 / 116.8 / 154.0 / 187.9s — an arithmetic ladder in ~38s steps,
because one prefill consumes almost the whole 8,192-token `max_num_batched_tokens` budget per step.
Worst-case TTFT is therefore `max-num-seqs × own prefill`, measured 188s against a predicted 190s.
Sixteen agents each carrying an agentic prompt do not queue gracefully behind that; set the bound.

Reproduce the hang, then bound it. Watch `vllm:num_requests_waiting` during the run — persistently
non-zero means requests are dying of queueing, not slowness. Note `num_requests_running` counts
scheduler residency, not simultaneous prefills: one request can be decoding a single token while
another takes nearly the entire batch budget, so read it together with `kv_cache_usage_perc`.

Fix, in `~/.dsh/cordis.patch.yml`:

```yaml
- id: workflow-worker-thread
  config:
    maxConcurrentAgents: 4
```

Or drop the rows entirely — purge ledger A3 covers `subagent` ×4, `tool-subagent*` ×4, `workflow*`
×2, `tool-ralph`, and removes ~1,800 tokens of tool schema with them. If you drop them, re-run E2
first: A3 is one of the purges the gate exists to protect.

---

## E5 — The instruct alias and sampler (D2)

Gateway-only, additive, no engine restart. Do it after E1, because E1 may change whether the
auxiliary routes should live on the raw surface at all.

Add to `kb-mastra-infra/litellm/config.yaml` — the exact block is in D2 of the bring-up report:
`chat-model-instruct`, injecting `enable_thinking: false` plus `temperature 0.7`, `top_p 0.80`,
`presence_penalty 1.5`, `top_k 20`, `min_p 0.0`, `repetition_penalty 1.0`.

```sh
ssh afezzardi@100.108.76.12 'cd kb-mastra-infra && cp litellm/config.yaml litellm/config.yaml.bak \
  && docker compose restart kb-litellm'   # gateway only; the engine keeps running
```

Then a dsh route `local-qwen-instruct` on managed `/v1` with `reasoningEfforts: false`, and point
the two auxiliary calls at it instead of `local-qwen-off`.

**Verify on the wire, because this is the one place `reasoningEfforts: false` is safe.** The request
must carry **no** `chat_template_kwargs` at all — pi-ai's chat-template branch is skipped for a
non-reasoning model — leaving the gateway's injected dict intact. If dsh sends a dict, it replaces
the injection wholesale and you silently get thinking at `xhigh`. Confirm reasoning length 0.

---

## E6 — Two remaining engine levers

Independent of the above, both measured-not-assumed.

**`--long-prefill-token-threshold`** (default `0` = disabled). **Now the highest-value engine lever
left, and no longer hypothetical:** the serialization it addresses is measured. Five concurrent
123,598-token requests returned in a ~38s arithmetic ladder (40.3 / 78.4 / 116.8 / 154.0 / 187.9s),
so worst-case TTFT is `--max-num-seqs` × own prefill — 188s measured against 190s predicted — because
one prefill consumes nearly all of the 8,192-token `max_num_batched_tokens` budget every step. At
4,096 a short tool-result turn stops waiting behind a 130k prefill, at the cost of long prefills
taking roughly twice as long. This workload has both shapes, so it is a real fairness dial. Measure
with mixed short/deep concurrent requests, and record per-request queue time and TTFT separately.

A cheaper comparison to run first, since it needs no new flag: repeat the same five-request workload
with `--max-num-batched-tokens 32768`. If the ladder spacing shrinks roughly in proportion to the
number of prefill chunks, the token-budget explanation is confirmed; if it does not, look at
admission gating instead. **Scope note (2026-08-21): this is a latency experiment only.** It does not
affect retained mamba pages or KV occupancy — retention is block-driven, and
`--max-num-batched-tokens` never enters that path (see the correction in §E1 result). Do not bundle it
with a capacity claim.

**Outranking both of these, and discovered after this section was written:
`VLLM_PREFIX_CACHE_RETENTION_INTERVAL=0`.** An env var rather than a flag, validated at boot, and the
direct dial on the dense per-block mamba snapshotting that caused the cold-4-way preemptions.
Mechanism, semantics table, predictions, and the false-pass trap are in the §E1 result correction and
in `MESSAGE.md` §R3.

**`thinking_token_budget`** — a per-request field in this build, injectable per gateway alias via
`extra_body`. Bounds worst-case reasoning and therefore worst-case step latency. Your own note
records the failure mode: a forced close moved unfinished reasoning into visible output. Test that
specifically before adopting it.

**Do not** re-test `--default-chat-template-kwargs`; it exists here but is redundant, since the
harness sends explicit kwargs on every request.

---

## Traps that produce a passing run

Each of these has already cost someone time on this stack.

- **`content: null` with HTTP 200 and billed tokens.** The dominant failure shape. Always read
  `finish_reason`: `stop` means the answer is in the reasoning field and is recoverable; `length`
  means it is unfinished and must not be recovered.
- **Effort `low` does this on 11% of items** (78/690 measured); `medium` did it once in 690. Do not
  drop to `low` to save tokens.
- **A client `chat_template_kwargs` voids a gateway-injected effort** — it replaces, never merges.
  Bind to `chat-model` or the raw route when the client drives effort.
- **`smoke.sh` 30/30 does not prove the engine's shape.** Nothing in an acceptance suite drives five
  concurrent full-context requests. Read the boot concurrency line.
- **The boot concurrency line does not prove co-residency either.** It is a nominal KV figure. A
  concurrency test with short outputs lets each request finish before the next prefills, so nothing
  overlaps: `kv_cache_usage_perc` reads one request's occupancy and preemptions stay 0 while proving
  nothing. Force long outputs with `min_tokens` + `ignore_eos`, and require a single scrape showing
  `num_requests_running == N` together with high `kv_cache_usage_perc` — peaks taken from different
  scrapes are not a joint observation.
- **RTK filters command output.** `curl ... | head` returned a JSON *schema* instead of values,
  which silently corrupts any measurement read that way. Prefix measurement commands with
  `rtk proxy`.
- **`probes/tokenize.py` shadows the stdlib `tokenize` module.** Any Python run with
  `artifacts/probes` as the working directory dies inside the interpreter's own imports
  (`linecache` → `tokenize`), with a traceback that blames `LITELLM_MASTER_KEY` rather than the
  shadowing. Run probes by path from the repo root, not from inside `probes/`.
- **A hit rate needs a shared prefix of at least one block.** Block size here is 1568 tokens, not the
  usual 16, so short shared prefixes never register a hit and the metric looks like "no sharing".
- **A saturation probe with no seed measures a WARM run.** `probes/probe_prefix_saturation.py` builds
  prompts as a pure function of the worker index, so its workers are mutually distinct but every
  repeat invocation is byte-identical to the last. That is how the E1 4-way row came to be reported as
  a capacity measurement; see the correction in §E1 result. Vary a seed per invocation, and make the
  varying part at least one 1568-token block or it cannot miss.
- **`kv_cache_usage_perc` counts referenced blocks only — cached-but-unreferenced blocks are already
  FREE.** The free queue is unified (`block_pool.py`), so `1.000` means no `ref_cnt == 0` block exists
  anywhere and is genuine exhaustion, not cache filler. Two corollaries that each cost a wrong claim
  here: sparse retention has **no predictable effect** on this metric, and a high reading can never be
  dismissed as "just cache". Judge retention changes on preemption delta, warm reuse, and throughput.
- **Read the implementation, not the prose — and not just for features, for the accounting too.** Four
  claims in this file were wrong because they came from documentation or plausibility: that this
  checkpoint cannot prefix-cache; that `VLLM_PREFIX_CACHE_RETENTION_INTERVAL` does not apply to Mamba;
  that retained align pages scale with scheduler steps; and that occupancy near 1.000 could be
  reclaimable filler. All four died on contact with `v1/core/` inside the container, and each check
  took minutes. The rule is not "prefer the artifact when convenient" — it is prefer it **before**
  publishing a mechanism claim.
- **Two independent timeouts.** Audit the client's as well as the gateway's, against
  (output budget ÷ 19.5 tok/s) + worst-case TTFT. The harness route sets
  `streamIdleTimeoutMs: 900000` and `maxRetries: 0` to match the gateway deliberately — do not
  reintroduce retries, since each one is a full re-prefill.
- **A patch entry's `config` replaces, it does not merge.** The loader assigns per top-level key, so
  restate the whole config block or boot fails on a missing required field.
- **`reasoningEfforts: false` on the raw surface turns thinking ON at `xhigh`.** It is only safe
  against a managed alias that injects `enable_thinking: false`.

---

## Git

```sh
git switch fork/qwen38-deployment          # the work lives here
git push -u origin fork/qwen38-deployment  # runs pre-push typecheck; fork only

# keep master a pristine mirror so fork-sync stays fast-forward — never commit to it
git fetch upstream --no-tags && git switch master && git merge --ff-only upstream/master
```

`upstream` is `deepseek-ai/deepseek-harness` with its push URL deliberately disabled.
