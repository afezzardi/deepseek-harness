#!/usr/bin/env python3
"""INPUT direction: which assistant reasoning field reaches the chat template?
Uses /engine/tokenize with `messages`, which applies the template server-side —
so the rendered token count is direct evidence of what the template saw."""
import json, os, urllib.request, urllib.error

KEY = os.environ["LITELLM_MASTER_KEY"]
URL = "http://100.108.76.12:4000/engine/tokenize"
FILLER = "I need to check divisibility of seventeen by two three and five carefully. " * 12

def ntok(messages, **kw):
    body = {"model": "chat-model", "messages": messages, "add_generation_prompt": True, **kw}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
    try:
        return json.load(urllib.request.urlopen(req, timeout=120))["count"]
    except urllib.error.HTTPError as e:
        return f"HTTP {e.code}: {e.read().decode()[:160]}"

def convo(assistant_extra):
    a = {"role": "assistant", "content": "Yes, 17 is prime."}
    a.update(assistant_extra)
    return [{"role": "user", "content": "Is 17 prime?"}, a, {"role": "user", "content": "Are you sure?"}]

filler_tokens = ntok([{"role": "user", "content": FILLER}]) - ntok([{"role": "user", "content": ""}])
print(f"reference: the filler string alone is ~{filler_tokens} tokens\n")

base = ntok(convo({}))
print(f"{'assistant carries':<46} {'tokens':>7}   {'delta':>6}")
print("-" * 64)
print(f"{'(no reasoning field)':<46} {base:>7}   {'--':>6}")
for label, extra in (
    ("reasoning_content: <filler>",  {"reasoning_content": FILLER}),
    ("reasoning: <filler>",          {"reasoning": FILLER}),
    ("reasoning_text: <filler>",     {"reasoning_text": FILLER}),
    ("both reasoning_content+reasoning", {"reasoning_content": FILLER, "reasoning": FILLER}),
):
    n = ntok(convo(extra))
    d = (n - base) if isinstance(n, int) else n
    print(f"{label:<46} {str(n):>7}   {str(d):>6}")

print("\nwith preserve_thinking=False (drops thinking before the last user query):")
for label, extra in (("reasoning_content: <filler>", {"reasoning_content": FILLER}),
                     ("reasoning: <filler>", {"reasoning": FILLER})):
    n = ntok(convo(extra), chat_template_kwargs={"preserve_thinking": False})
    print(f"  {label:<44} {n}")
