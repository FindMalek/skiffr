#!/usr/bin/env bash
set -eu

echo "results: $*"
[ "$#" -gt 0 ] || { echo "no results to aggregate"; exit 1; }
for r in "$@"; do
  [ "$r" = "success" ] || { echo "not green: $r"; exit 1; }
done
