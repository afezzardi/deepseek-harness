"""Verify unchanged real candidates against the observed engine with explicit template trimming."""
import copy
import hashlib
import json
import os
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'artifacts/plugins/gh-genai-traces/experiments'))
from phoenix_dataset import atomic, digest
from render_qwen import render, check_engine
from transformers import AutoTokenizer

output = Path(__file__).resolve().parent
for line in (root / '.env').read_text().splitlines():
    if line.startswith('LITELLM_MASTER_KEY='):
        os.environ['LITELLM_MASTER_KEY'] = line.split('=', 1)[1].strip().strip('\"\'')
tokenizer = AutoTokenizer.from_pretrained(output / '.tokenizer-active', local_files_only=True, trust_remote_code=False)
route = json.loads((output / 'deployed-route.json').read_text())
kwargs = {'enable_thinking': True, 'reasoning_effort': 'medium', 'preserve_thinking': False}
private = output / '.renderer-real'; private.mkdir(exist_ok=True, mode=0o700)
rows = []
negative = None
for campaign in ['pilot-r5', 'baseline-r5']:
    source = output / campaign / 'audit/candidates.jsonl'
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    for candidate in map(json.loads, source.read_text().splitlines()):
        if candidate['target']['policy'] != 'final-answer' or campaign == 'baseline-r5' and not candidate['sftEligible']:
            continue
        before = copy.deepcopy(candidate)
        result = render(candidate, tokenizer, kwargs, 'template-trim')
        assert result['templateHash'] == route['templateHash']
        request = check_engine(result, route)
        local = tokenizer.apply_chat_template(result['requestMessages'], tools=result['tools'] or None,
                   tokenize=True, return_dict=False, add_generation_prompt=True, **kwargs)
        assert request['response']['tokens'] == local
        full = check_engine(result, route, full_example=True)
        assert full['response']['tokens'] == result['inputIds']
        assert candidate == before
        row = {'campaign': campaign, 'rowHash': result['rowHash'], 'sftEligible': candidate['sftEligible'],
               'renderer': result['renderer'], 'templateHash': result['templateHash'], 'tokenizerFiles': result['tokenizerFiles'],
               'targetTransformation': result['targetTransformation'], 'tokens': len(result['inputIds']),
               'lossTokens': sum(result['lossMask']), 'inputHash': digest(result['inputIds']), 'maskHash': digest(result['lossMask']),
               'requestParity': True, 'fullExampleParity': True, 'canonicalCandidateUnchanged': True,
               'terminatorSupervised': result['terminatorSupervised'], 'sourceFileHash': source_hash}
        atomic(private / (campaign + '-' + result['rowHash'] + '.json'), {'render': result, 'request': request, 'fullExample': full})
        rows.append(row)
        if negative is None:
            altered = copy.deepcopy(result)
            altered['fullMessages'][-1]['content'] += 'X'
            changed = check_engine(altered, route, full_example=True)
            assert changed['response']['tokens'] != result['inputIds']
            negative = {'sourceRowHash': result['rowHash'], 'change': 'append one X to final answer',
                        'originalInputHash': digest(result['inputIds']), 'alteredInputHash': digest(changed['response']['tokens']), 'divergenceObserved': True}
        atomic(output / 'renderer-real-acceptance.json', {'rows': rows, 'negativeControl': negative,
               'policy': 'template-trim', 'complete': False, 'trainingReady': False})
        print(json.dumps({'completed': len(rows), 'campaign': campaign, 'tokens': row['tokens']}), flush=True)
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
atomic(output / 'renderer-real-acceptance.json', {'rows': rows, 'negativeControl': negative, 'policy': 'template-trim', 'complete': True,
       'trainingReady': False, 'objective': 'final-answer content only; earlier reasoning is context; final reasoning and terminator are unmasked',
       'limitation': 'Engine tokenization verifies serialization, not a training loss implementation or production thinking suitability.'})
