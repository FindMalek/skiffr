#!/bin/sh
# Recreates the skiffr dashboards, saved log views, stream settings and alerts on an OpenObserve instance.
# Safe to run again: every object is looked up by name and updated in place, nothing is deleted.
#
#   OPENOBSERVE_URL=https://o2.example.net OPENOBSERVE_AUTH='Basic <base64 of email:password>' sh ops/openobserve/import.sh
#
# Optional: OPENOBSERVE_ORG (default "default"), OPENOBSERVE_STREAM (default "skiffr"), FOLDER (default "skiffr").
# Needs curl and jq. The auth value goes to curl through stdin, so it never shows up in the process list or in output.
set -eu

: "${OPENOBSERVE_URL:?set OPENOBSERVE_URL, for example https://o2.example.net}"
: "${OPENOBSERVE_AUTH:?set OPENOBSERVE_AUTH to the full Authorization header value, for example Basic abc123}"
ORG="${OPENOBSERVE_ORG:-default}"
STREAM="${OPENOBSERVE_STREAM:-skiffr}"
FOLDER="${FOLDER:-skiffr}"
BASE="${OPENOBSERVE_URL%/}"
DIR="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "jq is required" >&2; exit 1; }

# api METHOD PATH [BODYFILE] -> response body on stdout, fails on http >= 400
api() {
  method="$1"; path="$2"; body="${3:-}"
  out="$TMP/response"
  if [ -n "$body" ]; then
    code=$(printf 'header = "Authorization: %s"\n' "$OPENOBSERVE_AUTH" |
      curl -sS -K - -o "$out" -w '%{http_code}' -X "$method" -H 'Content-Type: application/json' --data-binary "@$body" "$BASE$path")
  else
    code=$(printf 'header = "Authorization: %s"\n' "$OPENOBSERVE_AUTH" |
      curl -sS -K - -o "$out" -w '%{http_code}' -X "$method" "$BASE$path")
  fi
  if [ "$code" -ge 400 ]; then
    echo "$method $path -> http $code: $(head -c 300 "$out")" >&2
    return 1
  fi
  cat "$out"
}

# ensure_folder TYPE -> prints the folder id, creates the folder when it is missing
ensure_folder() {
  type="$1"
  id=$(api GET "/api/v2/$ORG/folders/$type" | jq -r --arg n "$FOLDER" '.list[]? | select(.name == $n) | .folderId' | head -n 1)
  if [ -z "$id" ]; then
    jq -n --arg n "$FOLDER" --arg d "skiffr $type" '{name: $n, description: $d}' >"$TMP/folder.json"
    id=$(api POST "/api/v2/$ORG/folders/$type" "$TMP/folder.json" | jq -r '.folderId')
  fi
  echo "$id"
}

echo "folders"
DASH_FOLDER=$(ensure_folder dashboards)
ALERT_FOLDER=$(ensure_folder alerts)

echo "dashboards"
for f in "$DIR"/dashboards/*.json; do
  title=$(jq -r '.title' "$f")
  existing=$(api GET "/api/$ORG/dashboards?folder=$DASH_FOLDER&pageSize=500" |
    jq -c --arg t "$title" '[.dashboards[]? | select(.title == $t)] | first // empty')
  if [ -n "$existing" ]; then
    id=$(echo "$existing" | jq -r '.dashboard_id')
    hash=$(echo "$existing" | jq -r '.hash')
    api PUT "/api/$ORG/dashboards/$id?folder=$DASH_FOLDER&hash=$hash" "$f" >/dev/null
    echo "  updated $title ($id)"
  else
    id=$(api POST "/api/$ORG/dashboards?folder=$DASH_FOLDER" "$f" | jq -r '[.v1, .v2, .v3, .v4, .v5, .v6, .v7, .v8] | map(select(. != null)) | first | .dashboardId // empty')
    echo "  created $title ${id:+($id)}"
  fi
done

echo "saved views"
for f in "$DIR"/savedviews/*.json; do
  name=$(jq -r '.view_name' "$f")
  id=$(api GET "/api/$ORG/savedviews" | jq -r --arg n "$name" '[.views[]? | select(.view_name == $n)] | first | .view_id // empty')
  if [ -n "$id" ]; then
    api PUT "/api/$ORG/savedviews/$id" "$f" >/dev/null
    echo "  updated $name ($id)"
  else
    api POST "/api/$ORG/savedviews" "$f" >/dev/null
    echo "  created $name"
  fi
done

echo "stream settings ($STREAM)"
api PUT "/api/$ORG/streams/$STREAM/settings?type=logs" "$DIR/stream-settings.json" >/dev/null
echo "  applied (additive, nothing removed)"

echo "destinations (created only when missing, never overwritten)"
for f in "$DIR"/destinations/*.json; do
  name=$(jq -r '.name' "$f")
  if api GET "/api/$ORG/alerts/destinations" | jq -e --arg n "$name" 'any(.[]?; .name == $n)' >/dev/null; then
    echo "  kept $name"
  else
    api POST "/api/$ORG/alerts/destinations" "$f" >/dev/null
    echo "  created $name"
  fi
done

echo "alerts (created disabled, attach a destination before enabling)"
for f in "$DIR"/alerts/*.json; do
  name=$(jq -r '.name' "$f")
  id=$(api GET "/api/v2/$ORG/alerts?folder=$ALERT_FOLDER&page_size=500" |
    jq -r --arg n "$name" '[.list[]? | select(.name == $n)] | first | .alert_id // .id // empty')
  if [ -n "$id" ]; then
    # keep the enabled flag and destinations the owner already set
    cur=$(api GET "/api/v2/$ORG/alerts/$id?folder=$ALERT_FOLDER")
    jq --argjson cur "$cur" '.enabled = $cur.enabled | .destinations = $cur.destinations' "$f" >"$TMP/alert.json"
    api PUT "/api/v2/$ORG/alerts/$id?folder=$ALERT_FOLDER" "$TMP/alert.json" >/dev/null
    echo "  updated $name ($id)"
  else
    api POST "/api/v2/$ORG/alerts?folder=$ALERT_FOLDER" "$f" >/dev/null
    echo "  created $name"
  fi
done

echo "done"
