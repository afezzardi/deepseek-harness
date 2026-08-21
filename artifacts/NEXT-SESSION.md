# Next session: experiments, in order

State at handoff: commit `3d9a0f5a07` on branch `fork/qwen38-deployment`. `master` is a pristine
mirror of `upstream/master` (0 ahead, 0 behind). Two defects fixed in `~/.dsh` and wire-proven; see
`qwen38-harness-remediation.html`.

**E1 is done (2026-08-20) and it changed the ranking — read §E1 result before planning anything.**
Prefix caching is ON in the fp8 arm and measured working. Two consequences: D3's 13.3k prefill is no
longer the dominant cost, and the shape is now known to hold 4 near-full-context sequences, not 5.

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
of the 0% that issue predicts. `VLLM_PREFIX_CACHE_RETENTION_INTERVAL` is **not** the mechanism —
`envs.py` says it applies to sliding-window attention, not Mamba/linear attention.

### The shape finding that came out of it: 5 is oversubscribed, 4 is right

The boot concurrency line is a nominal KV figure and does **not** mean N sequences co-reside. A
short-output concurrency test proves nothing: each request finishes before the next has prefilled, so
`kv_cache_usage_perc` reads one request's occupancy (0.178 measured) and preemptions stay 0 while the
sequences never overlap. Forcing long outputs (`min_tokens` + `ignore_eos`) is what creates pressure.

At 117,708-token prompts + 8,000 forced output tokens each:

| Concurrency | Resident | Peak KV | New preemptions | Wall | Aggregate output |
|---|---|---|---|---|---|
| 5 | **4** (1 always waiting) | 0.989 | **1** | 684.1s, one request starved 684s vs ~487s | 58.5 tok/s |
| 4 | 4 | 0.901 | 0 | 377.4s, all within 1s of each other | **84.8 tok/s** |

**Five concurrent is 45% slower in aggregate than four.** The compose default for this arm was
already `CHAT_MAX_NUM_SEQS_FP8:-${CHAT_MAX_NUM_SEQS:-4}` with the comment "0.70 affords exactly 4";
the `.env` override to `CHAT_MAX_NUM_SEQS=5` was what oversubscribed it.

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

**Then turn it into a snapshot.** Unresolved sub-task: determine how `pnpm run test:snapshot` selects
a provider, and whether it can target `local-qwen` or only `deepseek-official`. Start at
`scripts/` and the snapshot fixtures under `examples/`. If it cannot target a local route, say so
explicitly rather than recording a snapshot that proves nothing about this deployment.

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
admission gating instead.

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
