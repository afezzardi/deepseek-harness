# Training methods and the trace foundation

This research supports infrastructure for a later workload. The current benchmark is a pipeline fixture, not a production training corpus. No training experiment is planned in this cycle.

## What established projects do

| Source | Documented practice | Consequence for this pipeline |
|---|---|---|
| [Qwen3](https://qwenlm.github.io/blog/qwen3/) | Combines reasoning cold-start data, reasoning RL, thinking-mode fusion, and general RL; also uses distillation for smaller models. | Preserve reasoning as source data. SFT and RL solve different parts of post-training. |
| [DeepSeek-R1](https://github.com/deepseek-ai/DeepSeek-R1) | Uses SFT and RL stages, and releases smaller models fine-tuned on generated reasoning data. | Task-outcome-selected reasoning demonstrations are a defensible SFT objective; they do not establish statement-by-statement correctness. |
| [Hugging Face TRL](https://huggingface.co/docs/trl/sft_trainer) | Supports conversational/tool SFT and assistant-only loss when the template exposes generation masks. | Inspect the actual template and mask. A field named `messages` does not establish which tokens receive loss. |
| [OpenAI](https://developers.openai.com/api/docs/guides/model-optimization#fine-tuning-methods) | Distinguishes examples for SFT, preferred/rejected responses for DPO, and graded generated outputs for RFT. | Preserve evidence suited to each method; successful trace capture alone supplies none of the missing labels or rollout machinery. |
| [Fireworks](https://docs.fireworks.ai/fine-tuning/finetuning-intro) | Provides managed SFT, preference optimization, and RFT, plus a programmable Training API. | Choose a destination after the workload and objective are defined. Managed JSONL and explicit-token trainer inputs need different acceptance checks. |

The downloaded [HF reference](https://huggingface.co/datasets/HuggingFaceH4/Multilingual-Thinking) contains 1,000 assistant messages with separate `thinking` and `content` fields. Its source revision, file hash, and measured field counts are in [the comparison](hf-comparison.json). Fireworks uses `reasoning_content` for the corresponding assistant field. This reference has no tool messages and is not an agent-trajectory quality benchmark. None of its examples were added to the DSH dataset.

## Evidence required by method

| Method | Required material | Current foundation | Remaining work |
|---|---|---|---|
| SFT | Complete input, selected demonstration, quality/admission evidence, correct renderer and loss | 300 admitted targets with source hashes and frozen splits; reasoning-plus-answer/tool export; dataset upload and native previews | Representative real tasks, selection policy, serving/training settings, and eventual trainer token-mask verification |
| DPO | Two distinct responses to the same complete prompt, with a justified preference | Exact-request comparator and conservative managed-DPO exporter | The r5 audit has **zero** identical-request pass/fail pairs. Collect frozen-request alternatives once preferences are defined. |
| RFT | Task initialization, resettable environment, executable reward, fresh policy rollouts | Synthetic resettable fixtures and independent task/tool graders | Adapt the real workflow to a rollout/environment interface; specify rewards and controls against exploiting them. |

Missing infrastructure:

- A complete-request repeat collector and a DPO exporter for tool or multi-turn comparisons. The r5 campaign has no repeated complete request, so the comparator has not been exercised on a real preference pair.
- A rollout environment adapter with a reward service for fresh policy execution.
- A trainer token-ID and loss-mask verification harness; dataset previews do not supply that evidence.

Missing workload data and decisions:

- Representative tasks and complete real-usage traces.
- Preferred behavior and justified comparisons between alternatives.
- Executable rewards, failure cases, and the intended serving/training settings.

These are separate dependencies. More traces alone do not implement the missing collectors, adapters, or trainer checks.

The 300 targets come from 48 task instances across twelve synthetic families and repeated trials. Targets from a shared trajectory are correlated; they are not 300 independent task examples. The current family split is useful for leakage tests but cannot establish performance on an unspecified future workload.

Our existing managed-DPO exporter intentionally supports one-turn text without tools. [Fireworks’ managed preference guide](https://docs.fireworks.ai/fine-tuning/dpo-fine-tuning) describes paired responses; a future tool-trajectory preference path requires explicit destination support and validation. Do not pair two final answers merely because their task IDs match: tools, results, earlier messages, and settings can differ.

RFT can start from prompts/environments and obtain fresh outputs during training; missing sampled token IDs in old traces do not make RFT inherently impossible. They prevent treating those historical records as exact-token on-policy rollouts. [Fireworks’ remote-environment interface](https://docs.fireworks.ai/fine-tuning/connect-environments) and [TRL’s GRPO trainer](https://huggingface.co/docs/trl/grpo_trainer) illustrate the required separation between tasks, generated outputs, and reward computation.

## Reasoning and rendering

Fireworks’ live answer-only preview places positive loss on an immediate `</think>`, followed by the answer and `<|im_end|>`. That representation is unsuitable as an implicit thinking-preservation objective. The explicit outcome-reasoning export retains the recorded reasoning and selected answer/tool calls, keeps preceding assistant messages at weight zero, and leaves original candidates unchanged. Task grades admit the demonstration; no independent reasoning-statement grade is claimed.

[Thinking-history modes](https://docs.fireworks.ai/fine-tuning/thinking-history) govern earlier reasoning, not whether the model generates reasoning. The observed Qwen3.8 model exposes Preserved and Interleaved, defaulting to Preserved. Native previews also use different default effort and tool/JSON serialization from the collection route. The [execution report](REPORT.md) records these measured differences and their limits. Matching preview text and segment weights does not verify the trainer’s actual token IDs or demonstrate improvement.

Fireworks’ [pricing](https://fireworks.ai/pricing) specifies inference, training, and deployment charges; it lists no dataset upload or preview tariff. The operations performed here create datasets and request rendering, without launching inference, deployments, or training. This is an assessment of the documented billing model, not an account invoice audit.

## Later workload acceptance

Define the task and desired behavior first. Collect complete canonical sessions and source-bound provider evidence, grade outcomes and selected decisions, freeze connected split groups, then export the chosen objective. Use held-out real tasks to establish a baseline before any future training. Keep schema acceptance, renderer compatibility, trainer token/loss verification, and measured task improvement as separate results. Missing evidence must remain a visible rejection or pending condition.
