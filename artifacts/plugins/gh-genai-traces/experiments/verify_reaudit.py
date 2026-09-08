"""Recompute review evidence from retained audit files without network access or inference."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
from phoenix_dataset import atomic


def verify(audit, receipt, source_hashes):
    audit = Path(audit)
    publication = json.loads((audit / 'curated-publication.json').read_text())
    grades = json.loads((audit / 'grades.json').read_text())
    summary = json.loads((audit / 'summary.json').read_text())
    ids = {e['id'] for e in publication['examples']}
    if len(ids) != len(publication['examples']) or ids != set(receipt['rowHashes']):
        raise ValueError('Curated target identities differ from the pinned receipt')
    versions = {g['grade']['version'] for g in grades}
    if len(versions) != 1 or len(grades) != summary['graded']:
        raise ValueError('Audit grade inventory differs')
    duplicates = [g['session'] for g in grades if len(g['grade']['observations']['tools']['evidence']) != len(set(g['grade']['observations']['tools']['evidence']))]
    if duplicates:
        raise ValueError('Repeated overall tool evidence')
    decisions = summary['toolDecisions']
    if decisions['considered'] != decisions['selected'] + len(decisions['rejections']):
        raise ValueError('Unaccounted tool-decision events')
    for file, expected in source_hashes.items():
        if hashlib.sha256(Path(file).read_bytes()).hexdigest() != expected:
            raise ValueError('Canonical source changed: ' + file)
    return {'graderVersion': next(iter(versions)), 'graded': len(grades), 'eligibleTargets': len(ids),
            'samePublishedTargetIdentities': True, 'publishedVersion': receipt['datasetVersion'],
            'consideredToolEvents': decisions['considered'], 'selectedToolEvents': decisions['selected'],
            'rejectedToolEvents': len(decisions['rejections']),
            'rejectionReasons': dict(Counter(r['reason'] for r in decisions['rejections'])),
            'duplicateToolEvidence': duplicates, 'canonicalFilesUnchanged': len(source_hashes),
            'nativePublicationPerformed': False, 'inferencePerformed': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--audit', required=True)
    parser.add_argument('--receipt', required=True)
    parser.add_argument('--source-hashes', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = verify(args.audit, json.loads(Path(args.receipt).read_text()), json.loads(Path(args.source_hashes).read_text()))
    atomic(args.output, result)
    print(json.dumps(result))
