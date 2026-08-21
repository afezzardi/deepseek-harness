#!/usr/bin/env python3
"""Exact rendered-token cost of each prompt contributor, from a recorded wire body.

Answers the question a least-squares intercept cannot: which messages make up the
per-session constant, and where in the rendered prompt each one lands. The infra
session's MESSAGE.md Q17 reply priced the bytes this fork shipped in Q13 at 7,499
rendered tokens against a published head of 13,253, leaving ~5,754 unaccounted for;
this probe attributes them.

Method: tokenize cumulative message prefixes through the raw `/engine/tokenize`
route with `add_generation_prompt: false`, so successive renders are pure
concatenations and the differences are exact per-message costs. `tools` and
`chat_template_kwargs` are replayed verbatim from the recording, because both change
the render.

The Qwen3.8 template rejects a render with no user query (`No user query found in
messages.`, HTTP 400), so the shortest legal prefix is system + tool schemas + an
empty user message. That empty message's own role scaffolding — a handful of tokens —
stays inside the reported shared-prefix figure; every per-message cost is a difference
and is therefore exact. Attribution is taken from the FIRST main-route request only:
appending to a prefix that already holds assistant turns would move the template's
`last_query_index` and restate their `<think>` blocks.

Input is a `recproxy.py` JSONL log. Writes JSON to stdout; redirect it to a file
under `artifacts/results/` and cite the file.
"""
import json, os, sys, urllib.request

KEY = os.environ["LITELLM_MASTER_KEY"]
BASE = os.environ.get("ENGINE_BASE", "http://100.108.76.12:4000/engine")


def render_tokens(messages, tools, ctk):
    """Rendered token count for a message prefix.

    @param messages Message array to render, in wire order.
    @param tools Tool schema array as sent, or None.
    @param ctk `chat_template_kwargs` as sent, or None.
    @returns Token count of the rendered prompt, without a generation prompt.
    """
    payload = {"model": "chat-model", "messages": messages, "add_generation_prompt": False}
    if tools:
        payload["tools"] = tools
    if ctk:
        payload["chat_template_kwargs"] = ctk
    req = urllib.request.Request(
        BASE + "/tokenize",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
        method="POST")
    return json.load(urllib.request.urlopen(req, timeout=300))["count"]


def label(msg, text):
    """Which harness contributor produced a message, by its rendered marker.

    @param msg The wire message object.
    @param text Its flattened text content.
    @returns A short contributor name for the report.
    """
    role = msg.get("role")
    if role == "system":
        return "system prompt (+ tool schemas)"
    if "The following workspace instructions" in text:
        return "workspace instructions (AGENTS.md files)"
    if "A skill is a reusable set of task-specific instructions" in text:
        return "skill catalog"
    if text.startswith("Current runtime context."):
        return "runtime context snapshot"
    if role == "user":
        return "user task"
    return role or "?"


def main():
    recs = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
    main_route = [r for r in recs if (r.get("body") or {}).get("tools")]
    if not main_route:
        sys.exit("no main-route request (none carried a tools array) in the recording")
    body = main_route[0]["body"]
    msgs, tools, ctk = body["messages"], body.get("tools"), body.get("chat_template_kwargs")

    # The system message carries the tool schemas in this template, so its own cost is
    # measured with tools attached and every later prefix inherits them.
    empty_user = [{"role": "user", "content": ""}]
    prev = render_tokens([msgs[0]] + empty_user, tools, ctk)
    shared_prefix = prev
    rows = []
    for i in range(2, len(msgs) + 1):
        n = render_tokens(msgs[:i], tools, ctk)
        m = msgs[i - 1]
        c = m.get("content")
        text = "".join(p.get("text", "") for p in c if isinstance(p, dict)) if isinstance(c, list) else (c or "")
        rows.append({
            "index": i - 1,
            "role": m.get("role"),
            "contributor": label(m, text),
            "bytes": len(text.encode()),
            "rendered_tokens": n - prev,
            "cumulative_tokens": n,
        })
        prev = n

    system_no_tools = render_tokens([msgs[0]] + empty_user, None, ctk)
    out = {
        "source_recording": sys.argv[1],
        "wire_max_tokens": body.get("max_tokens"),
        "chat_template_kwargs": ctk,
        "tool_count": len(tools or []),
        "shared_prefix_tokens": shared_prefix,
        "shared_prefix_without_tool_schemas": system_no_tools,
        "tool_schema_tokens": shared_prefix - system_no_tools,
        "contributors": rows,
        "rendered_total_tokens": prev,
    }
    # The shared cross-session prefix ends at the first message whose content varies
    # per session; everything after it re-prefills even when byte-identical.
    task = next((r for r in rows if r["contributor"] == "user task"), None)
    if task:
        out["constant_bytes_after_divergence"] = sum(
            r["bytes"] for r in rows if r["index"] > task["index"])
        out["constant_tokens_after_divergence"] = sum(
            r["rendered_tokens"] for r in rows if r["index"] > task["index"])
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
