# AGENTS.md — artifacts/

Keep this fork's configuration, instruments, plugins, and documentation under `artifacts/`. Authorized product corrections outside this directory require package documentation, an Agent Note, and an entry in [FORK-SOURCE-CHANGES.md](FORK-SOURCE-CHANGES.md); do not patch product files merely to maintain a local instrument. Read [NEXT-SESSION.md](NEXT-SESSION.md) for operational status and [README.md](README.md) for the inventory.

## Upstream updates

Before updating from `origin` or `upstream`, inspect the [source-change register](FORK-SOURCE-CHANGES.md). Recheck each listed correction against incoming provider/dependency behavior, preserve or explicitly retire it, and execute its regression even when Git reports no conflicts.

Work on `fork/qwen38-deployment`; keep `master` as the upstream mirror. Verify the fork-only diff before an update. A conflict-free sync does not prove that instruments still understand product events: inspect their current imports and run focused checks against the selected revision.

Use upstream session-query and format services for session reads. The gh-genai-traces plugin supplies current tracing and replay; historical V2-only scripts are available in Git history. Use a fresh session for deployment acceptance testing. Do not modify stored Session generations to make them appear current. The product's migration rules still govern product-owned data.

## Configuration

[dsh-settings.yaml](dsh-settings.yaml) and [dsh-cordis.patch.yml](dsh-cordis.patch.yml) are the versioned copies of settings under `$DSH_HOME` (default `~/.dsh`). Keep runtime copies in sync when deploying a configuration change and verify equality. Never commit credential values; routes reference `LITELLM_MASTER_KEY`, supplied through the environment or the ignored root `.env`.

## Verification

- Verify model and tool behavior from the decoded session log as well as the final answer. Record failures, partial results, and skipped checks explicitly.
- Read sessions through upstream services; do not reimplement compression or released format decoding in local plugins.
- Use [recproxy.py](recproxy.py) when verification needs actual request sampling or reasoning fields.
- Persist probe output before publishing numbers. Distinguish current measurements from hypotheses and dated evidence.
- Keep current docs concise and correct. Remove superseded instructions and misleading assets; check inbound references when deleting a file. Historical results describe their own run, not current deployment guarantees.

## Inference host ownership

The reference repositories `kb-mastra-infra/` and `inference-realworld/` live outside this checkout on `srvhapeda`; the recorded SSH address is `afezzardi@100.108.76.12`. Verify current reachability and host state before describing them as live.

The user owns inference as well as this harness. Read the host documentation and installed source before changing inference. Tell the user the concrete change and its purpose before applying configuration changes or restarting services; existing task authorization determines whether the action may proceed. Read-only inspection and authorized endpoint probes need no separate confirmation. Sending messages through another service requires explicit authorization.
