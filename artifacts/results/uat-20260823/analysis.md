# UAT run of 2026-08-23, session 2 (partial) — analysis

Blocks B5 and B6 of [UAT.md](../../UAT.md), run on the `0.1.1-rc.2` rebase. Verdicts live in that
file's results table and are not restated here; this document holds what the logs say that the screen
could not.

Nine sessions, 14 turns, 33 steps, 33 tool calls, recorded between 17:18 and 17:47. Four are
top-level conversations and **five are subagent or workflow children** — the first child sessions this
deployment has ever produced.

| File | What it holds |
|---|---|
| `sessions.jsonl` | `metrics.mts` fold of all nine sessions, one JSON object each |
| `../engine-metrics-20260823-171755.jsonl` | The engine counter series across the sitting |

Tools exercised for the first time: `subagent` (3 calls), `workflow` (1) and `skill` (1) from the
mounted set, plus `report` (1) and `structured_output` (3), which are subagent-side and not part of
the 25 the main agent carries. Cumulative coverage rises to **10 of 25 mounted tools**, from 7. The
fifteen still never invoked are `create_goal`, `exit_plan_mode`, `get_goal`, `interrupt_agent`,
`job_kill`, `job_list`, `job_output`, `list_agents`, `ralph`, `read_image`, `send_message`,
`str_replace_editor`, `subagent_fork`, `update_goal` and `web_search`.

## Delegation works, and the fan-out is real at the engine

Case-to-session mapping, with child start times taken from the decoded logs:

| Case | Parent | Children | Child start times |
|---|---|---|---|
| B5.1 | `session-0be73fb4` turn 1 | `1052b970` | 17:28:17.650 |
| B5.2 | `session-0be73fb4` turn 3 | `1682af9d`, `f9f6ace8` | 17:30:41.035, 17:30:41.**037** |
| B5.3 | `session-fb09ed33` | `f4fcab77`, `6b3ee4ab`, `5f58855b` | 17:33:21.147, .161, .172 |

**B5.2's two children started 2 ms apart and B5.3's three within 25 ms.** They are genuinely
concurrent, not serialised. The engine series confirms it independently: `num_requests_running` peaked
at **3** during the B5.3 window, the highest concurrency ever recorded on this deployment — the
previous maximum across all sessions was 2, and that was an auxiliary titling call overlapping main
step 1.

Wall times: B5.2 ~86 s end to end (16 s parent deliberation, children 26.5 s and 46.8 s in parallel,
23 s to compose the comparison); B5.3 ~40 s (19 s, then three 12-13 s children, then 8 s).

## Every delegated result was checked against the repository, and three of four hold exactly

The known failure mode here is a confident wrong answer, so each delegated claim was re-derived from
the working tree rather than accepted.

| Claim | Source | Ground truth | Verdict |
|---|---|---|---|
| 5 markers under `packages/llm`: 4 TODO, 1 XXX, 0 FIXME | B5.1 child | 5 matches across all file types — 1 XXX, 2 source TODO, 2 README TODO references | **exact** |
| Three largest `.ts`: `llm-deepseek/tests/adapter.spec.ts` 83,773 B, `llm-pi-ai/tests/catalog.spec.ts` 54,312 B, `llm/tests/service.spec.ts` 50,764 B | B5.3 workflow | identical, and in that order | **exact** |
| None of the three has a module-level JSDoc; each opens with an import | B5.3 workflow | confirmed on all three first lines | **exact** |
| Largest *source* file is `llm/src/index.ts` at 44,877 B | B5.3, volunteered | 44,877 B | **exact** |
| `packages/llm` has 5 packages; READMEs are 17 and 52 lines | B5.2 children | 5; 17 and 52 | **exact** |
| `packages/session` has **12** packages in four sub-groups | B5.2 child | **13** — the README's Titles table lists four rows, and the summary named three | **off by one** |

The single error is an omission of `session-title-llm` from the Titles group. It is a summarization
undercount, not an invention: every package the child did name is real and correctly placed. That
distinguishes it from B4.2's fabricated read, where the cited file, line count and line number were
all fictional.

B5.3 deserves its own note: the parent volunteered that the three largest files are all test specs
and offered the largest source file as a follow-up. That is the opposite of the B4.2 behaviour —
here it added a caveat that made its own answer less impressive but more useful.

## The subagent runs in the background, so the parent answers in a later turn

B5.1's parent dispatched the child and closed its turn with *"I'll summarise what it finds once it
reports back."* The child's completion arrived 60 s later as an `agent/inbox/spliced` event carrying
its closing message, which opened turn 2, where the actual summary was produced. Eight
`agent/inbox/spliced` events appear across the conversation.

So the case's expectation — *the parent's answer uses the child's findings* — is met, but not within
the turn that delegated. Anyone scripting against this should not expect a single-turn round trip.
One redundant step followed (turn 2 step 2 restated the summary on seeing the raw notice), which is
cosmetic noise rather than a defect.

## Interruption and resume both hold, across a real process restart

`turn/end` for the first turn carries `reason: {kind: "aborted", reason: {kind: "user"}}` at 17:35:37,
after 7 steps and 45 s. The partial answer is retained in the log in full, and the next two turns
completed normally with context intact.

B6.3 was run twice, and the two runs test different halves:

| | Mechanism | Evidence |
|---|---|---|
| Browser reload (Ctrl-R), turn 3 at 17:36:14 | client rehydration | Server process untouched (up since 17:17:59), 8.4 s after turn 2 |
| **Process restart, turn 4 at 17:46:37** | **resume from the durable log** | Old PID 54278 replaced by **71923 at 17:46:19**, relaunched with the same `--patch web-typert.yml`; the conversation reopened from the sidebar and **appended to the same session file** |

The restarted run is the load-bearing one. Turn 4 asked the same question and recalled the arc
correctly — both the detailed pass and the shortened one — and named the sources it had explored:
`agent.ts`, `index.ts`, `tool-calls.ts`, `runtime-context.ts`, the Inbox, and the architecture docs.

**Every one of those claims checks out against turn 1's tool calls**: `agent-loop/src/index.ts`,
`agent.ts`, `tool-calls.ts`, `runtime-context.ts`, `packages/core/agent/src/inbox.ts`, and
`docs/subsystems/core.md` read through bash. That matters beyond B6.3 — it is the same provenance
claim B4.2 fabricated, made here after a process restart, and this time it is accurate to the file.

## The engine remains far from any limit

Whole sitting, from the counter deltas:

| | |
|---|---|
| prefix cache | 465,696 hits / 632,991 queries = **73.6%** |
| preemptions | **0** |
| samples with any request queued | **0** (`num_requests_waiting` max 0) |
| peak concurrent requests | **3** |
| peak KV usage | **8.0%** |
| tokens | 632,991 prompt, 12,189 generated |

Reuse is **73.6% against 89.9%** on 2026-08-21. The drop is structural, not a regression: this sitting
was nine short sessions rather than one long interactive conversation, and every subagent child opens
a fresh prefix that it never gets long enough to amortise. Children ran 13,791-14,088 prompt tokens on
their first request — the shared 7,455-token prefix plus their own instructions — and finished in two
to four steps.

**The fan-out bound of 4 was never reached.** B5.3 requested three agents for three files and got
three. Nothing in this sitting justifies raising the bound; nothing contradicts it either, since no
case asked for more than three.

## What this changes for the deployment

Purge ledger A3 — `subagent` ×4, `tool-subagent*` ×4, `workflow*` ×2, `tool-ralph`, and ~1,800 tokens
of tool schema — was written against a path that had never run. **It now has run, correctly, at
three-way concurrency, with exact results.** The ledger's premise that these rows might be dead weight
no longer holds; dropping them would remove working, verified capability.

## Session 2 remainder

1. **B7.1** — the real-work block, now the only substantive case left.
2. **B3.3** — still never run; no `/etc/hosts` turn exists in any session log.
3. D7 remains unfixed and stayed latent again: no summarizing compaction fired in this sitting
   (0 compactions across all nine sessions, max prompt 45,368).
