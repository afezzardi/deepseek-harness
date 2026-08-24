#!/usr/bin/env python3
"""Establishes that Qwen3.8-27B accepts and understands images on this deployment.

Answers three questions the harness-side config cannot answer, because dsh refuses image
reads locally — `read-image.ts:97` gates on the route's declared `inputModalities` and never
reaches the endpoint:

  1. Does the engine accept OpenAI-style `image_url` content on `/engine/v1`, the surface both
     of our routes use?
  2. Does it work in thinking mode, which is what our main `local-qwen` route sends?
  3. What does an image cost in prompt tokens, against the 114,688-token usable ceiling?

Colour identification is the test rather than a caption, because it is unambiguous and a wrong
answer cannot be argued into a right one. The no-image control is load-bearing: without it, a
plausible caption is indistinguishable from the model ignoring dropped image content and
answering from the text alone.

Reads LITELLM_MASTER_KEY from the environment. Prints observations; writes nothing to the
endpoint's state. Run from the repo root, never from `artifacts/probes` — `tokenize.py` there
shadows the stdlib `tokenize` module and the traceback blames the credential.

    set -a && . ./.env && set +a
    python3 artifacts/probes/probe_image.py | tee artifacts/results/image-capability-<date>.txt
"""

import base64
import json
import os
import struct
import time
import urllib.error
import urllib.request
import zlib

URL = 'http://100.108.76.12:4000/engine/v1/chat/completions'
COLOUR_QUESTION = 'What colour is this image? Answer with one word.'


def solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Encode one solid-colour RGB PNG, so no image fixture has to be committed."""
    raw = b''.join(b'\x00' + bytes(rgb) * width for _ in range(height))

    def chunk(tag: bytes, data: bytes) -> bytes:
        body = tag + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    return (
        b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw))
        + chunk(b'IEND', b'')
    )


def call(content: object, *, thinking: bool, max_tokens: int = 256) -> dict:
    """One chat completion against the raw engine surface, returning the parsed body or the HTTP error."""
    kwargs: dict[str, object] = {'enable_thinking': thinking}
    if thinking:
        kwargs['reasoning_effort'] = 'medium'
    body = json.dumps({
        'model': 'chat-model',
        'max_tokens': max_tokens,
        'chat_template_kwargs': kwargs,
        'messages': [{'role': 'user', 'content': content}],
    }).encode()
    request = urllib.request.Request(URL, body, {
        'Authorization': f'Bearer {os.environ["LITELLM_MASTER_KEY"]}',
        'Content-Type': 'application/json',
    })
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        return {'_http': error.code, '_body': error.read().decode()[:300]}


def image_content(data: bytes, question: str = COLOUR_QUESTION) -> list[dict]:
    encoded = base64.b64encode(data).decode()
    return [
        {'type': 'text', 'text': question},
        {'type': 'image_url', 'image_url': {'url': f'data:image/png;base64,{encoded}'}},
    ]


def report(label: str, body: dict) -> None:
    """Print one result, always naming `finish_reason` — `length` with null content is unrecoverable."""
    if '_http' in body:
        print(f'{label}: HTTP {body["_http"]} -> {body["_body"]}')
        return
    choice = body['choices'][0]
    message = choice['message']
    reasoning = message.get('reasoning_content') or message.get('reasoning')
    print(
        f'{label}: prompt_tokens={body["usage"]["prompt_tokens"]} '
        f'finish={choice["finish_reason"]} content={message.get("content")!r}'
        + (f' reasoning_len={len(reasoning)}' if reasoning else '')
    )


def main() -> None:
    print('== control: identical text, no image ==')
    control = call([{'type': 'text', 'text': COLOUR_QUESTION}], thinking=False, max_tokens=64)
    report('  no image', control)
    baseline = control['usage']['prompt_tokens'] if '_http' not in control else None

    print('== comprehension: three colours, non-thinking ==')
    for name, rgb in (('red', (255, 0, 0)), ('blue', (0, 0, 255)), ('green', (0, 255, 0))):
        report(f'  {name} 64x64', call(image_content(solid_png(64, 64, rgb)), thinking=False, max_tokens=64))
        time.sleep(0.3)

    print('== thinking mode, the config our main local-qwen route sends ==')
    report('  red 64x64', call(image_content(solid_png(64, 64, (255, 0, 0))), thinking=True))

    print(f'== prompt-token cost by size (image cost = prompt_tokens - {baseline} baseline) ==')
    for edge in (64, 128, 256, 512, 1024):
        body = call(image_content(solid_png(edge, edge, (255, 0, 0))), thinking=False, max_tokens=16)
        if '_http' in body:
            print(f'  {edge}x{edge}: HTTP {body["_http"]} {body["_body"][:120]}')
            continue
        total = body['usage']['prompt_tokens']
        cost = f'{total - baseline}' if baseline is not None else 'unknown baseline'
        print(f'  {edge}x{edge}: prompt_tokens={total} image_cost={cost}')
        time.sleep(0.3)


if __name__ == '__main__':
    main()
