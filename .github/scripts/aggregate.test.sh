#!/usr/bin/env bash
set -u

script="$(dirname "$0")/aggregate.sh"
failed=0

expect() {
  local want="$1"; shift
  bash "$script" "$@" >/dev/null 2>&1
  local got=$?
  if { [ "$want" = pass ] && [ "$got" -eq 0 ]; } || { [ "$want" = fail ] && [ "$got" -ne 0 ]; }; then
    echo "ok   $want: $*"
  else
    echo "FAIL expected $want, exit $got: $*"
    failed=1
  fi
}

expect pass success success success
expect fail success failure success
expect fail success skipped success
expect fail cancelled success success
expect fail success success failure
expect fail skipped
expect fail

exit "$failed"
