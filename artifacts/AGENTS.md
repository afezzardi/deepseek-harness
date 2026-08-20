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
  Both HTML reports carry an explicit "still unproven" section; keep that.

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

## Documents supersede, they do not get rewritten

Each report carries a status header naming which of its parts are superseded and which remain
authoritative. When a finding is overturned, add the correction and flag the original in place —
do not silently edit a published claim, and do not delete a document that is still the only home for
something. Check inbound references before removing anything.

## Git

Work on `fork/qwen38-deployment`. **Never commit to `master`** — it is a pristine mirror of
`upstream/master` (`deepseek-ai/deepseek-harness`), and committing there breaks fast-forward
fork-sync. `upstream`'s push URL is deliberately disabled.
