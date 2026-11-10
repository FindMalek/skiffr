#!/usr/bin/env bash
# Maps the branch diff plus uncommitted files to pnpm workspace packages.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

if git rev-parse --verify origin/main >/dev/null 2>&1; then BASE=origin/main
elif git rev-parse --verify main >/dev/null 2>&1; then BASE=main
else BASE=HEAD; fi

files=$(
  {
    git diff --name-only "$BASE"...HEAD 2>/dev/null || true
    git diff --name-only
    git diff --cached --name-only
    git ls-files --others --exclude-standard
  } | sed '/^$/d' | grep -Ev '^\.env' | sort -u
)

if [[ -z "$files" ]]; then
  echo "BASE=$BASE"
  echo "NO_CHANGES=1"
  exit 0
fi

dirs=""
while IFS= read -r file; do
  d=$(dirname "$file")
  while [[ "$d" != "." && "$d" != "/" ]]; do
    if [[ -f "$d/package.json" ]]; then
      dirs+="$d"$'\n'
      break
    fi
    d=$(dirname "$d")
  done
done <<<"$files"
dirs=$(printf '%s' "$dirs" | sed '/^$/d' | sort -u)

packages=""
filter=""
for d in $dirs; do
  name=$(node -p "require('./$d/package.json').name" 2>/dev/null || true)
  [[ -n "$name" ]] || continue
  packages+="$name "
  filter+="--filter=$name "
done

flag() { printf '%s\n' "$files" | grep -Eq "$1" && echo 1 || echo 0; }

echo "BASE=$BASE"
echo "FILES_COUNT=$(printf '%s\n' "$files" | wc -l | tr -d ' ')"
echo "PACKAGES=${packages% }"
echo "DIRS=$(printf '%s' "$dirs" | tr '\n' ' ')"
echo "FILTER=${filter% }"
echo "FLAGS=schema=$(flag '^packages/db/src/schema/') lockfile=$(flag '(^|/)pnpm-lock\.yaml$') github=$(flag '^\.github/') root=$(flag '^[^/]+$')"
echo "NO_CHANGES=0"
