# DeepSeek Harness: consolidated foundation assessment

Date: 2026-08-20. Checkout: `141eb6fef8` on `master`, `0.1.0-rc.8`, tracked tree clean. Claims are
labelled **[V]** verified here, **[I]** inherited and survived falsification, **[U]** unproven.
`node_modules` was absent, so no gate, test, build, or model call was executed.

> **Status.** Read [NEXT-SESSION.md](NEXT-SESSION.md) first for current state.
>
> **Authoritative here, with no other home:** purge ledger A (§4) and ledger B (§5) — the row groups,
> their measured package/dependency/LOC effect, and the ordering constraints. Re-verified against
> `0.1.1-rc.1`: the three bundle `cordis.patch.yml` files are byte-identical to `0.1.0-rc.8` in row
> count and id set, so every ledger row still resolves.
>
> **Superseded:** the whole bring-up sequence and its candidate route — the live route is
> `dsh-settings.yaml`, whose comments carry the wire-level rationale for every field that was
> corrected, and the endpoint checklist is executed as `probes/`. Ledger A4's `session-title*` row —
> titling is fixed rather than deleted, at one non-thinking request per session. Any claim that this
> checkpoint cannot prefix-cache — `kb-mastra-infra/docs/TUNING.md` §4 is the authority.

This is the decision layer over [foundation assessment](deepseek-harness-foundation-assessment.md) and
[plugins overview](deepseek-harness-plugins-overview.md). It supersedes their architecture narratives,
dependency figures, and staging advice; it does not replace them, because the overview remains the only
row-by-row inventory of all 138 composition rows and the foundation assessment retains the benchmark
matrix and the pi-ai risk register.

## 1. Verdict

The architecture is worth the investment; the repository around it is not, for this purpose. Those are
separable, and separating them is the whole finding.

**[V]** The framework is small: the vendored Cordis kernel is 2,693 lines across 9 files, 6,550 for all
of `vendor/`. The properties worth having — key-addressed services, reversible registrations,
patch-layered composition, an append-only session log — are in that kernel plus about a dozen core
packages.

**[V]** The bloat is elsewhere: 226 workspace packages (239,844 source lines), a test surface larger
than the product (285,875 lines), 219 doc files of which 107 are Chinese translations, ~728 Agent Notes
carried as English/Chinese/i18n triplets (2,176 files), 29 `verify-*` gates, 128 root npm scripts, 16 CI
workflows. That machinery publishes a bilingual multi-platform product with per-file 100% coverage. We
publish nothing.

**[V]** The decisive fact all three assets missed: **no fork or port is needed to compose an agent.**
Profiles live outside the repository at `$DSH_HOME/profiles/<name>`, hold their own `package.json` and
`cordis.patch.yml`, and resolve installation-first then profile-local
(`packages/boot/app-boot/src/profile.ts:1-24`, `:113-171`). A private composition is a directory of two
files, so calling it a "port" overstates the entry cost by orders of magnitude.

## 2. Corrections the ledgers depend on

From a since-retired adversarial review; the two high-severity ones were re-derived independently and
reproduced exactly.

| # | Prior claim | Corrected | Why it matters |
|---|---|---|---|
| C1 **[V]** | Minimum viable composition is "42 packages" | **67** (61 value-imported, 6 type-only) | The 42 was computed over `dependencies`; this repository declares non-optional `peerDependencies` the canonical runtime signal (`scripts/verify-runtime-closure.ts`, `docs/module-graph.md:6`). The 25 omitted packages are exactly the capability seams the providers extend, so the 42-package port does not build |
| C2 **[V]** | `shell` and `bash-local` are alternatives | Both **required** | `bash-sandbox` subclasses `LocalBashExecutor`; `shell` owns the `ctx.shell` key `tool-bash` injects. Labelling them `ALT` deletes shell execution from the minimum |
| C3 **[V]** | The profiles are "138 configuration rows" | 138 inserted rows **plus 30 id-targeted overrides** (0 Base / 3 Headless / 27 Web) | The Headless overrides carry the entire deployment persona (Base ships `persona: ''`) and the `tools.mode` opt-in. Build from inserted rows alone and the agent has no persona |
| C4 **[V]** | 11 external dependencies | **9** | `schemastery` is vendored; `node-addon-landlock-run` is the in-repo native family |
| C5 **[V]** | Deferring SQLite avoids native packaging | No such dependency exists | All three SQLite packages import `node:sqlite` |
| C6 **[V]** | A narrower subprocess provider removes `node-pty` and `koffi` | `koffi` survives | It is a direct dependency of four packages, three of which any composition keeps (`session-persistence-jsonl`, `fs-local`, `sandbox-windows-acl`) |
| C7 **[V]** | 233 workspace packages | **226** | 233 counts 7 generator fixtures below the workspace glob |
| C9 **[I]** | Build on `llm-pi-ai` | Correct, with an omitted risk | `.agents/notes/implemented/architecture/2026-06-13-twin-llm-adapters.md` reserves retiring one twin adapter through a superseding note. This deployment stands on the half marked retirable |
| C10 **[V]** | `docs/capability-seams.md` is a generated capability graph | Generated renderer over a **hand-maintained** table with 5 stale package names | Use `docs/module-graph.md`; it derives from manifests |

## 3. Measured cost of every plane

"Packages" counts workspace members under `packages/`; "closure" is `dependencies` plus non-optional
`peerDependencies`; LOC counts `.ts`/`.tsx` under each package's `src` and `tests`.

| Composition | Packages | vendor+native | external npm | src LOC | test LOC |
|---|---:|---:|---:|---:|---:|
| **[V]** Shipped headless (`dsh-base` + `dsh-headless`) | 124 (+1 with `app-boot`) | 8 | 25 | 109,336 | 153,382 |
| **[V]** Shipped web (`dsh-base` + `dsh-web-app`) | 171 | 9 | 32 | 181,451 | 221,721 |
| **[V]** Corrected minimum viable core | 67 | 6 | 12 | 57,022 | 89,832 |

**[V]** Headless carries **57 packages beyond the minimum**, and all of the Host/Web RPC plumbing enters
through **one Base row**: `typert-gateway` → `dsh-api-gateway`, chaining to `client-connection →
host-webserver / host-apiproxy → api-remotes, cordis-host-runner, workspace, agent-presets`. The imports
are **type-only** at both hops (`packages/api/gateway/src/index.ts:8`,
`packages/client/connection/src/index.ts:6`), so none of it executes headless — but all of it is in the
install, typecheck, and maintenance graph. This corrects the overview's Priority 1: deferring the Web
*layer* does not remove the Web *plumbing*; dropping the three `typert` rows does.

**[V]** Web adds +47 packages and +72,000 source lines over headless. `packages/client` alone is 40
packages and 74,362 lines.

## 4. Purge ledger A: composition-level, free and reversible

No repository edit — each row is removed or disabled in an own profile patch, measured against shipped
headless. Do these first; each is reversible in one line.

| # | Remove rows | Packages out | External npm out | src LOC out | Cost |
|---|---|---:|---:|---:|---|
| A1 **[V]** | `typert`, `typert-loader`, `typert-gateway` | **19** | `ws`, `fflate`, `js-yaml` | 26,552 | Loses the Typert RPC gateway. Highest ratio in the ledger, and **already applied** in `dsh-cordis.patch.yml`. **Headless-only — it breaks the web profile** (below) |
| A2 **[V]** | `pwsh-sandbox`, `tool-pwsh`; `session-telemetry-otel` | 4 | 6 × `@opentelemetry/*` | 1,763 | POSIX-only, no product analytics |
| A3 **[V]** | `subagent` ×4, `tool-subagent*` ×4, `workflow*` ×2, `tool-ralph` | 11 | — | 9,883 | No delegation or orchestration tools, and removes ~1,800 tokens of tool schema. Second rationale in NEXT-SESSION.md E4 — re-run the E2 gate first, since A3 is one of the purges the gate exists to protect |
| A4 **[V]** | `attachment-local`, `session-query*`, `session-title*`, `goal*`, `jobs*`, `plan-mode`, `web*`, `tool-web`, `commands`, `user-questions`, `command-*`, `skill-badge`, `llm-deepseek`, `anonymous-user-id` | 23 | `sharp`, `turndown`, `@joplin/turndown-plugin-gfm`, `eventsource-parser` | 14,116 | Text-only, no session search, no titles, no slash commands, no live web. Lands exactly on the 67-package minimum |

Cumulative: **124 → 67 packages, 25 → 12 external dependencies, 109,336 → 57,022 source lines.**

**A1 is headless-only, measured 2026-08-21.** Dropping the three `typert` rows makes the **web profile
boot a broken client tree**: `dsh-client-runtime` injects `typert` and is what provides `remote` and
`slots`, so all 37 client UI rows cascade into `pending` behind it and the browser shows "Failed to load
plugins". The server still answers HTTP 200 — Cordis `inject` waits rather than failing — so nothing
server-side reports a problem. This is purge ledger A's silent-removal hazard, caught in the wild rather
than in theory. `artifacts/harness-tests/patches/web-typert.yml` re-enables the rows as an overlay for
web runs, keeping the purge for headless; verified to restore the full UI.

Three further constraints. **[V]** Keeping the headless `code-runtime` row keeps `@babel/code-frame` and
`picomatch`. **[V]** Every removal is silent — `inject` waits rather than asserts, so a composition
missing a provider boots cleanly, prints no error, and quietly lacks the capability — so `--dump-config`
plus one replay snapshot after each step is what makes the ledger safe. **[V]** Copy the Headless
bundle's three override operations into the profile patch (C3), or the agent has no persona.

## 5. Purge ledger B: repository-level, one-way

These delete files. Do none of them until a composition runs and passes a snapshot; a broken gate is a
worse debugging position than a large repository. Ranked by volume removed per unit of risk.

| # | Delete | Volume **[V]** | Gates that complain **[V]** | Risk |
|---|---|---|---|---|
| B1 | Chinese translations and machinery: 107 `docs/*.zh.md`, 724 `*.zh.md` + 724 `*.i18n.yaml` under `.agents/notes`, `verify-translation-pairing`, `verify-translation-prompt`, `gen-translation-brief`, `merge-translation-pairing`, `dsh-translate-docs` | ~1,555 files | 2 verify gates, `doc-sync` | Very low. Nothing runtime reads them |
| B2 | `website/`, `docs:*` and `website:*` scripts, `docs-pages.yml`, `verify-doc-site-fragments`, `verify-public-repository-links` | 7 files + 2 gates + 1 workflow | `doc-sync` leaves | Very low. VitePress projection only |
| B3 | Release machinery: `scripts/release/*`, `publish:npm-baseline`, `publint-all`, `gen-third-party-notices`, `verify-dsh-package-licenses`, `release*.yml`, `python-release.yml`, `build-exe-for-python-sdk.yml`, `landlock-run-release.yml` | 6 workflows, ~8 scripts | `hygiene`, 3 verify gates | Low. Nothing is published. **Keep `knip`** — the only dead-code signal available |
| B4 | CI matrix breadth: keep one Linux job. Delete `sandbox.yml`, `check:windows-*`, `check:windows-wine`, `check-macos-deployment-target.py`, `e2b-e2e.yml` | 3-4 workflows of 16 | `run-gates.ts` aggregates | Low, and it removes the largest single source of process verbosity |
| B5 | Windows and macOS runtime support: `sandbox-windows-acl`, `pwsh-*`, `*/win32.ts`, seatbelt e2e, the `node-pty` patch; then drop `koffi` from four manifests (C6) | ~82 files, 4 packages | `verify-optional-dependency-imports`, `verify-runtime-closure`, `verify-package-invariants` | **Medium.** `sandbox-local` value-imports `sandbox-windows-acl` at module top level (`packages/sandbox/sandbox-local/src/index.ts:40`), so this is a code change to the sandbox provider, not a deletion. Do it last; keep the Linux Landlock path |
| B6 | Web plane: `packages/client` (40 pkgs, 74,362 LOC), `packages/host` (8), `apps/web` (247 files), `packages/api`, web test lanes | ~100 packages, ~110k LOC | `verify-client-*` ×3, web vitest configs | **Medium-high, irreversible.** Only once a browser surface is certainly unwanted. A1+A4 already remove it from the *runtime* at zero risk |
| B7 | `python/`, `native/`, `packages/e2b`, `packages/experimental`, `packages/hooks`, `packages/acp`, `packages/sdk`, ACP/JSON-RPC example fixtures (~3.7 MB) | ~15 packages, ~700 files | `verify-runtime-closure`, snapshot lanes | **High if done blind.** `native/landlock-run` is the Linux sandbox launcher — keep it. `examples/` snapshot fixtures are the only assembled-application regression evidence, so keep at least `examples/headless-agent` |

**[V]** The single largest verbosity reduction is not deletion at all: the per-file 100% coverage gate on
`packages/*/*/src` (`vitest.config.ts:177`) is why the test surface exceeds the product. Relaxing it
changes the marginal cost of every future change more than any deletion here, and it is a policy edit in
one file.

## 6. What must not be purged

Losing any of these converts the repository into an ordinary agent loop with extra indirection.

- **The three-role seam.** Never let a tool handler call a concrete provider — definition/provider/
  consumer is the substitution mechanism, and it is why `ctx.fs`, `ctx.shell`, `ctx.llm`,
  `ctx.sandbox`, `ctx.compaction` and the rest are swappable at all.
- **Registration-as-effect.** Every contribution through `ctx.effect()`/`ctx.on()` with a real
  disposer. This is what makes hot replacement and a rejected config reload safe.
- **Model-visible ⟺ logged.** Any new model-visible input needs a session event. This keeps experiment
  records valid across provider swaps.
- **Security decisions independently testable.** `sandbox`, `sandbox-policy`, `fs-sandbox`,
  `bash-sandbox`, `user-approval`, `permission-presets` may share a package, but the operation that
  enforces a decision must stay separately reachable by a test. Collapsing enforcement into tool
  handlers is the one merge refactoring cannot undo.
- **`invariants` and one assembled-application snapshot.** The only defenses against silent inactivity.
- **The Landlock path.** `native/landlock-run` plus `sandbox-local`'s Linux branch is the actual
  confinement on WSL2.

## 7. Still unproven

- **[U]** The transitive graph size of `@earendil-works/pi-ai@0.82.1`, and therefore the real saving
  from a narrow adapter. Requires an install.
- **[U]** That any gate, test, build, or snapshot passed at the time of writing; `node_modules` was
  absent.
- **[U]** The benchmark matrix inputs. The arithmetic and Pareto frontier are correct, but
  `fp8/medium` over `fp8/off` is a point-estimate preference whose 2.0-point margin sits inside the
  reported per-benchmark intervals (±0.8 to ±4.3). A starting default, not an established one.

## Appendix: reproduction

Run from the repository root. The closure figures traverse `dependencies` plus non-optional
`peerDependencies` from bundle-patch rows, and agree with `docs/module-graph.md`'s peer-edge closure.

```sh
find packages -mindepth 3 -maxdepth 3 -name package.json | wc -l            # 226
find packages -path '*/src/*' \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1    # 239,844
find packages -path '*/tests/*' \( -name '*.ts' -o -name '*.tsx' \) | xargs wc -l | tail -1  # 285,875
wc -l vendor/cordis/src/*.ts | tail -1                                      # 2,693
find docs -name '*.zh.md' | wc -l ; find docs -name '*.md' | wc -l          # 107 / 219
find .agents/notes -name '*.i18n.yaml' | wc -l                              # 724
ls scripts/verify-* | grep -v spec | wc -l                                  # 29

# rows and overrides, via a !!js-tolerant YAML loader over the three bundle patches:
#   inserts 78 / 3 / 57 = 138 ; overrides 0 / 3 / 27 = 30
# closures: base+headless 124/8/25 ; base+web 171/9/32 ; minimum core 67/6/12
#   the same roots over `dependencies` only -> 42, the prior assets' figure

# the one row that carries the Host/Web plumbing into headless
grep -n "dsh-client-connection" packages/api/gateway/src/index.ts           # import type, line 8
```
