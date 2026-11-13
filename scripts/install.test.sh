#!/bin/sh
# Tests install.sh and scripts/skiffr with a fake docker and a local release folder. No network, no docker daemon needed.
#   sh scripts/install.test.sh
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
real_curl=$(command -v curl)
failures=0

pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s\n' "$1"; failures=$((failures + 1)); }
check() { # name, then a command that must succeed
  name=$1
  shift
  if "$@"; then pass "$name"; else fail "$name"; fi
}
has() { grep -q -- "$2" "$1"; }

mkdir -p "$work/bin" "$work/rel"
cat >"$work/bin/docker" <<'EOF2'
#!/bin/sh
echo "$*" >>"$FAKE_LOG"
case "$*" in
  "compose version --short") echo 2.40.0 ;;
  *pg_dump*) echo "-- dump" ;;
esac
exit 0
EOF2
cat >"$work/bin/curl" <<'EOF2'
#!/bin/sh
echo "$*" >>"$CURL_LOG"
exec "$REAL_CURL" "$@"
EOF2
chmod +x "$work/bin/docker" "$work/bin/curl"

cp "$here/docker-compose.yml" "$work/rel/docker-compose.yml"
cp "$here/scripts/skiffr" "$work/rel/skiffr"
sum() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi
}
(cd "$work/rel" && sum docker-compose.yml skiffr >SHA256SUMS)

export FAKE_LOG="$work/docker.log" CURL_LOG="$work/curl.log" REAL_CURL="$real_curl"
export SKIFFR_BASE_URL="file://$work/rel"
: >"$FAKE_LOG"
: >"$CURL_LOG"

# runs install.sh in a fresh folder $1 with the remaining arguments, output in $work/out
run() {
  case_dir=$work/$1
  shift
  mkdir -p "$case_dir"
  (cd "$case_dir" && PATH="$work/bin:$PATH" sh "$here/install.sh" "$@") >"$work/out" 2>&1 || return 1
}

# first install
run a --no-start --port 47310
check "install writes .env with mode 600" sh -c "ls -ld '$work/a/skiffr/.env' | cut -c1-10 | grep -q '^-rw-------$'"
check "install generates every secret" sh -c "grep -Eq '^POSTGRES_PASSWORD=[a-f0-9]{32}$' '$work/a/skiffr/.env' && grep -Eq '^BETTER_AUTH_SECRET=[a-f0-9]{64}$' '$work/a/skiffr/.env' && grep -Eq '^CV_ENCRYPTION_KEY=[A-Za-z0-9+/]{43}=$' '$work/a/skiffr/.env' && grep -Eq '^ADMIN_PASSWORD=[A-Za-z0-9]{20}$' '$work/a/skiffr/.env'"
check "ports follow --port" sh -c "grep -q '^SKIFFR_API_PORT=47311$' '$work/a/skiffr/.env' && grep -q '^DASHBOARD_URL=http://localhost:47312$' '$work/a/skiffr/.env'"
check "--no-start tells the user to cd into the folder" has "$work/out" "cd skiffr && docker compose up -d"

# running it again changes nothing
cp "$work/a/skiffr/.env" "$work/env.before"
run a --no-start --port 47310
check "a rerun leaves .env byte identical" cmp -s "$work/a/skiffr/.env" "$work/env.before"

# bad input is refused before anything is written
for bad in 04000 09000 80 70000 4e3; do
  rm -rf "$work/p"
  if run p --no-start --port "$bad"; then fail "--port '$bad' must be refused"; else
    if [ -e "$work/p/skiffr/.env" ]; then fail "--port '$bad' wrote .env"; else pass "--port '$bad' refused, nothing written"; fi
  fi
done
check "--port with a leading zero explains why" sh -c "cd '$work' && PATH='$work/bin:$PATH' sh '$here/install.sh' --no-start --port 04000 2>&1 | grep -q 'leading zeros'"

# shellcheck disable=SC2016
for bad in 'v1.0.0/../../x' 'v1.2.3 $(id)' 'v1.2.3?x=1' 'v1.2' 'latestt' 'v1.2.3
v9.9.9'; do
  rm -rf "$work/v"
  if run v --no-start --version "$bad"; then fail "--version '$bad' must be refused"; else pass "--version refused: $(printf %s "$bad" | tr '\n' '~')"; fi
done
rm -rf "$work/v"
check "--version 1.2.3 is normalised to v1.2.3" sh -c "cd '$work' && mkdir -p v && cd v && PATH='$work/bin:$PATH' sh '$here/install.sh' --no-start --version 1.2.3 >/dev/null 2>&1 && grep -q '^SKIFFR_VERSION=v1.2.3$' skiffr/.env"

# shellcheck disable=SC2016
for bad in 'a@b.c
TRUSTED_PROXY_COUNT=9' 'me@$HOME.com' 'a#b@c.de' 'noatsign' 'a b@c.de'; do
  rm -rf "$work/e"
  if run e --no-start --email "$bad"; then fail "--email must be refused"; else pass "--email refused: $(printf %s "$bad" | tr '\n' '~')"; fi
done
rm -rf "$work/e"
run e --no-start --email me.one+x@example.com
check "--email is written as is" has "$work/e/skiffr/.env" '^ADMIN_EMAIL=me.one+x@example.com$'

for bad in -evil.example.com .example.com a..example.com 1.2.3.4 localhost 'a_b.example.com' 'x.example.com/path' 'x.example.com;id'; do
  rm -rf "$work/d"
  if run d --no-start --domain "$bad"; then fail "--domain '$bad' must be refused"; else pass "--domain refused: $bad"; fi
done
rm -rf "$work/d"
run d --no-start --domain Skiffr.Example.com
check "--domain is lowercased everywhere" sh -c "grep -q '^DASHBOARD_URL=https://dashboard.skiffr.example.com$' '$work/d/skiffr/.env' && grep -q '^SKIFFR_DOMAIN=skiffr.example.com$' '$work/d/skiffr/.env'"
check "domain mode still writes the loopback ports" sh -c "grep -q '^SKIFFR_API_PORT=3001$' '$work/d/skiffr/.env' && grep -q '^COMPOSE_PROFILES=domain$' '$work/d/skiffr/.env'"

# a checksum mismatch installs nothing
rm -rf "$work/bad-rel" "$work/t"
cp -r "$work/rel" "$work/bad-rel"
echo "# tampered" >>"$work/bad-rel/docker-compose.yml"
mkdir -p "$work/t"
if (cd "$work/t" && PATH="$work/bin:$PATH" SKIFFR_BASE_URL="file://$work/bad-rel" sh "$here/install.sh" --no-start >"$work/out" 2>&1); then fail "tampered compose accepted"; else
  if [ -e "$work/t/skiffr/docker-compose.yml" ] || [ -e "$work/t/skiffr/.env" ]; then fail "tampered compose left files"; else pass "tampered compose rejected, nothing installed"; fi
fi

# a full start: local probes bypass a proxy from the environment, and the next steps start with cd
: >"$CURL_LOG"
rm -rf "$work/s"
run s --port 47320
check "start output says cd skiffr first" has "$work/out" "start with: cd skiffr"
check "start output prints the admin password once" has "$work/out" "shown once"
check "docker compose up -d --wait was run" has "$FAKE_LOG" "compose up -d --wait"
check "every probe of 127.0.0.1 passes --noproxy" sh -c "! grep '127.0.0.1' '$CURL_LOG' | grep -v -- '--noproxy' | grep -q ."
check "the version probe targets the api port" has "$CURL_LOG" "127.0.0.1:47321/version"
check "domain mode probes the loopback api port too" sh -c "cd '$work' && rm -rf s2 && mkdir s2 && cd s2 && : >'$CURL_LOG' && PATH='$work/bin:$PATH' sh '$here/install.sh' --domain skiffr.example.com >/dev/null 2>&1; grep -q '127.0.0.1:3001/version' '$CURL_LOG'"

# update: backup first, then fetch, and --no-backup skips it
cd "$work/s/skiffr"
: >"$FAKE_LOG"
PATH="$work/bin:$PATH" ./skiffr update --version v0.1.0 >"$work/out" 2>&1 || fail "update failed: $(tail -3 "$work/out")"
check "update dumps the database before pulling" sh -c "grep -n 'pg_dump' '$FAKE_LOG' | head -1 | cut -d: -f1 > '$work/l1'; grep -n 'compose pull' '$FAKE_LOG' | head -1 | cut -d: -f1 > '$work/l2'; [ \"\$(cat '$work/l1')\" -lt \"\$(cat '$work/l2')\" ]"
check "the backup file exists and is private" sh -c "ls -l '$work/s/skiffr/backups'/*.sql.gz | cut -c1-10 | grep -q '^-rw-------$'"
check "update pins the version it was asked for" has .env '^SKIFFR_VERSION=v0.1.0$'
: >"$FAKE_LOG"
PATH="$work/bin:$PATH" ./skiffr update --version v0.1.0 --no-backup >/dev/null 2>&1 || fail "update --no-backup failed"
check "--no-backup skips the dump" sh -c "! grep -q pg_dump '$FAKE_LOG'"
: >"$FAKE_LOG"
if PATH="$work/bin:$PATH" ./skiffr update --version 'v1.0.0/../x' >/dev/null 2>&1; then fail "update accepted a hostile version"; else
  check "a hostile version stops update before any backup" sh -c "! grep -q pg_dump '$FAKE_LOG'"
fi
cd "$work"

if [ "$failures" -ne 0 ]; then
  printf '%s test(s) failed\n' "$failures"
  exit 1
fi
printf 'all install tests passed\n'
