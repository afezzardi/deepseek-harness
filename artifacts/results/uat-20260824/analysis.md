# UAT run of 2026-08-24, block B8 (vision) — analysis

Block B8 of [UAT.md](../../UAT.md), run on `0.1.1-rc.2` **after enabling `input: [text, image]`** on
both routes. Verdicts live in that file's results table and are not restated here; this document holds
what the logs say that the screen could not.

Six sessions, all single-turn, recorded between 20:56 and 21:18. Five are headless and one is web.

| File | What it holds |
|---|---|
| `sessions.jsonl` | `metrics.mts` fold of the six sessions, one JSON object each, in the order below |
| `../engine-metrics-20260824-210339.jsonl` | The engine counter series, 21:03:39-21:23:49 |

| # | Surface | What it was |
|---|---|---|
| 1 | headless | The **wrong-key diagnostic** — `inputModalities` instead of `input` |
| 2 | headless | B8.1 as first run, after the key was corrected |
| 3 | headless | The E2 regression gate under the new modality declaration |
| 4 | **web** | B8.3 — an image attached through the composer |
| 5 | headless | B8.1 re-run by the user |
| 6 | headless | B8.2 — a 1184×1084 screenshot |

## Vision works, and the harness path is what needed proving

The endpoint was already established by `probes/probe_image.py`. What these sessions add is the part
the probe could not reach: `read_image` → attachment store → pi-ai's `toPiContext` → the wire.

Sessions 2, 5 and 6 each carry a `tool/result` with `<type>image</type>` and **zero tool errors**, and
all three answers are accurate. Session 5, the user's own B8.1, is the cleanest run of the sitting:
one `read_image`, no errors, **4.5 s wall**, and a correct description of the QR code including its
256×256 dimensions.

**The tool result now carries geometry.** rc.2's `read_image` reports it inline —
`image/png image, 256x256 px, 30477 bytes` — which is why every run got the dimensions right without a
second tool call. That is new at this release and it is doing visible work.

### The measured token cost matches the probe, by two independent methods

The probe priced a bare image against the endpoint. The fold prices the same thing through the whole
product, as the difference between the step before the image and the step after it:

| Image | probe (bare) | harness (with tool-result wrapper) |
|---|---|---|
| 256×256 QR (sessions 2, 5) | 66 | **291**, **280** |
| 1184×1084 screenshot (session 6) | ~1,250 interpolated | **1,382** |

The ~215-token constant is the `<path>/<type>/<content>` wrapper plus the assistant's tool call, and it
is stable across both sizes. **The scaling agrees**: the screenshot is 1.22× the pixels of 1024², and
1,382 − 215 = 1,167 against the 1,026 the probe measured at 1024². Two methods, one within ~14% of the
other on a tile-quantised curve — enough to trust the shape, and the reason no re-measurement is queued.

Against the 114,688-token usable ceiling a full screenshot is **~1.2%**. Images are cheap here.

## The wrong key failed silently, which is the finding worth keeping

Session 1 is the diagnostic and it is instructive. With `inputModalities` — `llm-deepseek`'s name for
the field, not pi-ai's — the setting was **dropped without a load error, a warning, or any diagnostic**.
`read_image` refused with `model "chat-model" does not declare image input`, which blames the *model*
for a *config* that never applied.

What the model then did is worth recording, because it is the behaviour B8.4 exists to reward: it
decoded the PNG bytes in bash, rendered an ASCII preview, reported 256×256 correctly, and volunteered
that it could not decode the payload without `zbarimg` or `cv2`. Right answer, honest caveat, wrong
tool — 5 steps and 41 s to get there.

pi-ai reads `entry.input` (`llm-pi-ai/src/catalog.ts:874`). The lesson is in NEXT-SESSION.md's trap
list: **confirm a settings change by observing behaviour, never by re-reading the file.**

## B8.2 — the transcription is accurate, with one character wrong

Session 6 read a 1184×1084 screenshot of the HashiCorp status page. Every claim was checked against
the image:

| Claim | Verdict |
|---|---|
| HashiCorp status page; logo tagline "an IBM Company" | correct |
| Buttons "Report a problem", "Subscribe to updates" | correct |
| Banner "We're fully operational" / "We're not aware of any issues affecting our systems." | correct |
| "System status", "May 2026 – Aug 2026", "Upcoming scheduled maintenance" | correct |
| HCP Portal — all green except one yellow segment | correct |
| HCP API, HCP Boundary — fully green | correct |
| HCP Consul Dedicated — "22 components" | correct |
| 2 components on the last row, two small red segments near the right of its bar | correct |
| Row name transcribed **"HCP Ingragraph"** | **wrong — it reads "HCP Infragraph"** |

One character, `f` read as `g`, in a row name rendered at roughly 15 px. **No fabrication**, which is
what this case was built to catch — and a materially different result from B4.2 on 2026-08-21, where
the model invented a file it had never read, a line count and a line number. Here the only error is an
OCR slip on a glyph, and every hedge it offered ("likely early in the visible window") was appropriately
hedged.

One presentational note, not an error: it named the URL `status.hashicorp.com`, which is **not visible
in the image**. It appears in the identification sentence rather than under "Transcribed text", so it
reads as recognition rather than a claim about pixels — but it is an inference sitting next to a
transcription, and worth watching if this case is ever automated.

## The composer path works; instructing `read_image` on an attachment does not

Session 4 is the only web session and the only one with tool errors — **three `read_image` calls, all
`FsError / FS_NOT_FOUND`**.

The composer itself is fine. The `user/message` carries the image directly:

```
{"type": "image", "attachment": {"attachmentId": "sha256:19c0536e…", "mediaType": "image/png",
 "width": 256, "height": 256, "bytes": 30477, "name": "qr-code.png"}}
```

The prompt asked it to *"use read_image to look at attached image"*. So the model tried to turn the
attachment into a path and guessed three times — `/tmp/<sha>.png`, `/tmp/dsh-attachments/<sha>.png`,
`/tmp/dsh/<sha>.png` — because **an `attachmentId` is a content hash, not a filesystem path, and no
tool maps one to the other.** Its reasoning shows it working this out: *"Can't find the file… Wait —
maybe the image is actually attached to my context as an image."* It then answered correctly from
context: a 256×256 QR code with three finder patterns.

**Cost of the detour: 172 s wall, 1,697 output tokens across 3 steps, 3 failed tool calls** — against
4.5 s and 161 output tokens for the same image read by path in session 5.

So the verdict splits. The image pipeline is sound in web; the **affordance** is missing. Two things
would each have prevented it, and neither is ours to add:

1. Nothing tells the model that an attached image is already visible and needs no tool.
2. `read_image`'s description says nothing about attachments, so "use read_image on the attached image"
   reads as a legitimate instruction rather than a category error.

This is worth an upstream issue and is **not worth a fork patch**. In the meantime it is a usage note:
**do not ask for `read_image` on something you attached — just ask about it.**

## Everything else held

- **D1 confirmed still fixed** across all six sessions: every one carries
  `auxCalls: [{kind: title, provider: local-qwen-off}]`, so titling is still off the thinking route.
- **E2 passed** (session 3) under the new modality declaration: `FS_NOT_FOUND` recovered,
  `FS_SANDBOX_DENIED` on the out-of-workspace write with no file created, route unchanged at
  `local-qwen / chat-model / 16384 / medium`.
- **0 compactions** in all six sessions, max prompt 18,987. D7 stayed latent for the third sitting
  running.
- No parse losses, no malformed rows, no undecodable sessions.

## The engine, and one thing images did not change

Counter deltas over the sampled window (21:03:39-21:23:49, which covers sessions 4, 5 and 6):

| | |
|---|---|
| prefix cache | 269,696 hits / 313,681 queries = **86.0%** |
| preemptions | **0** |
| samples with any request queued | **0** |
| peak concurrent requests | **1** |
| peak KV usage | **0.05%** |
| tokens | 313,681 prompt, 12,396 generated |

**86.0% reuse is the highest of the three sittings** — against 73.6% on 2026-08-23 and 89.9% on
2026-08-21 — and the reason is structural rather than a win: these are repeated single-turn headless
runs over the same prompt, which is close to the ideal case for a shared prefix. Peak concurrency of 1
reflects the same thing.

**Images did not perturb the cache.** The image bytes arrive *after* the shared prefix, as a tool
result, so they extend the prompt without invalidating anything ahead of them — the same
append-only property already established for tool results. Nothing here argues for re-tuning.

## Tooling gap found while folding this

`metrics.mts` given a `.zstd` path **prints nothing and exits 0**. Its header does say the input is the
decoded log, but silent success on the wrong input is the same false-pass shape this suite exists to
catch. It should report the mistake rather than produce an empty fold. Filed as queue work, not fixed
here.

## What remains in B8

**B8.4** — that it still prefers a shell answer for a byte count, now that images work. Session 1
suggests it will, but session 1 ran with vision *disabled*, so it does not answer the question.
