"""Observed request/full-example token parity and synthetic final-answer masking controls."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys
import urllib.request

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'artifacts/plugins/gh-genai-traces/experiments'))
from phoenix_dataset import atomic, digest
from render_qwen import render, check_engine, messages, engine_messages
from transformers import AutoTokenizer

output = Path(__file__).resolve().parent
tokenizer = AutoTokenizer.from_pretrained(output / '.tokenizer-active', local_files_only=True, trust_remote_code=False)
route = json.loads((output / 'deployed-route.json').read_text())
assert hashlib.sha256(tokenizer.chat_template.encode()).hexdigest() == route['templateHash']
source = json.loads((output / '.render-synthetic-candidate.json').read_text())
kwargs = {'enable_thinking': True, 'reasoning_effort': 'medium'}
private = output / '.renderer'; private.mkdir(exist_ok=True, mode=0o700)
cases = []

for case in ['tool-trajectory', 'final-answer', 'reasoning-bearing', 'recovery', 'long-context']:
    candidate = copy.deepcopy(source)
    if case == 'final-answer':
        candidate['request']['messages'] = [m for m in candidate['request']['messages'] if m['role'] == 'user' and m['source']['kind'] != 'tool']
        candidate['request'].pop('tools', None)
    if case == 'reasoning-bearing':
        candidate['response']['content'].insert(0, {'type': 'reasoning', 'text': 'UNGRADED_TARGET_REASONING'})
        candidate['target']['blocks'] = [i + 1 for i in candidate['target']['blocks']]
    if case == 'recovery':
        tool = next(m for m in candidate['request']['messages'] if m['source']['kind'] == 'tool')
        tool['content'][0]['isError'] = True
        tool['content'][0]['content'] = [{'type': 'text', 'text': 'RECORDED_INTERRUPTION_REPAIR'}]
    if case == 'long-context':
        candidate['request']['messages'][0]['content'][0]['text'] += '\n' + 'Unchanged historical entry.\n' * 6000
    candidate['provenance']['requestHash'] = digest(candidate['request'])
    candidate['provenance']['toolsHash'] = digest(candidate['request'].get('tools'))
    candidate['provenance']['outputHash'] = digest(candidate['response']['content'])
    candidate['provenance']['rowHash'] = digest({'request': candidate['request'], 'response': candidate['response'], 'target': {**candidate['target'], 'event': None}})
    result = render(candidate, tokenizer, kwargs)
    observed = check_engine(result, route)
    local = tokenizer.apply_chat_template(result['requestMessages'], tools=result['tools'] or None, tokenize=True, return_dict=False, add_generation_prompt=True, **kwargs)
    atomic(private / (case + '-request.json'), {'candidate': candidate, 'observed': observed, 'local': local})
    assert observed['response']['tokens'] == local, case + ': request token mismatch'
    full_messages = engine_messages(messages(candidate))
    body = {**observed['request'], 'messages': full_messages, 'add_generation_prompt': False}
    request = urllib.request.Request(route['tokenizeEndpoint'], data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ[route['apiKeyEnv']]})
    with urllib.request.urlopen(request, timeout=60) as response:
        full_observed = json.load(response)
    assert full_observed['tokens'] == result['inputIds'], case + ': full-example token mismatch'
    selected = [token for token, mask in zip(result['inputIds'], result['lossMask']) if mask]
    assert tokenizer.decode(selected) == result['renderedTargetText']
    assert 'UNGRADED_TARGET_REASONING' not in result['renderedText']
    if case == 'tool-trajectory':
        assert '<tool_call>' in result['renderedText']
        reduced = [m for m in messages(candidate) if m.get('role') != 'tool' and not m.get('tool_calls')]
        reduced_text = tokenizer.apply_chat_template(reduced, tools=result['tools'], tokenize=False, add_generation_prompt=False, **kwargs)
        assert reduced_text != result['renderedText']
    if case == 'recovery':
        assert 'RECORDED_INTERRUPTION_REPAIR' in result['renderedText']
    if case == 'long-context':
        assert len(result['inputIds']) > 20_000
    atomic(private / (case + '.json'), {'candidate': candidate, 'render': result, 'requestEvidence': observed, 'fullExampleEvidence': full_observed})
    cases.append({'case': case, 'syntheticFixture': True, 'rowHash': result['rowHash'], 'tokens': len(result['inputIds']),
                  'lossTokens': len(selected), 'requestParity': True, 'fullExampleParity': True,
                  'maskHash': digest(result['lossMask']), 'renderHash': digest(result['renderedText'])})
    print(json.dumps(cases[-1]), flush=True)

atomic(output / 'renderer-final-synthetic-acceptance.json', {'route': route, 'templateKwargs': kwargs, 'cases': cases,
       'reasoningTransportField': 'reasoning', 'objective': 'synthetic final-answer format only; target reasoning omitted; source answer whitespace stripped explicitly for these controls', 'realCandidateAccepted': False, 'realCandidateRejection': 'renderer-real-candidate-rejection.json', 'toolDecisionMasksSupported': False,
       'productionThinkingTrainingApproved': False, 'sampledTokenIdsAvailable': False,
       'limitation': 'The engine tokenization endpoint validates tokens, not a trainer loss implementation. No training job executed.'})
