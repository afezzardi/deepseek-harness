#!/usr/bin/env python3
"""Endpoint probe for the LiteLLM gateway. Prints observations only; never the key."""
import json, os, sys, urllib.request, urllib.error, time

BASE = os.environ.get("PROBE_BASE", "http://100.108.76.12:4000/v1")
KEY  = os.environ["LITELLM_MASTER_KEY"]

def post(path, body, stream=False, timeout=600):
    req = urllib.request.Request(
        BASE.rstrip("/") + path,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST",
    )
    t0 = time.time()
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "_body": e.read().decode()[:1200], "_elapsed": time.time()-t0}
    if stream:
        events = []
        for raw in r:
            line = raw.decode().strip()
            if not line.startswith("data:"):
                continue
            payload = line[5:].strip()
            if payload == "[DONE]":
                events.append("[DONE]")
                continue
            events.append(json.loads(payload))
        return {"_http": r.status, "_events": events, "_elapsed": time.time()-t0}
    return {"_http": r.status, "_json": json.loads(r.read().decode()), "_elapsed": time.time()-t0}

WEATHER = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {"type": "string", "description": "City name"},
                "unit": {"type": "string", "enum": ["c", "f"], "description": "Temperature unit"},
            },
            "required": ["city"],
        },
    },
}]

def show_msg(tag, res):
    print(f"\n### {tag}  HTTP {res['_http']}  {res['_elapsed']:.1f}s")
    if "_body" in res:
        print("  ERROR BODY:", res["_body"][:900]); return None
    j = res["_json"]
    ch = j["choices"][0]
    m = ch["message"]
    print("  finish_reason :", ch.get("finish_reason"))
    print("  message keys  :", sorted(m.keys()))
    print("  content       :", repr(m.get("content"))[:400])
    for f in ("reasoning_content", "reasoning"):
        if f in m and m[f] is not None:
            print(f"  {f:14}: len={len(m[f])} {repr(m[f])[:220]}")
    tc = m.get("tool_calls")
    print("  tool_calls    :", "NONE" if not tc else json.dumps(tc, indent=2)[:900])
    print("  usage         :", json.dumps(j.get("usage")))
    return m

if __name__ == "__main__":
    which = sys.argv[1] if len(sys.argv) > 1 else "all"

    if which in ("all", "tools"):
        for model in ("chat-model-medium", "chat-model-off"):
            r = post("/chat/completions", {
                "model": model,
                "messages": [{"role": "user", "content": "What is the weather in Milan? Use the tool."}],
                "tools": WEATHER, "tool_choice": "auto", "max_tokens": 2048,
            })
            show_msg(f"TOOLS non-streaming / {model}", r)

    if which in ("all", "effort"):
        # does the gateway/engine accept top-level reasoning_effort, and reject 'high'?
        for eff in ("medium", "low", "xhigh", "high"):
            r = post("/chat/completions", {
                "model": "chat-model",
                "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
                "reasoning_effort": eff, "max_tokens": 1024,
            })
            print(f"\n### top-level reasoning_effort={eff!r} -> HTTP {r['_http']} ({r['_elapsed']:.1f}s)")
            if "_body" in r:
                print("   ", r["_body"][:400])
            else:
                m = r["_json"]["choices"][0]["message"]
                rc = m.get("reasoning_content") or ""
                print(f"    content={repr(m.get('content'))[:120]} reasoning_len={len(rc)} usage={r['_json']['usage'].get('completion_tokens')}")
