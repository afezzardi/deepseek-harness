# Next session: experiments, in order

State at handoff: commit `3d9a0f5a07` on branch `fork/qwen38-deployment`. `master` is a pristine
mirror of `upstream/master` (0 ahead, 0 behind). Two defects fixed in `~/.dsh` and wire-proven; see
`qwen38-harness-remediation.html`.

Read first: the remediation report, then §6/§7 of the consolidated assessment (purge ledgers), then
§Evaluation plan of the foundation assessment (this file operationalises its Phases 2 and 3).

```sh
cd /home/andrea/management/deepseek-harness
set -a && . ./.env && set +a          # LITELLM_MASTER_KEY
ssh afezzardi@100.108.76.12 hostname  # NOT the ~/.ssh/config alias; that IP is the reachable one
```

---

## E1 — Prefix caching, align mode

**The only experiment that can invalidate the others. Run it first.** If it produces real hits, D3
(the 13.3k baseline) stops being the dominant cost and most of the purge work becomes optional.

Engine change, so it needs a restart and a shape re-verification. Fully reversible.

```sh
# 1. back up, then add the flag to the ACTIVE arm only (chat-fp8; .env has COMPOSE_PROFILES=rag,fp8)
ssh afezzardi@100.108.76.12 'cd kb-mastra-infra && cp docker-compose.yml docker-compose.yml.bak'
#    insert `- --enable-prefix-caching` into the chat-fp8 `command:` list
#    NOTE: the compose comment at :212-213 claiming this cannot help is wrong; fix it in the same edit

# 2. recreate that one service; ~900s start_period (weight load + torch.compile + cudagraph)
ssh afezzardi@100.108.76.12 'cd kb-mastra-infra && docker compose up -d chat-fp8'
```

**Boot gate — all four must hold before any measurement is meaningful:**

```sh
ssh afezzardi@100.108.76.12 'docker logs kb-vllm-chat-fp8 2>&1 | grep -iE \
  "mamba cache mode|prefix caching in mamba|Maximum concurrency|enable_prefix_caching"'
```

| Check | Required |
|---|---|
| mode selected | `Mamba cache mode is set to 'align' ... when prefix caching is enabled` |
| feature on | `enable_prefix_caching=True` in the V1 engine config line |
| shape held | `Maximum concurrency for 131,072 tokens per request: N.NNx` — **must be ≥ 5** (`CHAT_MAX_NUM_SEQS`) |
| no preemption | `vllm:num_preemptions_total` stays `0` under load |

The shape check is not optional. Enabling caching sets `mamba_block_size` to `block_size`, which
moves the KV allocation. Your own handoff records two occasions where an engine came up `healthy`,
passed 30/30 on smoke, and was serving a third of the intended concurrency. **The boot line is the
only signal.** If it drops below 5, revert or lower `CHAT_MAX_NUM_SEQS` deliberately.

**Measurement** — run the identical task twice and compare:

```sh
pnpm dsh --profile headless "Read package.json and report the exact version field."
# and again, verbatim
ssh afezzardi@100.108.76.12 'docker logs --since 5m kb-vllm-chat-fp8 2>&1 | grep "Prefix cache hit rate"'
```

Also check whether `prompt_tokens_details.cached_tokens` survives the `/engine` passthrough — capture
with `recproxy.py` and read the response usage.

**Decision.** Real hits on the second step of a tool chain (where the prefix is the whole prior
conversation) → keep it, and demote D3. Zero hits → remove the flag and record the measurement, so
the question is closed with evidence instead of a comment. Expect the possibility of zero: there are
open upstream reports of align mode producing no hits for hybrid agent prompt layouts.

**One decision rides on the outcome.** `preserve_thinking: false` in the route was justified by this
deployment being unable to reuse KV cache, which makes Qwen's own reason for the `true` default void.
Real hits restore that reason, so re-decide the flag instead of inheriting it.

**Watch for:** `align` mode is experimental in vLLM's own words. Any correctness oddity — a wrong
answer on a repeated prompt, a tool call that doesn't match its arguments — revert immediately and
do not debug around it.

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

Reproduce the hang, then bound it. Watch `vllm:num_requests_waiting` during the run — persistently
non-zero means requests are dying of queueing, not slowness.

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

**`--long-prefill-token-threshold`** (default `0` = disabled). Worst-case TTFT for an admitted
request is `--max-num-seqs` × its own prefill, because one prefill takes ~8,191 of
`max_num_batched_tokens` every step. At 4,096 a short tool-result turn stops waiting behind a 130k
prefill, at the cost of long prefills taking roughly twice as long. This workload has both shapes,
so it is a real fairness dial. Measure with mixed short/deep concurrent requests.

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
