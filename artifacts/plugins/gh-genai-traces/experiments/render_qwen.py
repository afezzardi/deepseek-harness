"""Reference Qwen rendering with exact final-answer masks; engine parity is separate."""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import urllib.request
from phoenix_dataset import atomic, digest


def messages(candidate):
    request = candidate['request']
    result = [] if 'system' not in request else [{'role': 'system', 'content': request['system']}]
    for message in request['messages'] + [candidate['response']]:
        item = {'role': 'tool' if message['source']['kind'] == 'tool' else message['role'], 'content': ''}
        for block in message['content']:
            kind = block['type']
            if kind == 'text':
                item['content'] += block['text']
            elif kind == 'reasoning':
                if message is not candidate['response']:
                    item['reasoning_content'] = item.get('reasoning_content', '') + block['text']
            elif kind == 'tool-call':
                item.setdefault('tool_calls', []).append({'id': block['id'], 'type': 'function', 'function': {'name': block['name'], 'arguments': json.loads(block['arguments'])}})
            elif kind == 'tool-result':
                if len(message['content']) != 1 or any(b['type'] != 'text' for b in block['content']):
                    raise ValueError('Unsupported tool-result arrangement')
                item['content'] = ''.join(b['text'] for b in block['content'])
                item['tool_call_id'] = block['toolCallId']
            else:
                raise ValueError('Unsupported Qwen content block: ' + kind)
        result.append(item)
    return result


def render(candidate, tokenizer, template_kwargs):
    if candidate['version'] != 2 or candidate['target']['policy'] != 'final-answer' or candidate['target']['reasoning'] != 'omit':
        raise ValueError('Unsupported Qwen loss policy')
    blocks = candidate['response']['content']
    if candidate['target']['blocks'] != [i for i, b in enumerate(blocks) if b['type'] == 'text' and b['text'].strip()]:
        raise ValueError('Selected blocks do not equal the exported final answer')
    conversation = messages(candidate)
    tools = [{'type': 'function', 'function': t} for t in candidate['request'].get('tools', [])]
    kwargs = {**template_kwargs, **({'tools': tools} if tools else {}), 'tokenize': False, 'add_generation_prompt': False}
    full = tokenizer.apply_chat_template(conversation, **kwargs)
    # A unique marker locates the template-owned target position, including repeated answer text.
    marker = '__GH_TARGET_' + digest(candidate) + '__'
    marked = copy.deepcopy(conversation)
    marked[-1]['content'] = marker
    rendered_marker = tokenizer.apply_chat_template(marked, **kwargs)
    if rendered_marker.count(marker) != 1:
        raise ValueError('Template does not expose exactly one answer segment')
    prefix, suffix = rendered_marker.split(marker)
    target = conversation[-1]['content']
    if full != prefix + target + suffix:
        raise ValueError('Template transforms target text; explicit mask unsupported')
    start, end = len(prefix), len(prefix) + len(target)
    encoded = tokenizer(full, add_special_tokens=False, return_offsets_mapping=True)
    mask = []
    for a, b in encoded['offset_mapping']:
        if a < start < b or a < end < b:
            raise ValueError('Token crosses the target/context boundary')
        mask.append(int(start <= a < b <= end))
    if not any(mask):
        raise ValueError('Empty supervised token set')
    return {'renderedText': full, 'inputIds': encoded['input_ids'], 'lossMask': mask, 'targetText': target,
            'requestMessages': conversation[:-1], 'tools': tools, 'templateKwargs': template_kwargs,
            'rowHash': candidate['provenance']['rowHash'], 'requestHash': candidate['provenance']['requestHash'],
            'sampledTokenIds': None, 'rlEligible': False}


def check_engine(result, route):
    """Compare local rendering against an explicitly observed route; absent identities fail."""
    for key in ['checkpoint', 'tokenizer', 'templateHash', 'modelAlias', 'inspectionEvidence']:
        if not route.get(key):
            raise ValueError('Unobserved route identity: ' + key)
    body = {'model': route['modelAlias'], 'messages': result['requestMessages'],
            'add_generation_prompt': True, 'chat_template_kwargs': result['templateKwargs']}
    if result['tools']:
        body['tools'] = result['tools']
    request = urllib.request.Request(route['tokenizeEndpoint'], data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        observed = json.load(response)
    return {'request': body, 'response': observed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate')
    parser.add_argument('--tokenizer', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--route')
    parser.add_argument('--template-kwargs', default='{}')
    args = parser.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True, trust_remote_code=False)
    candidate = json.loads(Path(args.candidate).read_text())
    result = render(candidate, tokenizer, json.loads(args.template_kwargs))
    result['tokenizerFiles'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in Path(args.tokenizer).iterdir() if p.is_file()}
    result['templateHash'] = hashlib.sha256(tokenizer.chat_template.encode()).hexdigest()
    result['readiness'] = 'reference-only; observed inference route unverified'
    if args.route:
        route = json.loads(Path(args.route).read_text())
        if route['templateHash'] != result['templateHash']:
            raise ValueError('Observed template differs from local tokenizer')
        wire = check_engine(result, route)
        local = tokenizer.apply_chat_template(result['requestMessages'], tools=result['tools'] or None,
                                               tokenize=True, add_generation_prompt=True, **result['templateKwargs'])
        if wire['response'].get('tokens') != local:
            raise ValueError('Engine tokenize differs from reconstructed request tokens')
        result['engineEvidence'] = wire
        result['route'] = route
        result['readiness'] = 'request-token-parity; training renderer approval pending'
    atomic(args.output, result)
    print(json.dumps({'tokens': len(result['inputIds']), 'lossTokens': sum(result['lossMask']), 'readiness': result['readiness']}))
