#!/usr/bin/env python3
"""Which field carries reasoning, on each surface, in each direction."""
import json, os, urllib.request, urllib.error

KEY = os.environ["LITELLM_MASTER_KEY"]
HOST = "http://100.108.76.12:4000"

def call(surface, body, stream=False):
    req = urllib.request.Request(
        f"{HOST}{surface}/chat/completions", data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"}, method="POST")
    try:
        r = urllib.request.urlopen(req, timeout=600)
    except urllib.error.HTTPError as e:
        return {"err": e.code, "body": e.read().decode()[:300]}
    if stream:
        keys, n = set(), 0
        for raw in r:
            line = raw.decode().strip()
            if not line.startswith("data:"): continue
            p = line[5:].strip()
            if p == "[DONE]": break
            ch = json.loads(p).get("choices") or [{}]
            d = ch[0].get("delta") or {}
            for k, v in d.items():
                if v not in (None, "", [], {}): keys.add(k)
            n += 1
        return {"delta_keys_seen": sorted(keys), "chunks": n}
    return {"json": json.loads(r.read().decode())}

MSG = [{"role": "user", "content": "Is 17 prime? Answer in one short sentence."}]

print("=" * 78)
print("DIRECTION 1 — OUTPUT: which field does each surface populate?")
print("=" * 78)
for surface, label in (("/v1", "managed (LiteLLM)"), ("/engine/v1", "raw vLLM 0.27.1")):
    body = {"model": "chat-model", "messages": MSG, "max_tokens": 900}
    if surface == "/v1":
        body["reasoning_effort"] = "medium"
    else:
        body["chat_template_kwargs"] = {"reasoning_effort": "medium"}
    r = call(surface, body)
    if "err" in r:
        print(f"\n{surface:12} {label:20} HTTP {r['err']}: {r['body'][:200]}"); continue
    m = r["json"]["choices"][0]["message"]
    print(f"\n{surface:12} {label}")
    print(f"  message keys           : {sorted(m.keys())}")
    for f in ("reasoning_content", "reasoning", "reasoning_text"):
        v = m.get(f, "<absent>")
        state = "<absent>" if v == "<absent>" else ("null" if v is None else f"len={len(v)}")
        print(f"  {f:22}: {state}")
    psf = m.get("provider_specific_fields")
    print(f"  provider_specific_fields: {json.dumps(psf)[:200] if psf else psf}")
    c = m.get("content") or ""
    print(f"  content has '<think>'   : {'<think>' in c}   content len={len(c)}")
    # streaming
    sb = dict(body); sb["stream"] = True
    s = call(surface, sb, stream=True)
    print(f"  streaming delta keys    : {s.get('delta_keys_seen')} over {s.get('chunks')} chunks")
