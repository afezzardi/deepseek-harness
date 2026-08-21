# UAT run of 2026-08-21, session 1 — analysis

Blocks B0-B4 of [UAT.md](../../UAT.md). Verdicts live in that file's results table and are not
restated here; this document holds what the logs say that the screen could not.

Six sessions, 25 turns, 84 steps, 100 tool calls. Nineteen cases recorded: 14 PASS, 3
PASS-WITH-NOTE, 1 FAIL, 1 NOT RUN (B3.3 — no `/etc/hosts` turn exists in the log).

| File | What it holds |
|---|---|
| `sessions.jsonl` | `metrics.mts` fold of all six sessions, one JSON object each |
| `checks.txt` | `check.sh` output for B1.4, B3.1, B3.2, B4.1 |
| `token-trace.txt` | Every model request's prompt size against the compaction events |
| `../engine-metrics-20260821-151529.jsonl` | The engine counter series across the sitting |

Tools exercised: `read` 51, `bash` 31, `grep` 7, `write` 5, `todo_write` 4, `edit` 1, `glob` 1 —
**7 of 25 mounted tools**, up from 3 before this sitting. `B1.1` was run in the web UI as turn 2
rather than headless, so B1.1's headless arm is still unexercised; B1.2-B1.5 cover that path.

## D7 — in the web profile the compaction summarizer runs on the thinking route

`compaction/summary` for the manual `/compact` carries `provider: local-qwen, model: chat-model,
maxTokens: 8192`, with 75,373 input and 2,501 output tokens. It should be `local-qwen-off`.

The cause is a plane mismatch, not a wrong value:

1. `packages/bundle/web-app/cordis.patch.yml:379` disables host-plane `compaction-basic`
   deliberately — the token meter stays host-plane, the compaction backend moves to the per-session
   preset.
2. The shipped preset (`apps/cli/config/agent-presets/*/agent.cordis.yml`, the `id: compaction`
   group) mounts `compaction-basic` with **no config block**.
3. `~/.dsh/cordis.patch.yml` patches the host-plane row, which is the disabled one.
   `dsh --profile web --dump-config` shows exactly that: `compaction-basic … disabled: true` with
   our `thresholdRatio`/`summarizationProvider`/`summarizationModel` attached to it.
4. `summarizeWithLlm` therefore resolves `configured ?? latest ?? agentTarget`
   (`packages/compaction/compaction-basic/src/summarizer.ts:129-138`) to `latest` — the session's own
   thinking route — with `maxTokens` at compaction-basic's default 8192.

**D1b is fixed in headless and unfixed in web.** The fail-closed path is live there: the reasoning
block competes with the summary for the 8,192-token cap and `finishError` throws `summarization
truncated at the token cap (incomplete checkpoint)`, at exactly the moment the session is at its
ceiling and compaction is the only way forward. This run used 2,501 of 8,192 and survived.

`thresholdRatio: 0.8` is lost the same way and harmlessly: 0.8 is `DEFAULT_THRESHOLD_RATIO`
(`compaction-basic/src/config.ts:20`). Titling is unaffected — `session-title-llm` stays host-plane,
and the log confirms `provider: local-qwen-off` with `source: {kind: provider}`.

**Fix path**: the two summarization fields must sit in the preset that mounts the backend, not in the
home patch. `agent-presets` resolves locally authored presets from `<dshHome>/.agent-presets`
(`packages/preset/agent-presets/src/discovery.ts:41`), so a user preset carrying the shipped rows plus
those two fields is the change that does not conflict on upstream sync. Confirm which preset the web
session mounts before copying it. Requires a web restart, and E2 afterwards.

## The model fabricated a read, in the block designed to catch it

B4.2's third prompt asked it to read `packages/AGENTS.md`. It called no tool and answered:

> I read [packages/AGENTS.md](packages/AGENTS.md) earlier in this session (44 lines), so I'm working
> from that read rather than re-opening the file. The invariant rules are short — a single line at
> line 45 …

Three claims, all false: it never read that file (the only `AGENTS.md` it read is
`artifacts/AGENTS.md`, turn 1 step 2), `packages/AGENTS.md` is **27 lines**, and a 27-line file has
no line 45. The substance of the answer is roughly right, which is what makes it dangerous.

The contrast inside the same conversation is the finding. **B2.3 asked directly about read
provenance and the answer was exemplary**: it separated its four full reads from its seven
`limit`-truncated ones, gave correct line counts for both groups, and volunteered that it could not
speak to the seven bodies. Asked about provenance it is precise; offered a chance to *skip* work by
citing memory, it invents the memory. That distinction is what cycle 2 should probe.

## Cache hit renders 0% when the provider reports nothing

The engine served **89.9% of prompt tokens from cache** during the sitting — 3,932,544 hits of
4,374,585 queries, from the counter series. The UI's stats line read `Cache hit 0%`.

`cacheHitPercent` (`packages/client/ui-conversation/src/client/chat/StatsLine.tsx:131`) divides
`usage.cacheReadTokens` by billed input. `llm-pi-ai` emits that field only when the provider reports
a non-zero value (`packages/llm/llm-pi-ai/src/stream.ts:26`), and vLLM's OpenAI-compatible response
carries no `prompt_tokens_details.cached_tokens` — all 65 usage records in the web session hold
exactly `inputTokens` and `outputTokens`.

So `0%` is how "this provider reports no cache data" renders, and it is indistinguishable from a
genuine total miss. Worth an upstream issue: a provider that reports nothing should render `—`.

## Automatic relief is the pruner, and it is invisible

Two drops, both in `token-trace.txt`:

| Event | Prompt tokens | Share of the 114,688 ceiling |
|---|---|---|
| manual `/compact` (seq 20286) | 75,406 → 16,057 | 65.7% → 14.0% |
| five `compaction/prune` (seq 44328-44336) | 101,202 → 72,636 | 88.2% → 63.3% |

The prunes are model-free single-node replacements — 12,496 + 8,107 + 2,266 + 5,753 + 4,930 = 33,552
tokens — and they fired at 101,202, keeping the prompt below the 104,857 threshold where the
summarizer would take over. **Automatic summarizing compaction never ran**, which is why D7 stayed
latent rather than failing the session.

Neither `compaction/prune` nor its replacement is rendered as a tool call, and the conversation-node
matcher covers `compaction/start`/`summary`/`end` only, so the operator sees the context meter move
with no explanation. That matches what was reported from the screen.

## The workload is no longer the one the config was tuned against

| | 15 headless sessions | this web session |
|---|---|---|
| prompt tokens p50 / max | 13,729 / 19,403 | **69,959 / 101,202** |
| turns / steps | 1 / ≤8 | **19 / 65** |
| tool calls | ≤4 | **83** |
| output tokens, max | 961 | **5,674** |

101,202 against a 104,857 compaction threshold and a 114,688 admission ceiling: interactive use
reaches what headless never approached, so the `maxTokens: 16384` / `thresholdRatio: 0.8` pairing is
now load-bearing rather than precautionary. Largest single output rose to 5,674 tokens, still a third
of the 16,384 cap.

The engine was never stressed: **0 preemptions, 0 samples with any request waiting, at most 2
concurrent requests, KV usage peaking at 15.4%.** The fan-out bound of 4 and the declined
`--max-num-batched-tokens` change both remain over-provisioned in the harmless direction.

## Instrument changes made during the sitting

`metrics.mts` timing fields now come from `sessionStats`' definitions rather than approximating them,
and packed chunk rows expand through the product's `decodeStorageRecord`. Verified two ways: the E2
golden session reproduces every non-timing field exactly, and the 4-token session that reported zero
TTFT now reports 2,546 ms. Cross-check against the product's own projection on this session: 44.7
tok/s from the fold against the UI's 45, and 1,669 ms mean TTFT against its 1.5 s. The UI's
`LLM 13m39s` is the post-compaction window; the whole log is 23m38s.

`check.sh` was added for the four cases a screen cannot adjudicate, and two defects in it surfaced
against real logs: it assumed one case per session, where B3.1, B3.2 and B4.1 share one conversation,
and it asserted a structured error for a denial when a rejected escalation carries `isError: true`
with `error: null`.

## Session 2 queue

1. Apply the D7 preset fix, restart web, re-run E2.
2. B3.3 (never run), then B5-B7.
3. Re-run B4.2's third prompt after the fix, to see whether the fabricated-read behaviour reproduces.
