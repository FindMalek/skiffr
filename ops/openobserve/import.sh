#!/bin/sh
# Recreates the skiffr dashboards, saved log views, stream settings and alerts on an OpenObserve instance.
# Safe to run again: every object is looked up by name and updated in place, nothing is deleted.
# Any failed call stops the run, except the stream settings and the alerts, which can fail on an instance that has not
# received skiffr data yet: those are reported, the rest still runs, and the exit code is 1 at the end.
#
#   OPENOBSERVE_URL=https://o2.example.net OPENOBSERVE_AUTH='Basic <base64 of email:password>' sh ops/openobserve/import.sh
#
# Optional: OPENOBSERVE_ORG (default "default"), OPENOBSERVE_STREAM (default "skiffr"), OPENOBSERVE_FOLDER (default "skiffr").
# Needs curl and jq. The auth value goes to curl through stdin, so it never shows up in the process list or in output.
set -eu

: "${OPENOBSERVE_URL:?set OPENOBSERVE_URL, for example https://o2.example.net}"
: "${OPENOBSERVE_AUTH:?set OPENOBSERVE_AUTH to the full Authorization header value, for example Basic abc123}"
ORG="${OPENOBSERVE_ORG:-default}"
STREAM="${OPENOBSERVE_STREAM:-skiffr}"
FOLDER="${OPENOBSERVE_FOLDER:-skiffr}"
BASE="${OPENOBSERVE_URL%/}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
FAILED=0

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }
case "$BASE" in
  http://localhost* | http://127.0.0.1* | http://\[::1\]*) ;;
  http://*) echo "warning: $BASE is plain http, the Authorization header is sent in the clear" >&2 ;;
esac

# api METHOD PATH [BODYFILE] -> response body on stdout, returns 1 on any http status of 300 or more
api() {
  method="$1"; path="$2"; body="${3:-}"
  out="$TMP/response"
  if [ -n "$body" ]; then
    code=$(printf 'header = "Authorization: %s"\n' "$OPENOBSERVE_AUTH" |
      curl -sS --connect-timeout 10 --max-time 60 -K - -o "$out" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' --data-binary "@$body" "$BASE$path") || return 1
  else
    code=$(printf 'header = "Authorization: %s"\n' "$OPENOBSERVE_AUTH" |
      curl -sS --connect-timeout 10 --max-time 60 -K - -o "$out" -w '%{http_code}' -X "$method" "$BASE$path") || return 1
  fi
  if [ "$code" -ge 300 ]; then
    echo "$method $path -> http $code: $(head -c 300 "$out")" >&2
    return 1
  fi
  cat "$out"
}

# note_dupes NAME COUNT -> says so on stderr when more than one object has the name, the first one is used
note_dupes() {
  [ "$2" -gt 1 ] && echo "  note: $2 objects named $1, the first one is used" >&2
  return 0
}

# ensure_folder TYPE -> prints the folder id, creates the folder when it is missing
ensure_folder() {
  type="$1"
  res=$(api GET "/api/v2/$ORG/folders/$type") || return 1
  id=$(printf '%s\n' "$res" | jq -r --arg n "$FOLDER" '[.list[]? | select(.name == $n)] | first | .folderId // empty') || return 1
  if [ -z "$id" ]; then
    jq -n --arg n "$FOLDER" --arg d "skiffr $type" '{name: $n, description: $d}' >"$TMP/folder.json"
    res=$(api POST "/api/v2/$ORG/folders/$type" "$TMP/folder.json") || return 1
    id=$(printf '%s\n' "$res" | jq -r '.folderId // empty') || return 1
  fi
  [ -n "$id" ] || { echo "no folder id for $type" >&2; return 1; }
  printf '%s\n' "$id"
}

echo "folders"
DASH_FOLDER=$(ensure_folder dashboards) || exit 1
ALERT_FOLDER=$(ensure_folder alerts) || exit 1

echo "dashboards"
for f in "$DIR"/dashboards/*.json; do
  title=$(jq -r '.title' "$f")
  list=$(api GET "/api/$ORG/dashboards?folder=$DASH_FOLDER&pageSize=500") || exit 1
  existing=$(printf '%s\n' "$list" | jq -c --arg t "$title" '[.dashboards[]? | select(.title == $t)] | first // empty')
  note_dupes "$title" "$(printf '%s\n' "$list" | jq --arg t "$title" '[.dashboards[]? | select(.title == $t)] | length')"
  if [ -n "$existing" ]; then
    id=$(printf '%s\n' "$existing" | jq -r '.dashboard_id')
    hash=$(printf '%s\n' "$existing" | jq -r '.hash')
    api PUT "/api/$ORG/dashboards/$id?folder=$DASH_FOLDER&hash=$hash" "$f" >/dev/null || exit 1
    echo "  updated $title ($id)"
  else
    res=$(api POST "/api/$ORG/dashboards?folder=$DASH_FOLDER" "$f") || exit 1
    id=$(printf '%s\n' "$res" | jq -r '[.v1, .v2, .v3, .v4, .v5, .v6, .v7, .v8] | map(select(. != null)) | first | .dashboardId // empty')
    echo "  created $title ${id:+($id)}"
  fi
done

echo "saved views"
for f in "$DIR"/savedviews/*.json; do
  name=$(jq -r '.view_name' "$f")
  jq --arg o "$ORG" '.data.organizationIdentifier = $o' "$f" >"$TMP/view.json"
  list=$(api GET "/api/$ORG/savedviews") || exit 1
  id=$(printf '%s\n' "$list" | jq -r --arg n "$name" '[.views[]? | select(.view_name == $n)] | first | .view_id // empty')
  if [ -n "$id" ]; then
    api PUT "/api/$ORG/savedviews/$id" "$TMP/view.json" >/dev/null || exit 1
    echo "  updated $name ($id)"
  else
    api POST "/api/$ORG/savedviews" "$TMP/view.json" >/dev/null || exit 1
    echo "  created $name"
  fi
done

echo "stream settings ($STREAM)"
if api PUT "/api/$ORG/streams/$STREAM/settings?type=logs" "$DIR/stream-settings.json" >/dev/null; then
  echo "  applied (additive, nothing removed)"
else
  echo "  failed: has the api sent logs to $STREAM at least once? run the import again after it has" >&2
  FAILED=1
fi

echo "destinations (created only when missing, never overwritten)"
for f in "$DIR"/destinations/*.json; do
  name=$(jq -r '.name' "$f")
  list=$(api GET "/api/$ORG/alerts/destinations") || exit 1
  if printf '%s\n' "$list" | jq -e --arg n "$name" 'any(.[]?; .name == $n)' >/dev/null; then
    echo "  kept $name"
  else
    api POST "/api/$ORG/alerts/destinations" "$f" >/dev/null || exit 1
    echo "  created $name"
  fi
done

echo "alerts (created disabled, attach a destination before enabling)"
for f in "$DIR"/alerts/*.json; do
  name=$(jq -r '.name' "$f")
  list=$(api GET "/api/v2/$ORG/alerts?folder=$ALERT_FOLDER&page_size=500") || exit 1
  id=$(printf '%s\n' "$list" | jq -r --arg n "$name" '[.list[]? | select(.name == $n)] | first | .alert_id // .id // empty')
  if [ -n "$id" ]; then
    # keep the enabled flag and destinations the owner already set
    cur=$(api GET "/api/v2/$ORG/alerts/$id?folder=$ALERT_FOLDER") || exit 1
    jq --argjson cur "$cur" '.enabled = $cur.enabled | .destinations = $cur.destinations' "$f" >"$TMP/alert.json"
    if api PUT "/api/v2/$ORG/alerts/$id?folder=$ALERT_FOLDER" "$TMP/alert.json" >/dev/null; then
      echo "  updated $name ($id)"
    else
      FAILED=1
    fi
  elif api POST "/api/v2/$ORG/alerts?folder=$ALERT_FOLDER" "$f" >/dev/null; then
    echo "  created $name"
  else
    echo "  failed $name: does the stream it watches exist yet? run the import again after the api has sent data" >&2
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "finished with errors" >&2
  exit 1
fi
echo "done"
