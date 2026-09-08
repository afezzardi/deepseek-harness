"""Private PostgreSQL/source backups and isolated restore verification for Phoenix."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tarfile
import uuid
from phoenix_dataset import atomic

ROOT = Path(__file__).resolve().parents[4]
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'artifacts/plugins/gh-genai-traces/stack/compose.yml')]


def pg(*args, **kwargs):
    return subprocess.run(COMPOSE + ['exec', '-T', 'postgres', *args], check=True, **kwargs)


def sha(file):
    digest = hashlib.sha256()
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def inventory(root):
    result = {}
    for file in sorted(Path(root).rglob('*')):
        if file.is_symlink():
            raise ValueError('Source inventory contains a symlink: ' + str(file))
        if file.is_file():
            result[str(file.relative_to(root))] = sha(file)
    return result


def database_evidence(database):
    # Compare actual dataset content, version metadata, experiment evidence, and trace identities.
    tables = ['datasets', 'dataset_versions', 'dataset_examples', 'dataset_example_revisions', 'dataset_splits', 'dataset_split_dataset_examples', 'experiments', 'experiment_runs']
    result = {}
    available = pg('psql', '-U', 'phoenix', '-d', database, '-Atc', "select tablename from pg_tables where schemaname='public'", stdout=subprocess.PIPE).stdout.decode().splitlines()
    tables = sorted(set(tables) | {name for name in available if name.startswith(('dataset_', 'experiment_'))})
    for table in tables:
        if table not in available:
            continue
        query = f"select coalesce(string_agg(md5(to_jsonb(t)::text), '' order by md5(to_jsonb(t)::text)), '') from {table} t"
        result[table] = hashlib.sha256(pg('psql', '-U', 'phoenix', '-d', database, '-Atc', query, stdout=subprocess.PIPE).stdout).hexdigest()
    if not {'datasets', 'dataset_versions', 'dataset_example_revisions'} <= result.keys():
        raise RuntimeError('Phoenix dataset tables missing')
    return result


def create(output, sources):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    source_roots = [Path(source).resolve() for source in sources]
    before = {str(i): {'root': str(root), 'files': inventory(root)} for i, root in enumerate(source_roots)}
    fd = os.open(output / 'phoenix.dump', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        pg('pg_dump', '-U', 'phoenix', '-d', 'phoenix', '-Fc', stdout=stream)
        stream.flush(); os.fsync(stream.fileno())
    archive = output / 'sources.tar.gz'
    with os.fdopen(os.open(archive, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as stream:
        with tarfile.open(fileobj=stream, mode='w:gz') as tar:
            for i, root in enumerate(source_roots):
                tar.add(root, arcname=str(i), recursive=True)
    after = {str(i): {'root': str(root), 'files': inventory(root)} for i, root in enumerate(source_roots)}
    if before != after:
        raise RuntimeError('Canonical sources changed during backup; retry from a quiescent source set')
    manifest = {'version': 2, 'sources': before, 'dumpHash': sha(output / 'phoenix.dump'), 'archiveHash': sha(archive),
                'databaseEvidence': database_evidence('phoenix')}
    atomic(output / 'manifest.json', manifest)
    return {'backup': str(output), 'sources': len(source_roots), 'files': sum(len(s['files']) for s in before.values())}


def restore_check(backup, output):
    backup, output = Path(backup), Path(output)
    manifest = json.loads((backup / 'manifest.json').read_text())
    if manifest.get('version') != 2:
        raise ValueError('Restore requires a version-2 backup manifest')
    if sha(backup / 'phoenix.dump') != manifest['dumpHash'] or sha(backup / 'sources.tar.gz') != manifest['archiveHash']:
        raise RuntimeError('Backup hash mismatch')
    output.mkdir(parents=True, exist_ok=False, mode=0o700)
    with tarfile.open(backup / 'sources.tar.gz') as tar:
        tar.extractall(output / 'sources', filter='data')
    for key, source in manifest['sources'].items():
        if inventory(output / 'sources' / key) != source['files']:
            raise RuntimeError('Restored source hash mismatch: ' + key)
    database = 'gh_restore_' + uuid.uuid4().hex
    pg('createdb', '-U', 'phoenix', database)
    try:
        with (backup / 'phoenix.dump').open('rb') as stream:
            pg('pg_restore', '-U', 'phoenix', '-d', database, '--exit-on-error', stdin=stream)
        actual = database_evidence(database)
        if actual != manifest['databaseEvidence']:
            raise RuntimeError('Restored Phoenix dataset/version/provenance differs')
        receipt = {'restored': True, 'isolatedDatabase': database, 'databaseEvidence': actual,
                   'sourceInventoriesVerified': len(manifest['sources']), 'dumpHash': manifest['dumpHash']}
        atomic(output / 'receipt.json', receipt)
        return receipt
    finally:
        pg('dropdb', '-U', 'phoenix', database)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['create', 'restore-check'])
    parser.add_argument('directory')
    parser.add_argument('--output', required=True)
    parser.add_argument('--source', action='append', default=[])
    args = parser.parse_args()
    result = create(args.output, args.source) if args.operation == 'create' else restore_check(args.directory, args.output)
    print(json.dumps(result))
