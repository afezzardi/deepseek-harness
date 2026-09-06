# Local reasoning-effort slider

English | [中文](README.zh.md)

A Web composer control for the reasoning levels declared by the selected model's provider. The native model picker remains available, and both controls use DSH's resident `ModelDirectory`. Selecting an effort preserves the provider and model IDs and records the selection through the existing Host API.

This is a private, checkout-local implementation for DSH `0.1.3-alpha.1`, inspected against upstream commit `d347e703908d0406b7a7ef80e3a0e594d86b2215`. DSH APIs are pre-stable: rerun the checks below after an upstream update. This directory is intentionally outside the root workspace.

Contents: [build and run](#build-and-run), [interaction](#interaction), [source map](#source-map), [verification](#verification), [scope and provenance](#scope-and-provenance). Read [DESIGN.md](DESIGN.md) for the mechanics and maintenance decisions.

## Build and run

Run these commands from the repository root with the checkout's dependencies installed. The local TypeScript program references upstream projects, so their declaration outputs must already exist; the normal upstream build prepares them. The plugin build itself emits only this directory's ignored `lib/`.

```sh
node artifacts/plugins/effort-slider/setup.mjs
node artifacts/plugins/effort-slider/build.mjs
pnpm exec tsc -p artifacts/plugins/effort-slider/tsconfig.json
pnpm exec vitest run --config artifacts/plugins/effort-slider/vitest.config.ts
```

`setup.mjs` links React and its test/type dependencies from this checkout into ignored local `node_modules/`. It downloads nothing and refuses to overwrite a different dependency. `build.mjs` uses the root toolchain to emit a Host ESM entry, a browser module factory, its source map, and `lib/overlay.yml`. Rebuild after moving the checkout: the overlay contains an absolute module path because DSH resolves plugin entries from the profile directory.

To add the plugin to a Web launch using this fork's configured home:

```sh
pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --no-open
```

The first overlay enables the Typert services disabled by this fork's home patch. The second loads this plugin. Launch through `dsh`; `lib/index.js` is a plugin entry, not an application. Restart the Web process and reload the page after rebuilding so the browser receives the new module. Omit the second overlay to remove the plugin from subsequent launches. Building does not install it into your default profile.

For an isolated acceptance run, use a new temporary home and workspace:

```sh
effort_test_home=$(mktemp -d /tmp/dsh-effort-home.XXXXXX)
effort_test_workspace=$(mktemp -d /tmp/dsh-effort-workspace.XXXXXX)
cp artifacts/dsh-settings.yaml "$effort_test_home/settings.yaml"
cp artifacts/dsh-cordis.patch.yml "$effort_test_home/cordis.patch.yml"
DSH_HOME="$effort_test_home" pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --host 127.0.0.1 --port 0 --no-open
```

Open the printed local URL and choose the temporary workspace. Keep the URL's authentication token private. These settings still point to the configured inference service; sending a prompt makes a real request. Credentials retain their environment-variable references and are loaded by the existing launcher.

## Interaction

Open **Effort** beside the composer controls. Dragging previews a provider label; releasing the pointer submits one selection. Arrow keys, Home, End, and Page Up/Down use the browser's native range behavior and submit on key release. Enter submits a changed draft. Escape closes the panel and returns focus to its trigger. Pointer cancellation or leaving an unsubmitted range discards the draft.

The trigger displays the shared effective selection, not an optimistic draft. While a selection is pending, the range is disabled. A failed selection resets the draft and exposes an error. The shared directory supplies catalog errors and retry state. Changes made in the native picker are reflected here, and successful selections survive reload through DSH's session projection.

The range appears only when the Host reports a routable selection, the selected model advertises at least two efforts, and its effective effort matches that list. An omitted effort uses the provider's declared default. An unknown effort, missing default, single-level catalog, or unavailable route does not produce invented slider positions. Addressed subagent sessions expose no control.

Positions preserve provider order and IDs. They are discrete choices; equal spacing does not imply a numerical token budget or equally spaced compute costs. With this fork's Qwen settings they are `off`, `low`, `medium`, and `xhigh`. `off` has meaning because the provider explicitly declares it. The control does not add an `off` level to other providers.

## Source map

| File | Responsibility |
|---|---|
| [src/index.ts](src/index.ts) | Empty Host plugin entry for client discovery |
| [package.json](package.json) | Module exports and Web client dependency ordering |
| [src/client/index.ts](src/client/index.ts) | Service requirements, locale/style disposal, session slot registration |
| [src/client/EffortSlider.tsx](src/client/EffortSlider.tsx) | Shared state subscription, local preview, commit and failure behavior |
| [src/client/locales.ts](src/client/locales.ts) | Typed English and Chinese UI copy |
| [src/client/style.css](src/client/style.css) | Styling scoped to the plugin's own elements |
| [build.mjs](build.mjs), [setup.mjs](setup.mjs) | Checkout-local build and dependency setup |
| [tests/slider.spec.tsx](tests/slider.spec.tsx) | React interactions using isolated directory stores |
| [tests/bundle.spec.ts](tests/bundle.spec.ts) | Built factory loading and real Cordis/slot teardown |

## Verification

Build before running tests: the bundle smoke deliberately reads `lib/client.js`. The TypeScript check covers source and tests. The interaction tests exercise preview versus commit, exact provider IDs, failure recovery, duplicate submission, external selection, cancellation, focus, subagent exclusion, and unmount during a request. The bundle test permits only the expected shared React imports and verifies removal of the slot, style element, and locale registration on disposal.

For browser acceptance, create a fresh session before the native picker has initialized its model directory. Change effort, compare the native picker, reload, then change the model through the native picker and inspect the slider again. Check keyboard interaction, Escape, and narrow-window layout. Decode the session log with [read-session-log.mts](../../read-session-log.mts); the selection must appear as the existing model-selection event. Use [recproxy.py](../../recproxy.py) with a temporary settings copy when checking actual inference fields. UI success alone proves neither request serialization nor engine behavior.

See [VALIDATION.md](VALIDATION.md) for executed checks and their limits. The local plugin is not included in upstream's root test discovery or coverage gate; run its explicit commands.

## Scope and provenance

The [community slider](https://github.com/2768651338/dsh-effort-slider), inspected at `b95d997a787ddfc2dfe05e167f59229ccd8bafb2`, supplied the feature idea. Its inspected implementation used an older session API and automatic adapter provisioning. This implementation uses current typed extension points and performs no settings migration, provider registration, adapter wrapping, or interception of native picker DOM. Original license and notice files are retained in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The [review](../../results/plugin-review-20260906/EFFORT-SLIDER.md) records the upstream findings.

The plugin selects the next model request's effort. An already constructed request is unaffected. The provider owns serialization, and the inference server owns whether a given level changes computation. The left composer slot supplies no native model-seat `locked` prop; this control uses directory availability and pending state, while Host selection rules remain authoritative. It does not promise native-seat locking parity for every inert or disconnected composer state.
