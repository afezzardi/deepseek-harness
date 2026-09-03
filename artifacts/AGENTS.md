# AGENTS.md — artifacts/

Fork-local deployment record for running DeepSeek Harness against the self-hosted Qwen3.8-27B
stack. **Nothing in this directory is upstream material.** It documents one deployment, the
configuration that serves it, and the experiments that verified it.

Root [AGENTS.md](../AGENTS.md) still governs everything under `packages/`. It does not list this
directory among its scoped `CLAUDE.md` locations, deliberately: editing that file would conflict on
every upstream sync.

## Start here

[NEXT-SESSION.md](NEXT-SESSION.md) — the ranked experiment queue with exact commands, boot gates,
and pass/fail criteria. Then [README.md](README.md) for what each asset is the only home for.

## Reference repositories

Both live on `srvhapeda`, outside this checkout. **Reach them by IP, not by the `~/.ssh/config`
alias** — that alias resolves to a LAN address that times out:

```sh
ssh afezzardi@100.108.76.12        # works
ssh srvhapeda                      # times out (192.168.205.25)
```

| Path on host | What it holds |
|---|---|
| `kb-mastra-infra/` | The live stack. `docker-compose.yml` (engine flags, arms, shape), `litellm/config.yaml` (gateway, model aliases, the `/engine` passthrough), `HANDOFF.md` and `README.md` (measured TTFT, ITL, KV sizing, boot-shape traps), `HOW-TO.md` (the consumer contract), `scripts/measure-ttft.py` |
| `inference-realworld/` | A prior Mastra-based harness against the same model. `LESSONS.md` (imperative-titled failure modes), `harness/mastra-qwen38-realworld/src/adapter.mjs` (the two sampler profiles, and twelve client-side workarounds with what each works around), `results/*/**.wire.json` (recorded request bodies) |

The engine's own installed source is reachable and is the authority over both repos' prose:

```sh
ssh afezzardi@100.108.76.12 'docker exec kb-vllm-chat-fp8 bash -c "grep -n ... /usr/local/lib/python3.12/dist-packages/vllm/..."'
```

## Read the inference host, do not change it

**`kb-mastra-infra` has its own owner and its own agent. Read it freely — measure, grep the installed
engine source, scrape `/metrics`, run probes against the endpoint — but do not edit its files or
restart its services.** When a measurement implies an inference-layer change, hand over a prompt
instead: state what is already applied and must only be verified, the exact edit, the measured
justification with numbers, the boot and load gates that must pass, the rollback, and the traps that
would produce a false pass. That handoff is the deliverable, not the edit.

**`kb-mastra-infra/MESSAGE.md` is the two-way channel with that owner, and it is the one file there we
write.** It was restructured on 2026-08-21 into a strict question/reply schema — **re-read it from the
top, never diff it against an older copy.** Protocol, set by them: it carries questions and replies and
nothing else; answer inline on the `REPLY:` line; never renumber, reword or delete a question; `Q`
numbers are global and permanent; append rather than whole-file write, because one round was lost that
way. Reference a section of the record, never restate it. **An answer that only lives in MESSAGE.md has
not been adopted** — conclusions that survive move into their `docs/TUNING.md`, `README.md`,
`docker-compose.yml` or `.env`. Round 7 (ours) is on the host as of 2026-08-21; our Q17 is open there.

`kb-mastra-infra/docs/TUNING.md` is the record, and its **§6 is the single retraction ledger for both
sessions**. Check a mechanism claim against it before writing one down: four of ours are in there.

Editing MESSAGE.md needs care, because a sequential find-and-replace re-matches inside text it just
inserted and silently misaligns every answer. Do it as one anchored pass: assert the file's hash first,
require each target line to read exactly `REPLY:`, apply insertions bottom-up, then diff to prove only
the reply lines changed and that each reply sits under its own `## Q` header.

Harness-side configuration (`$DSH_HOME`, this checkout) stays ours to change directly.

## Verification discipline

- **Prefer the installed artifact over any document, including these.** This session found two
  claims contradicted by the running engine: that the checkpoint cannot prefix-cache, and that
  patching the chat template could fix the reasoning round-trip. Both were written down in more than
  one place and neither survived reading `vllm/` inside the container.
- **A passing run is the failure mode to expect here.** Every defect found so far returned HTTP 200
  with billed tokens and no error line. Check `finish_reason`, and reconstruct from the decoded
  session log rather than from stdout.
- **The wire is only visible through `recproxy.py`.** The session log records model-visible content
  only — no sampling, no `chat_template_kwargs` — and the gateway runs `set_verbose: false`.
- **Session logs are concatenated zstd frames.** A single-frame decode returns the header and looks
  like an empty log; use `read-session-log.mts`.
- **Distinguish measured from reasoned in anything you add here**, the way the reference repos do.
  Every document here that carries a mechanism claim says which parts are unproven; keep that.
- **A number with no persisted artifact is not a measurement.** The probes print to stdout and save
  nothing, and four published reuse figures were purged for exactly that (`TUNING.md` §6 row 18).
  Redirect a probe to a file and cite the file, or do not quote the number.

## Live configuration

`$DSH_HOME` (`~/.dsh`) sits outside this checkout, so `dsh-settings.yaml` and
`dsh-cordis.patch.yml` here are the durable record. **They drift the moment the live files change** —
re-sync them in the same change, and never commit a credential value (routes name
`apiKeyEnv: LITELLM_MASTER_KEY`; the value lives in `./.env`, gitignored).

Two mechanics that cost a boot if forgotten:

- A patch entry's `config` **replaces** rather than merges — `applyEntryPatches` assigns per
  top-level key — so restate the whole config block.
- A source-plane run needs the `typert` rows disabled or a completed `pnpm run build`;
  `typert-loader` resolves built `lib/typert.host.js` artifacts.

## Our instruments import product source

Two instruments import from `packages/` by relative path, and that coupling is invisible to upstream:
nothing under `packages/` references `artifacts/`, so a sync can withdraw an export with **no merge
conflict at all** and the break surfaces only when the instrument is next run. Re-check every target
below at each upstream sync — the list is kept short on purpose.

| Instrument | Product import |
|---|---|
| `harness-tests/metrics.mts` | `core/session/src/chunk-rows.ts` → `decodeStorageRecord`; `llm/llm/src/types.ts` → `StreamChunk` (type only) |
| `read-session-log.mts` | `session/session-persistence-jsonl/src/zstd.ts` → `scanZstdFrames`, `decompressZstdFrame` |

`harness-tests/check-case.mts` and `check.sh` import node builtins only, and the probes reach the
endpoint over HTTP, so neither is exposed to a product refactor.

**Import a service, vendor a predicate.** `decodeStorageRecord` is imported because the packed-row gap
arithmetic and the `MIN_RUN` threshold must not be restated here. `isTokenDelta` is vendored into
`metrics.mts` instead: `session-stats` keeps it private and upstream's own client projections each
carry a copy, so importing it buys coupling without buying authority. `0.1.2-rc.1` carries no such
export on `llm/llm/src/message.ts`, and an import of it would take `metrics.mts`, `check.sh` and the
four log-level UAT cases down together. When a vendored copy mirrors a product predicate, name the
authoritative module in its JSDoc so the two can be compared at a sync.

## Documents supersede, they do not get rewritten

Each report carries a status header naming which of its parts are superseded and which remain
authoritative. When a finding is overturned, add the correction and flag the original in place —
do not silently edit a published claim, and do not delete a document that is still the only home for
something. Check inbound references before removing anything.

## Git

Work on `fork/qwen38-deployment`. **Never commit to `master`** — it is a pristine mirror of
`upstream/master` (`deepseek-ai/deepseek-harness`), and committing there breaks fast-forward
fork-sync. `upstream`'s push URL is deliberately disabled.
