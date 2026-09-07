# Fork-local plugins

English | [中文](README.zh.md)

These plugins live outside the pnpm workspace. Each plugin is built locally and enabled through its explicit profile overlay.

## Try the effort slider

From the repository root, build it after checkout or source changes:

```sh
node artifacts/plugins/effort-slider/setup.mjs
node artifacts/plugins/effort-slider/build.mjs
```

Stop your current Web process, then launch:

```sh
pnpm dsh --profile web \
  --patch artifacts/harness-tests/patches/web-typert.yml \
  --patch artifacts/plugins/effort-slider/lib/overlay.yml \
  --no-open
```

Open the printed URL, select a workspace/session, and click **Effort** beside the composer controls. Drag and release, or use the arrow keys. The native model picker should show the same effort. Existing deployment settings and credential environment variables still apply.

The first overlay enables this fork's Web RPC services; the second loads the slider. Include both on each launch. To disable the slider, restart without the second overlay. After changing plugin source, rebuild, restart Web, and reload the page.

## Reference

| Plugin | Purpose | Development reference |
|---|---|---|
| [gh-genai-traces](gh-genai-traces/README.md) | Inspect execution traces and evaluated examples in self-hosted Phoenix | Live capture, canonical replay, and a local Compose stack |
| [Effort slider](effort-slider/README.md) | Select provider-declared reasoning effort from the Web composer | Client modules, typed slots, shared session state, effect disposal, and browser verification |

Start with the plugin's README. The [community review](../results/plugin-review-20260906/REVIEW.md) records the inspected external implementations; popularity figures there are dated observations.
