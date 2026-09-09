"""Capture the Fireworks dataset renderer preview without inference or training jobs."""
import argparse
import configparser
import json
import os
from pathlib import Path
import urllib.error
import urllib.request

from phoenix_dataset import atomic, digest


def api_key():
    """Read environment or default firectl credentials without exposing them in command arguments."""
    if os.environ.get('FIREWORKS_API_KEY'):
        return os.environ['FIREWORKS_API_KEY']
    config = configparser.ConfigParser(interpolation=None)
    config.read_string('[default]\n' + (Path.home() / '.fireworks/auth.ini').read_text())
    key = config['default'].get('api_key', '').strip()
    if not key:
        raise ValueError('Set FIREWORKS_API_KEY or configure the default firectl API key')
    return key


def capture(dataset, model, output, context_length, page_size=1):
    """Persist each native preview page, response hash, and request, including rejected requests."""
    if len(dataset.split('/')) != 4 or not dataset.startswith('accounts/') or dataset.split('/')[2] != 'datasets':
        raise ValueError('Expected accounts/<account>/datasets/<dataset> resource name')
    key = api_key()
    output = Path(output)
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    token, seen, pages = '', set(), []
    while True:
        body = {'baseModel': model, 'contextLength': context_length, 'pageSize': page_size, 'pageToken': token}
        request = urllib.request.Request('https://api.fireworks.ai/v1/' + dataset + ':renderPreview',
                                         data=json.dumps(body).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                value = json.load(response)
        except urllib.error.HTTPError as error:
            atomic(output / 'error.json', {'status': error.code, 'body': error.read().decode(), 'request': body})
            raise ValueError(f'Fireworks preview HTTP {error.code}; see {output / "error.json"}') from None
        name = f'page-{len(pages):04d}.json'
        atomic(output / name, value)
        pages.append({'file': name, 'request': body, 'responseHash': digest(value)})
        atomic(output / 'receipt.json', {'dataset': dataset, 'baseModel': model, 'pages': pages, 'complete': not value.get('nextPageToken')})
        token = value.get('nextPageToken', '')
        if not token:
            return {'pages': len(pages), 'totalCount': value.get('totalCount'), 'options': value.get('thinkingTraceHistoryModeOptions')}
        if token in seen:
            raise ValueError('Fireworks preview repeated a pagination cursor')
        seen.add(token)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('dataset')
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--context-length', type=int, required=True)
    parser.add_argument('--page-size', type=int, default=1)
    args = parser.parse_args()
    print(json.dumps(capture(args.dataset, args.model, args.output, args.context_length, args.page_size)))
