#!/usr/bin/env bash
# Decode the latest session log and print PASS/FAIL for one UAT case's
# log-level criteria.
#
#   ./artifacts/harness-tests/check.sh B1.4                     # newest session
#   ./artifacts/harness-tests/check.sh B4.1 <log.zstd>           # a named session
#   ./artifacts/harness-tests/check.sh B3.1 '' /abs/path.txt     # a re-run that used another path
#
# Cases with criteria: B1.4, B3.1, B3.2, B4.1 -- the ones that can be recorded
# PASS from the screen while the thing under test never ran. Run it from the
# repo root: file-existence criteria resolve paths against the workspace root.
#
# Exit status is the verdict: 0 PASS, 1 FAIL, 2 usage or decode failure.
set -uo pipefail

CASE="${1:-}"
if [ -z "$CASE" ]; then
  echo "usage: check.sh <B1.4|B3.1|B3.2|B4.1> [session.jsonl.zstd]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${2:-}"
if [ -z "$LOG" ]; then
  # Newest by mtime across every project, so a web session and a headless run
  # are equally reachable without naming a session id.
  LOG="$(find "${DSH_HOME:-$HOME/.dsh}/sessions" -name 'session.jsonl.zstd' -printf '%T@ %p\n' \
    | sort -rn | head -1 | cut -d' ' -f2-)"
fi
if [ ! -f "$LOG" ]; then
  echo "check.sh: no session log found ($LOG)" >&2
  exit 2
fi

DECODED="$(mktemp -t dsh-check-XXXXXX.jsonl)"
trap 'rm -f "$DECODED"' EXIT

echo "case:    $CASE"
echo "session: $LOG"
# read-session-log.mts reports frame count and any torn tail on stderr. A torn
# tail means the writer was mid-append: the newest events may be missing, so a
# FAIL on an event that should exist is worth re-running rather than recording.
FRAMES="$(node --import tsx/esm "$ROOT/artifacts/read-session-log.mts" "$LOG" "$DECODED" 2>&1 >/dev/null)" || {
  echo "check.sh: decode failed: $FRAMES" >&2
  exit 2
}
echo "decoded: $FRAMES"
case "$FRAMES" in
  *torn=none*) ;;
  *) echo "WARNING: torn frame -- the log was mid-append. Re-run if an expected event is missing." ;;
esac
echo

cd "$ROOT" || exit 2
node --import tsx/esm "$ROOT/artifacts/harness-tests/check-case.mts" "$CASE" "$DECODED" ${3+"$3"}
