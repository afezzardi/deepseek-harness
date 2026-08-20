# HOW-TO: consume the inference stack

One endpoint, one key, three models. This is the consumer-facing guide — if you are operating or
re-shaping the host, read `README.md` and `HANDOFF.md` instead.

## The endpoint

```
http://<host>:4000/v1        managed surface  (OpenAI-compatible)
http://<host>:4000/engine    raw vLLM surface (chat engine only)
```

Everything needs `Authorization: Bearer $LITELLM_MASTER_KEY`. The three engines publish **no** host
port — the gateway is the only way in. There is no second key for consumers: `VLLM_API_KEY` never
leaves the gateway container.

## Model ids

These ids are a **contract**. The checkpoint is expected to move underneath them, so never pin to a
checkpoint name.

| id | what it is | notes |
|---|---|---|
| `chat-model` | Qwen3.8-27B | injects nothing → inherits the model default (`xhigh`) |
| `chat-model-off` | same engine | `enable_thinking: false` — no reasoning at all |
| `chat-model-low` | same engine | fastest, **but see the `content: null` trap below** |
| `chat-model-medium` | same engine | **the default choice for agentic use** |
| `chat-model-xhigh` | same engine | pinned default; exhausts the token budget on hard prompts |
| `embedding-model` | Qwen3-Embedding-4B | 2560 dims, returned L2-normalised |
| `reranker-model` | Qwen3-Reranker-4B | scores, not embeddings |

The five chat ids share **one** engine and cost nothing extra to serve; they differ only in what the
gateway injects.

## Chat

```python
from openai import OpenAI
c = OpenAI(base_url="http://<host>:4000/v1", api_key="<LITELLM_MASTER_KEY>")

r = c.chat.completions.create(
    model="chat-model-medium",
    messages=[{"role": "user", "content": "What is 2+2?"}],
    max_tokens=512,
)
```

### Read `reasoning_content`, not just `content` — this is the one that bites

This is a reasoning model. The answer can arrive in **either** field, and reading only `content`
gets you an empty answer with **HTTP 200 and billed tokens** — no error to catch.

```python
msg = r.choices[0].message
answer = msg.content or getattr(msg, "reasoning_content", None) or getattr(msg, "reasoning", None)
```

Three rules that follow from measurement, not taste:

- **Check both field names.** Engines and parsers disagree on `reasoning_content` vs `reasoning`.
- **Check `finish_reason`.** `stop` means the answer is complete and readable somewhere;
  `length` means the model ran out of budget mid-thought and what you have is unfinished.
- **Budget for the reasoning block.** It is spent *before* the answer. A `max_tokens` of 16 on a
  trivial prompt returns `content: None` simply because the thinking consumed the whole allowance.

At effort `low` the model states its answer inside the reasoning block and emits EOS without ever
closing `</think>` on ~11% of items (78 of 690 measured), so the parser hands back `content: null`.
At `medium` that happened once in 690. **Use `chat-model-medium` for anything that must parse.**

## Embeddings

```python
v = c.embeddings.create(model="embedding-model", input=["some text"]).data[0].embedding
len(v)   # 2560, already L2-normalised — cosine similarity is a plain dot product
```

## Reranking

Not an OpenAI route — it is the JinaAI-shaped `/v1/rerank`:

```bash
curl http://<host>:4000/v1/rerank \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"reranker-model",
       "query":"How do I restart the engines?",
       "documents":["Docker compose restarts the vLLM containers.","Banana bread recipe."],
       "top_n":3}'
```

Returns `results[]` with `index` and `relevance_score`, sorted best-first. Scores are **not**
calibrated probabilities — use them to order candidates, not as a confidence threshold. Separation
is wide in practice (0.25 vs 6e-06 on the example above).

## Limits you must design around

| limit | value | what happens when you cross it |
|---|---|---|
| context | 131,072 tokens | 400 |
| output | 32,768 tokens | `finish_reason: "length"` |
| concurrent requests | **5** (`--max-num-seqs`) | the 6th **queues**, it does not fail |
| request timeout | 2700 s | gateway 500 |
| stream idle timeout | 900 s | stream killed |
| retries | **0**, deliberately | a timeout surfaces as an error, never a silent re-run |

**Cap your own concurrency at 5.** A queued request is not admitted until a request ahead stops
*generating* — up to ~1,780 s at a full output budget. That wait scales with the **output** budget of
the request ahead, not with your prompt, and no timeout can size for it. If you push more than 5
concurrent requests, the symptom is not an error, it is a request that appears to hang.

**Prefix caching is off, and the reason is not the one this section used to give.**
`supports_mamba_prefix_caching=False` selects a *mode* — vLLM 0.27.1 falls back to `align`
(`model_executor/models/config.py:616`) — it does not disable the feature. Caching is off because
`enable_prefix_caching` defaults to `None` and resolves to `False` for this hybrid, logged at
`debug`. `--enable-prefix-caching` is expected to take, and `align` mode's one prerequisite
(chunked prefill) is already on. Untested; see R1 of the remediation report. Until it is run, every
turn re-prefills the whole conversation from token 0, and these are the measured costs:

| prompt tokens | prefill | single-stream decode |
|---|---|---|
| 1,024 | 0.15 s | 48.4 tok/s |
| 32,805 | 5.71 s | 46.2 tok/s |
| 65,551 | 14.15 s | 44.4 tok/s |
| 98,305 | 25.28 s | 43.0 tok/s |
| 130,219 | 38.80 s | 41.8 tok/s |

(Measured at the shipped fp8-KV shape. Under a saturated 5-way load per-stream decode falls to
~19.5 tok/s, because prefill is served one request at a time and every step carries a prefill chunk.)

For an agent loop this is the dominant cost of the workload. **Trim context aggressively** — a
conversation that grows to 100k pays that prefill on *every single turn*.

## The raw path

When you want to drive vLLM directly — sampling knobs, `/v1/completions`, `/tokenize`, thinking
control with no gateway opinion in the way:

```bash
curl http://<host>:4000/engine/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -d '{"model":"chat-model","messages":[...],"top_k":20,"min_p":0.0,
       "chat_template_kwargs":{"reasoning_effort":"medium"}}'
```

`/engine/v1/completions`, `/engine/tokenize` and `/engine/v1/models` work the same way, with the
same key. The prefix is `/engine` and cannot be `/vllm` — LiteLLM reserves that one and would
shadow it.

## Two gotchas that fail silently

**Do not send your own `chat_template_kwargs` to an effort id.** It **replaces** the injected dict
wholesale rather than merging, so `chat-model-low` plus a client-supplied `chat_template_kwargs`
silently loses `reasoning_effort: low`. Use `chat-model` (which injects nothing) or the raw route.

**Unsupported sampling params are rejected, not dropped** (`drop_params: false`). `top_k`, `min_p`
and `repetition_penalty` all reach the engine. A bad value comes back as a 400 rather than being
quietly ignored — that is deliberate, and it is how you know your params actually arrived.

## Checking the stack is alive

```bash
curl -s http://<host>:4000/health/liveliness                    # no key needed -> "I'm alive!"
curl -s http://<host>:4000/v1/models -H "Authorization: Bearer $LITELLM_MASTER_KEY"
./scripts/smoke.sh                                              # full acceptance, expect 30/30
```

If a model id 404s, the gateway is up but that engine is not — check `docker ps` for the engine
behind it. A routed 5xx means the same thing: the gateway deliberately stays up when an engine is
down, so a dead upstream surfaces as an error from `:4000` rather than a refused connection.
