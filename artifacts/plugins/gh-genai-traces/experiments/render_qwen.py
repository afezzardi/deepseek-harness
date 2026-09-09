"""Reference Qwen rendering with exact final-answer masks; engine parity is separate."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import urllib.request
import urllib.error
from phoenix_dataset import atomic, digest, validate_content


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


def render(candidate, tokenizer, template_kwargs, target_whitespace="exact"):
    """Mask exact rendered answer tokens; optional template trimming retains source text and hashes."""
    if target_whitespace not in ("exact", "template-trim"):
        raise ValueError("Unsupported target whitespace policy")
    validate_content(candidate)
    if candidate['version'] != 2 or candidate['target']['policy'] != 'final-answer' or candidate['target']['reasoning'] != 'omit':
        raise ValueError('Unsupported Qwen loss policy')
    blocks = candidate['response']['content']
    selected = candidate['target']['blocks']
    if len(selected) != 1 or selected != [i for i, b in enumerate(blocks) if b['type'] == 'text'] or not blocks[selected[0]]['text'].strip():
        raise ValueError('Selected blocks do not equal the exported final answer')
    source_target = blocks[selected[0]]['text']
    if any(token in source_target for token in tokenizer.get_added_vocab()):
        raise ValueError('Target contains a tokenizer added-token string')
    tokenizer_directory = Path(tokenizer.name_or_path)
    if not tokenizer_directory.is_dir():
        raise ValueError('Renderer requires a retained local tokenizer directory')
    tokenizer_files = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(tokenizer_directory.iterdir()) if p.is_file()}
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
    source_target = conversation[-1]['content']
    target = source_target
    if full != prefix + target + suffix:
        if target_whitespace == 'template-trim' and full == prefix + source_target.strip() + suffix:
            target = source_target.strip()
        else:
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
    positions = [i for i, selected in enumerate(mask) if selected]
    if positions != list(range(positions[0], positions[-1] + 1)):
        raise ValueError('Supervised token set is not contiguous')
    if tokenizer.decode([encoded['input_ids'][i] for i in positions], skip_special_tokens=False, clean_up_tokenization_spaces=False) != target:
        raise ValueError('Supervised tokens do not decode to the rendered target')
    leading = source_target[:len(source_target) - len(source_target.lstrip())] if target != source_target else ''
    trailing = source_target[len(source_target.rstrip()):] if target != source_target else ''
    return {'renderer': {'name': 'gh-qwen-final-answer', 'version': 1},
            'templateHash': hashlib.sha256(tokenizer.chat_template.encode()).hexdigest(), 'tokenizerFiles': tokenizer_files,
            'terminatorSupervised': False, 'renderedText': full, 'inputIds': encoded['input_ids'], 'lossMask': mask, 'renderedTargetText': target,
            'sourceTargetText': source_target, 'targetTransformation': {
                'policy': target_whitespace, 'operation': 'none' if target == source_target else 'strip-boundary-whitespace',
                'sourceHash': digest(source_target), 'renderedHash': digest(target),
                'removedLeading': leading, 'removedTrailing': trailing},
            'fullMessages': conversation, 'requestMessages': conversation[:-1], 'tools': tools, 'templateKwargs': template_kwargs,
            'rowHash': candidate['provenance']['rowHash'], 'requestHash': candidate['provenance']['requestHash'],
            'sampledTokenIds': None, 'rlEligible': False}


def engine_messages(conversation):
    """Map local Qwen template fields to the inspected engine's tokenize request fields."""
    wire_messages = copy.deepcopy(conversation)
    for message in wire_messages:
        if 'reasoning_content' in message:
            message['reasoning'] = message.pop('reasoning_content')
        for call in message.get('tool_calls', []):
            call['function']['arguments'] = json.dumps(call['function']['arguments'], ensure_ascii=False, separators=(',', ':'))
    return wire_messages


def check_engine(result, route, full_example=False):
    """Compare local rendering against an explicitly observed route; absent identities fail."""
    for key in ['checkpoint', 'tokenizer', 'templateHash', 'modelAlias', 'inspectionEvidence']:
        if not route.get(key):
            raise ValueError('Unobserved route identity: ' + key)
    wire_messages = engine_messages(result['fullMessages'] if full_example else result['requestMessages'])
    body = {'model': route['modelAlias'], 'messages': wire_messages,
            'add_generation_prompt': not full_example, 'chat_template_kwargs': result['templateKwargs']}
    if result['tools']:
        body['tools'] = result['tools']
    request = urllib.request.Request(route['tokenizeEndpoint'], data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + os.environ[route['apiKeyEnv']]} if route.get('apiKeyEnv') and os.environ.get(route['apiKeyEnv']) else {})})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            observed = json.load(response)
    except urllib.error.HTTPError as error:
        raise ValueError(f"Engine tokenize HTTP {error.code}: {error.read().decode()}") from error
    return {'request': body, 'response': observed}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidate')
    parser.add_argument('--tokenizer', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--route')
    parser.add_argument('--target-whitespace', choices=['exact', 'template-trim'], default='exact',
                        help='Explicitly permit template-owned boundary whitespace trimming and record its hashes')
    parser.add_argument('--template-kwargs', default='{}')
    args = parser.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True, trust_remote_code=False)
    candidate = json.loads(Path(args.candidate).read_text())
    result = render(candidate, tokenizer, json.loads(args.template_kwargs), args.target_whitespace)
    result['readiness'] = 'reference-only; observed inference route unverified'
    if args.route:
        route = json.loads(Path(args.route).read_text())
        if route['templateHash'] != result['templateHash']:
            raise ValueError('Observed template differs from local tokenizer')
        wire = check_engine(result, route)
        local = tokenizer.apply_chat_template(result['requestMessages'], tools=result['tools'] or None,
                                               tokenize=True, return_dict=False, add_generation_prompt=True, **result['templateKwargs'])
        result['engineEvidence'] = wire
        result['localRequestTokenIds'] = local
        result['route'] = route
        if wire['response'].get('tokens') != local:
            result['readiness'] = 'request-token-mismatch; training renderer approval pending'
            atomic(args.output, result)
            raise ValueError('Engine tokenize differs from reconstructed request tokens')
        full_wire = check_engine(result, route, full_example=True)
        result['engineFullEvidence'] = full_wire
        if full_wire['response'].get('tokens') != result['inputIds']:
            result['readiness'] = 'full-example-token-mismatch; training renderer approval pending'
            atomic(args.output, result)
            raise ValueError('Engine tokenize differs from reconstructed full-example tokens')
        result['readiness'] = 'full-example-token-parity; training renderer approval pending'
    atomic(args.output, result)
    print(json.dumps({'tokens': len(result['inputIds']), 'lossTokens': sum(result['lossMask']), 'readiness': result['readiness']}))
