"""Read-only inference metrics snapshots; no container or host reconfiguration."""
import json
from pathlib import Path
import subprocess
import sys
import time

output = Path(sys.argv[1])
for _ in range(int(sys.argv[2])):
    command = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'afezzardi@100.108.76.12',
               'docker exec kb-vllm-chat-nvfp4 python3 -c \'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8000/metrics", timeout=5).read().decode())\'']
    result = subprocess.run(command, capture_output=True, text=True, timeout=15)
    with output.open('a') as stream:
        stream.write(json.dumps(dict(time=time.time(), exit_code=result.returncode, metrics=result.stdout, error=result.stderr))+'\n')
    time.sleep(2)
