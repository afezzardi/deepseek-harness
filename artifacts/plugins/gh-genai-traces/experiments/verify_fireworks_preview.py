"""Compare native preview source, ordered loss segments, and pinned Qwen template text."""
import argparse
import copy
import hashlib
import importlib.metadata
import json
from pathlib import Path
import re

from phoenix_dataset import atomic, digest

# The observed JSON/tool adaptations apply only to this retained Qwen3.8 template revision.
ADAPTED_TEMPLATE_SHA256 = 'c3cf9e34abf4f9e36c2d72165aa9c132d3e2a725b6c2586aaa3a8af9d7a81041'


def compare_rendering(row, rendering, tokenizer, json_serialization='exact', tool_responses='grouped'):
    """Require one complete datum and exactly the selected assistant continuation under loss."""
    if rendering.get('error'):
        raise ValueError(rendering['error'])
    mode = rendering['thinkingTraceHistoryMode']
    modes = {'THINKING_TRACE_HISTORY_MODE_PRESERVED': True, 'THINKING_TRACE_HISTORY_MODE_INTERLEAVED': False}
    if mode not in modes:
        raise ValueError('Unsupported thinking-history mode')
    datums = rendering['renderedDatums']
    if len(datums) != 1 or datums[0].get('datumIndex') != 0:
        raise ValueError('Expected one selected assistant datum')
    segments = datums[0]['segments']
    if any(s.get('image') is not None or s.get('lossWeight', 0) not in (0, 1) for s in segments):
        raise ValueError('Unsupported preview segment or weight')
    template = tokenizer.chat_template
    if (json_serialization == 'ascii' or tool_responses == 'separate') and hashlib.sha256(template.encode()).hexdigest() != ADAPTED_TEMPLATE_SHA256:
        raise ValueError('JSON/tool adaptations require the pinned Qwen3.8 template SHA-256 ' + ADAPTED_TEMPLATE_SHA256)
    defaults = re.findall(r"set resolved_reasoning_effort = reasoning_effort\|default\('([^']+)'\)", template)
    if len(defaults) != 1:
        raise ValueError('Expected one literal resolved_reasoning_effort default in the Qwen template')
    conversation = copy.deepcopy(row['messages'])
    for message in conversation:
        for call in message.get('tool_calls', []):
            call['function']['arguments'] = json.loads(call['function']['arguments'])
    source_conversation = copy.deepcopy(conversation)
    if tool_responses == 'separate':
        for message in conversation:
            if message['role'] == 'tool':
                message['role'] = 'user'
                message['content'] = '<tool_response>\n' + message['content'].strip() + '\n</tool_response>'
    elif tool_responses != 'grouped':
        raise ValueError('Unsupported tool-response serialization')
    if json_serialization == 'ascii':
        if template.count('| tojson') != 2:
            raise ValueError('ASCII adaptation requires exactly two bare | tojson filters in the pinned template')
        try:
            probe = tokenizer.apply_chat_template([{'role': 'user', 'content': 'probe'}], tokenize=False,
                                                  chat_template="{{ 'é' | tojson(ensure_ascii=true) }}")
        except (TypeError, ValueError) as error:
            raise ValueError('Tokenizer/Jinja tojson must accept ensure_ascii=true for ASCII adaptation') from error
        if probe != '"\\u00e9"':
            raise ValueError('Tokenizer/Jinja tojson(ensure_ascii=true) must serialize é as "\\u00e9"')
        template = template.replace('| tojson', '| tojson(ensure_ascii=true)')
    elif json_serialization != 'exact':
        raise ValueError('Unsupported destination JSON serialization')
    kwargs = {'tools': row.get('tools') or None, 'preserve_thinking': modes[mode], 'tokenize': False,
              'add_generation_prompt': False, 'chat_template': template}
    full = tokenizer.apply_chat_template(conversation, **kwargs)
    if not full.endswith('<|im_end|>\n'):
        raise ValueError('Pinned template has an unsupported terminator')
    full = full.removesuffix('\n')
    native = ''.join(s['text'] for s in segments)
    if native != full:
        raise ValueError('Native preview differs from pinned template text')
    target = conversation[-1]
    marker = '__GH_REASONING_' + digest(row) + '__'
    marked = copy.deepcopy(conversation)
    marked[-1]['reasoning_content'] = marker
    marked_text = tokenizer.apply_chat_template(marked, **kwargs)
    if marked_text.count(marker) != 1:
        raise ValueError('Template does not expose one selected reasoning segment')
    prefix = marked_text.split(marker)[0]
    if not target.get('reasoning_content', '').strip():
        if not full.startswith(prefix + '\n</think>\n\n'):
            raise ValueError('Empty reasoning requires a masked newline followed by </think> and two newlines')
        prefix += '\n'
    if not full.startswith(prefix):
        raise ValueError('Selected continuation is not a template suffix')
    expected = full[len(prefix):]
    cursor = 0
    for segment in segments:
        end = cursor + len(segment['text'])
        if segment['text'] and ((cursor < len(prefix) < end) or segment.get('lossWeight', 0) != int(cursor >= len(prefix))):
            raise ValueError('Preview loss includes context or omits selected continuation')
        cursor = end
    trained = ''.join(s['text'] for s in segments if s.get('lossWeight', 0) > 0)
    if trained != expected or not trained:
        raise ValueError('Preview loss differs from selected continuation')
    collected = tokenizer.apply_chat_template(source_conversation, **{**kwargs, 'chat_template': tokenizer.chat_template,
                        'preserve_thinking': False, 'reasoning_effort': 'medium'}).removesuffix('\n')
    return {'nativeTemplateMatch': True, 'selectedLossMatch': True, 'terminatorSupervised': True,
            'jsonSerialization': json_serialization, 'toolResponses': tool_responses,
            'destinationTemplateHash': hashlib.sha256(template.encode()).hexdigest(),
            'emptyReasoningTarget': not bool(target.get('reasoning_content', '').strip()),
            'renderedTextHash': digest(native), 'lossTextHash': digest(trained), 'lossCharacters': len(trained),
            'matchesCollectionTemplateSettings': native == collected,
            'comparisonSettings': {'native': {'preserve_thinking': modes[mode], 'reasoning_effort': defaults[0]},
                                   'collection': {'preserve_thinking': False, 'reasoning_effort': 'medium'}}}


def verify(bundle, split, preview, tokenizer, json_serialization='exact', tool_responses='grouped'):
    """Bind every native source row to its exported line and preserve per-mode rejection evidence."""
    bundle, preview = Path(bundle), Path(preview)
    manifest = json.loads((bundle / 'manifest.json').read_text())
    file = bundle / (split + '.jsonl')
    if hashlib.sha256(file.read_bytes()).hexdigest() != manifest['files'][file.name]['sha256']:
        raise ValueError('Submitted dataset hash differs from bundle')
    submitted = [json.loads(line) for line in file.read_text().splitlines()]
    receipt = json.loads((preview / 'receipt.json').read_text())
    if not receipt['complete']:
        raise ValueError('Preview pagination is incomplete')
    seen, results, options = set(), [], None
    for page in receipt['pages']:
        native = json.loads((preview / page['file']).read_text())
        if digest(native) != page['responseHash'] or int(native['totalCount']) != len(submitted):
            raise ValueError('Native preview receipt or total count mismatch')
        if options is None:
            options = native['thinkingTraceHistoryModeOptions']
            mode_names = [option['mode'] for option in options]
            if not mode_names or len(set(mode_names)) != len(mode_names):
                raise ValueError('Native preview has empty or duplicate mode options')
        if options != native['thinkingTraceHistoryModeOptions']:
            raise ValueError('Native mode options changed between pages')
        for example in native['examples']:
            index = int(example['sourceJsonlRowIndex'])
            if index in seen or not 0 <= index < len(submitted) or int(example['sourceJsonlLineNumber']) != index + 1:
                raise ValueError('Native preview has duplicate or invalid source line identity')
            seen.add(index)
            if json.loads(example['sourceJsonl']) != submitted[index]:
                raise ValueError('Native preview source differs from submitted row')
            if example.get('error'):
                results.append({'line': index + 1, 'error': example['error']})
                continue
            if sorted(r['thinkingTraceHistoryMode'] for r in example['renderings']) != sorted(o['mode'] for o in options):
                raise ValueError('Preview rendering modes differ from advertised options')
            for rendering in example['renderings']:
                result = {'line': index + 1, 'submittedRowHash': digest(submitted[index]), 'mode': rendering['thinkingTraceHistoryMode']}
                option = next(o for o in options if o['mode'] == result['mode'])
                result['advertisedUnrollsMultiTurn'] = option.get('unrollsMultiTurn')
                result['observedDatumCount'] = len(rendering.get('renderedDatums', []))
                try:
                    result.update(compare_rendering(submitted[index], rendering, tokenizer, json_serialization, tool_responses))
                except ValueError as error:
                    result['error'] = str(error)
                results.append(result)
    if seen != set(range(len(submitted))):
        raise ValueError('Native preview omitted submitted rows')
    libraries = {}
    for name in ('transformers', 'tokenizers', 'jinja2'):
        try:
            libraries[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            libraries[name] = None
    return {'dataset': receipt['dataset'], 'baseModel': receipt['baseModel'], 'objective': manifest['objective'], 'libraries': libraries,
            'verifierSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'jsonSerialization': json_serialization,
            'toolResponses': tool_responses,
            'templateHash': hashlib.sha256(tokenizer.chat_template.encode()).hexdigest(), 'sourceRowsVerified': len(seen),
            'options': options, 'results': results, 'trainingReady': False, 'tokenIdsVerified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--split', choices=['train', 'validation', 'test'], required=True)
    parser.add_argument('--preview', required=True)
    parser.add_argument('--tokenizer', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--json-serialization', choices=['exact', 'ascii'], default='exact')
    parser.add_argument('--tool-responses', choices=['grouped', 'separate'], default='grouped')
    args = parser.parse_args()
    from transformers import AutoTokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.tokenizer, local_files_only=True, trust_remote_code=False)
    result = verify(args.bundle, args.split, args.preview, tokenizer, args.json_serialization, args.tool_responses)
    atomic(args.output, result)
    print(json.dumps({'sourceRowsVerified': result['sourceRowsVerified'], 'renderings': len(result['results']),
                      'errors': sum('error' in r for r in result['results'])}))
