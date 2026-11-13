#!/bin/sh
# skiffr installer. Runs the whole stack (database, api, dashboard, site, docs) with Docker, asks nothing.
#
#   curl -fsSL https://raw.githubusercontent.com/FindMalek/skiffr/main/install.sh | sh
#   curl -fsSL https://raw.githubusercontent.com/FindMalek/skiffr/main/install.sh | sh -s -- --domain skiffr.example.com
#
# Options:
#   --domain <name>   serve on https://<name>, dashboard.<name>, api.<name> and docs.<name> with automatic certificates (needs DNS and ports 80, 443)
#   --port <n>        first of four local ports: site n, api n+1, dashboard n+2, docs n+3 (default 3000)
#   --version <tag>   pin a release, for example v0.1.0 (default: the latest release, which `./skiffr update` follows)
#   --email <addr>    login of the first admin (default admin@skiffr.local)
#   --autoupdate      also run the daily image updater (it needs the docker socket, see the docs)
#   --no-start        write the files and stop
#   --dir <path>      install folder (default ./skiffr)
#   --here            use the current folder, a clone of the repo (scripts/setup.sh does this)
#   --build           with --here: build the images from the source instead of pulling released ones
#
# Safe to run again: .env and the data volumes are never overwritten, only missing keys are added.
# A downloaded docker-compose.yml and skiffr helper are checked against the SHA256SUMS of the same release.
set -eu

REPO=${SKIFFR_REPO:-FindMalek/skiffr}
# A folder or url holding docker-compose.yml, skiffr and SHA256SUMS. Only for mirrors and tests: unset, files come from the GitHub release.
BASE_URL=${SKIFFR_BASE_URL:-}

say() { printf '%s\n' "$*"; }
warn() { printf 'warning: %s\n' "$*" >&2; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

usage() {
  if [ -f "$0" ]; then sed -n '2,/^set -eu/p' "$0" | sed -n '/^#/p' | sed 's/^# \{0,1\}//'
  else say "options: --domain --port --version --email --autoupdate --no-start --dir, see the top of install.sh in https://github.com/$REPO"
  fi
}

sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d ' ' -f 1
  elif have shasum; then shasum -a 256 "$1" | cut -d ' ' -f 1
  elif have openssl; then openssl dgst -sha256 "$1" | sed 's/^.*= //'
  else die "need sha256sum, shasum or openssl to verify the download"
  fi
}

random_hex() { LC_ALL=C tr -dc 'a-f0-9' </dev/urandom | head -c "$1"; }
random_word() { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; }
random_key() { head -c 32 /dev/urandom | base64 | tr -d '\n'; }

env_get() {
  if [ -f .env ]; then sed -n "s/^$1=//p" .env | tail -n 1; fi
}

# Sets KEY=value in .env, replacing an existing line. The value goes through the environment, so no escape is interpreted.
env_set() {
  [ -f .env ] || : >.env
  K=$1 V=$2 awk 'BEGIN { k = ENVIRON["K"] "="; v = ENVIRON["V"] }
    index($0, k) == 1 { if (!done) print k v; done = 1; next }
    { print }
    END { if (!done) print k v }' .env >.env.tmp
  mv .env.tmp .env
  chmod 600 .env
}

env_default() {
  if [ -z "$(env_get "$1")" ]; then env_set "$1" "$2"; fi
}

add_profile() {
  current=$(env_get COMPOSE_PROFILES)
  case ",$current," in
    *",$1,"*) ;;
    *) env_set COMPOSE_PROFILES "${current:+$current,}$1" ;;
  esac
}

# Remote downloads are https only (a redirect to plain http is refused). A test or mirror BASE_URL may be file:// or http.
curl_remote() {
  if [ -z "$BASE_URL" ]; then curl --proto '=https' --tlsv1.2 "$@"; else curl "$@"; fi
}

# Local probes must never go through a proxy from the environment
curl_local() { curl --noproxy '*' "$@"; }

fetch() { curl_remote -fsSL --retry 3 --connect-timeout 15 -o "$2" "$1"; }

# v1.2.3 or v1.2.3-rc.1: one line of letters, digits, dots and dashes, so it is safe in a url, in .env and in a shell word
valid_version() {
  case $1 in
    '' | *[!0-9A-Za-z.-]*) return 1 ;;
  esac
  printf '%s\n' "$1" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$'
}

valid_email() {
  case $1 in
    '' | *[!A-Za-z0-9._%+@-]*) return 1 ;;
  esac
  printf '%s\n' "$1" | grep -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'
}

# a lowercase host name with at least one dot and a letter in the last label (so no ip address)
valid_domain() {
  case $1 in
    '' | *[!a-z0-9.-]*) return 1 ;;
  esac
  [ "${#1}" -le 253 ] || return 1
  printf '%s\n' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$'
}

latest_tag() {
  url=$(curl_remote -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$REPO/releases/latest") || return 1
  tag=${url##*/}
  case $tag in
    v[0-9]*.[0-9]*.[0-9]*) printf '%s\n' "$tag" ;;
    *) return 1 ;;
  esac
}

# Downloads docker-compose.yml and skiffr of one release into $2 and checks them against that release's SHA256SUMS.
download_release() {
  tag=$1 into=$2
  if [ -n "$BASE_URL" ]; then base=$BASE_URL; else base="https://github.com/$REPO/releases/download/$tag"; fi
  fetch "$base/SHA256SUMS" "$into/SHA256SUMS" || die "could not download $base/SHA256SUMS"
  for name in docker-compose.yml skiffr; do
    fetch "$base/$name" "$into/$name" || die "could not download $base/$name"
    want=$(awk -v f="$name" '$2 == f { print $1 }' "$into/SHA256SUMS")
    [ -n "$want" ] || die "$name is not listed in the SHA256SUMS of $tag"
    [ "$(sha256_of "$into/$name")" = "$want" ] || die "checksum of $name does not match the $tag release, nothing was installed"
  done
}

check_docker() {
  have docker || die "docker is not installed. Install Docker Desktop (macOS, Windows) or Docker Engine (Linux): https://docs.docker.com/get-docker/"
  docker compose version >/dev/null 2>&1 || die "docker compose v2 is missing. Update Docker Desktop, or install the compose plugin: https://docs.docker.com/compose/install/"
  docker info >/dev/null 2>&1 || die "the docker daemon is not running. Start Docker Desktop (or: sudo systemctl start docker) and run this again"
  v=$(docker compose version --short 2>/dev/null | sed 's/^v//')
  major=${v%%.*}
  rest=${v#*.}
  minor=${rest%%.*}
  case $major$minor in
    '' | *[!0-9]*) return 0 ;;
  esac
  if [ "$major" -lt 2 ] || { [ "$major" -eq 2 ] && [ "$minor" -lt 24 ]; }; then
    die "docker compose $v is too old, 2.24 or newer is needed. Update Docker"
  fi
}

# curl exits 7 when nothing listens, any other result means something answers on that port
port_busy() {
  rc=0
  curl_local -s -m 1 -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null || rc=$?
  [ "$rc" -ne 7 ]
}

main() {
  domain='' port='' version='' email='' dir=skiffr start=1 here=0 build=0 autoupdate=0
  while [ $# -gt 0 ]; do
    case $1 in
      --domain) [ $# -ge 2 ] || die "--domain needs a value"; domain=$2; shift 2 ;;
      --domain=*) domain=${1#*=}; shift ;;
      --port) [ $# -ge 2 ] || die "--port needs a value"; port=$2; shift 2 ;;
      --port=*) port=${1#*=}; shift ;;
      --version) [ $# -ge 2 ] || die "--version needs a value"; version=$2; shift 2 ;;
      --version=*) version=${1#*=}; shift ;;
      --email) [ $# -ge 2 ] || die "--email needs a value"; email=$2; shift 2 ;;
      --email=*) email=${1#*=}; shift ;;
      --dir) [ $# -ge 2 ] || die "--dir needs a value"; dir=$2; shift 2 ;;
      --dir=*) dir=${1#*=}; shift ;;
      --autoupdate) autoupdate=1; shift ;;
      --no-start) start=0; shift ;;
      --here) here=1; shift ;;
      --build) build=1; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "unknown option $1 (try --help)" ;;
    esac
  done

  if [ -n "$domain" ]; then
    domain=$(printf '%s' "$domain" | LC_ALL=C tr '[:upper:]' '[:lower:]')
    valid_domain "$domain" || die "--domain must be a host name like skiffr.example.com (letters, digits, dots and dashes, at least one dot, not an ip address)"
  fi
  if [ -n "$domain" ] && [ -n "$port" ]; then die "use --domain or --port, not both"; fi
  if [ -n "$port" ]; then
    case $port in
      0* | *[!0-9]*) die "--port must be a plain number without leading zeros, like 4000" ;;
    esac
    if [ "${#port}" -gt 5 ] || [ "$port" -lt 1024 ] || [ "$port" -gt 65532 ]; then
      die "--port must be between 1024 and 65532 (four consecutive ports are used)"
    fi
  fi
  case $version in
    '' | latest) ;;
    [0-9]*) version=v$version ;;
  esac
  case $version in
    '' | latest) ;;
    *) valid_version "$version" || die "--version must look like v0.1.0 (or v0.1.0-rc.1) or be latest" ;;
  esac
  if [ -n "$email" ]; then
    valid_email "$email" || die "--email must be a plain address like you@example.com"
  fi
  if [ "$build" -eq 1 ] && [ "$here" -ne 1 ]; then die "--build needs --here, a clone of the repo"; fi

  check_docker
  have curl || die "curl is needed"
  umask 077

  existing=0
  cd_hint=''
  if [ "$here" -eq 1 ]; then
    if [ ! -f docker-compose.yml ]; then die "no docker-compose.yml here: run this from a clone of the repo"; fi
    dir=$(pwd)
  else
    case $dir in
      *' '*) cd_hint="cd \"$dir\" && " ;;
      *) cd_hint="cd $dir && " ;;
    esac
    mkdir -p "$dir"
    cd "$dir"
    dir=$(pwd)
    if [ -f docker-compose.yml ]; then existing=1; fi
  fi

  fresh=0
  [ -f .env ] || fresh=1

  if [ "$here" -ne 1 ] && { [ "$existing" -eq 0 ] || [ -n "$version" ]; }; then
    tag=${version:-latest}
    if [ -z "$BASE_URL" ] && [ "$tag" = latest ]; then
      tag=$(latest_tag) || die "no skiffr release is published yet. Clone the repo and run ./scripts/setup.sh --build instead"
    fi
    say "Downloading skiffr $tag"
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    download_release "$tag" "$tmp"
    if [ -f docker-compose.yml ]; then cp docker-compose.yml docker-compose.yml.bak; fi
    cp "$tmp/docker-compose.yml" docker-compose.yml
    cp "$tmp/skiffr" skiffr
    chmod 755 skiffr
  elif [ "$existing" -eq 1 ]; then
    say "Found an existing install in $dir, keeping its files and .env"
  fi

  if [ ! -f .env ]; then
    cat >.env <<'ENVEOF'
# skiffr settings. Written once by install.sh, never overwritten. Keep this file private (it is chmod 600) and back it up:
# losing BETTER_AUTH_SECRET signs everyone out, losing CV_ENCRYPTION_KEY means entering stored CV keys again.
# Apply changes with: docker compose up -d

# Optional AI keys. Blank is fine: profile, answers, queue and saved-answer fills work without them.
# GROQ_API_KEY maps form fields your saved answers do not cover (https://console.groq.com/keys),
# OPENAI_API_KEY adds similar-question suggestions (https://platform.openai.com/api-keys).
GROQ_API_KEY=
OPENAI_API_KEY=

# true: the api asks GitHub now and then for the latest release and GET /version says when an update exists. Sends nothing about you.
UPDATE_CHECK=false

# Other keys (Gmail, S3, github sign-in, observability, ...) are in the environment page of the docs.

ENVEOF
    chmod 600 .env
  fi

  env_default POSTGRES_PASSWORD "$(random_hex 32)"
  env_default BETTER_AUTH_SECRET "$(random_hex 64)"
  env_default CV_ENCRYPTION_KEY "$(random_key)"
  if [ -n "$email" ]; then env_set ADMIN_EMAIL "$email"; else env_default ADMIN_EMAIL admin@skiffr.local; fi
  new_admin=0
  if [ -z "$(env_get ADMIN_PASSWORD)" ]; then
    env_set ADMIN_PASSWORD "$(random_word 20)"
    new_admin=1
  fi

  if [ -n "$version" ]; then env_set SKIFFR_VERSION "$version"; else env_default SKIFFR_VERSION latest; fi

  if [ -n "$domain" ]; then
    env_set SKIFFR_DOMAIN "$domain"
    env_set WEB_URL "https://$domain"
    env_set DASHBOARD_URL "https://dashboard.$domain"
    env_set API_PUBLIC_URL "https://api.$domain"
    env_set DOCS_URL "https://docs.$domain"
    env_set TRUSTED_PROXY_COUNT 1
    add_profile domain
  else
    if [ -n "$port" ]; then
      env_set SKIFFR_WEB_PORT "$port"
      env_set SKIFFR_API_PORT $((port + 1))
      env_set SKIFFR_DASHBOARD_PORT $((port + 2))
      env_set SKIFFR_DOCS_PORT $((port + 3))
    fi
    if [ -n "$port" ] || [ -z "$(env_get WEB_URL)" ]; then
      env_set WEB_URL "http://localhost:$(env_get SKIFFR_WEB_PORT)"
      env_set API_PUBLIC_URL "http://localhost:$(env_get SKIFFR_API_PORT)"
      env_set DASHBOARD_URL "http://localhost:$(env_get SKIFFR_DASHBOARD_PORT)"
      env_set DOCS_URL "http://localhost:$(env_get SKIFFR_DOCS_PORT)"
    fi
  fi
  # the apps are published on the loopback address in both modes (behind Caddy too), so the ports always exist
  env_default SKIFFR_WEB_PORT 3000
  env_default SKIFFR_API_PORT 3001
  env_default SKIFFR_DASHBOARD_PORT 3002
  env_default SKIFFR_DOCS_PORT 3003
  if [ "$autoupdate" -eq 1 ]; then
    add_profile autoupdate
    case $(env_get SKIFFR_VERSION) in
      latest) ;;
      *) warn "SKIFFR_VERSION is pinned, so the updater has nothing to follow. Use --version latest to follow releases" ;;
    esac
  fi
  if [ "$build" -eq 1 ]; then env_set COMPOSE_FILE docker-compose.yml:docker-compose.build.yml; fi
  # a dev .env of the repo has SEED=demo, a real instance starts empty
  if [ "$here" -eq 1 ] && [ "$fresh" -eq 1 ]; then env_default SEED none; fi

  api_port=$(env_get SKIFFR_API_PORT)
  api_url=$(env_get API_PUBLIC_URL)
  dashboard_url=$(env_get DASHBOARD_URL)

  if [ "$start" -eq 0 ]; then
    say "Files written in $dir. Start it with:"
    say "  $cd_hint""docker compose up -d"
    return 0
  fi

  if [ -z "$(docker compose ps -q </dev/null 2>/dev/null)" ]; then
    for p in "$api_port" "$(env_get SKIFFR_WEB_PORT)" "$(env_get SKIFFR_DASHBOARD_PORT)" "$(env_get SKIFFR_DOCS_PORT)"; do
      if [ -n "$p" ] && port_busy "$p"; then die "port $p is already in use. Free it, or run again with --port <other> (four consecutive ports)"; fi
    done
  fi

  if [ "$build" -eq 1 ]; then
    say "Building the images from source and starting skiffr (the first build takes several minutes)"
    docker compose up -d --build --wait --wait-timeout 900 </dev/null || fail_start
  else
    say "Pulling the images and starting skiffr"
    docker compose pull </dev/null || fail_pull
    docker compose up -d --wait --wait-timeout 300 </dev/null || fail_start
  fi

  running=$(curl_local -fsS -m 5 "http://127.0.0.1:$api_port/version" 2>/dev/null | sed -n 's/.*"version":"\([^"]*\)".*/\1/p') || running=''
  say ""
  say "skiffr ${running:+v$running }is running."
  say ""
  say "  dashboard   $dashboard_url"
  say "  api         $api_url   (the url to paste in the extension)"
  say "  site        $(env_get WEB_URL)"
  say "  docs        $(env_get DOCS_URL)"
  say ""
  say "  sign in     $(env_get ADMIN_EMAIL)"
  if [ "$new_admin" -eq 1 ]; then
    say "  password    $(env_get ADMIN_PASSWORD)   (shown once, also in $dir/.env)"
    say "              the api resets the admin to the .env password on every start: change it there"
  else
    say "  password    ADMIN_PASSWORD in $dir/.env"
  fi
  say ""
  say "Next, the browser extension (about 60 seconds):"
  if [ "$build" -eq 1 ]; then
    say "  1. build it: pnpm install && pnpm --filter extension build, folder apps/extension/.output/chrome-mv3"
  else
    say "  1. download $api_url/downloads/skiffr-extension.zip and unzip it into a folder you keep"
  fi
  say "  2. open chrome://extensions, turn on Developer mode, Load unpacked, pick that folder"
  say "  3. sign in to the dashboard, open Extension, create a token, then paste $api_url and the token in the extension options"
  say ""
  helper=./skiffr
  if [ "$here" -eq 1 ]; then helper=./scripts/skiffr; fi
  if [ -n "$cd_hint" ]; then say "These run inside the folder, so start with: ${cd_hint%' && '}"; fi
  say "  $helper update    $helper status    $helper backup    docker compose down (stop)"
}

fail_pull() {
  die "could not pull the images. If this is before the first release, or the packages are private, clone the repo and use ./scripts/setup.sh --build"
}

fail_start() {
  docker compose ps </dev/null >&2 || true
  docker compose logs --tail 30 api </dev/null >&2 || true
  die "skiffr did not become healthy. The log above is the api's, see also: docker compose logs"
}

main "$@"
