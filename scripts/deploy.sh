#!/usr/bin/env bash
# Q Proxy — deploy via Cloudflare API (curl only, no wrangler/node/git)
# Usage:
#   bash scripts/deploy.sh                              # full deploy (interactive)
#   bash scripts/deploy.sh --token T --password P       # full deploy (non-interactive)
#   bash scripts/deploy.sh --action update              # update worker script only
#   bash scripts/deploy.sh --action list-kv             # list KV namespaces
#   bash scripts/deploy.sh --action remove-kv           # remove KV namespace
#   bash scripts/deploy.sh --action status              # show worker + KV status
#   bash scripts/deploy.sh --action seed                # re-seed the worker
#   bash scripts/deploy.sh --action set-password        # set/change password
set -euo pipefail

REPO="QMahyar/q-proxy"
WORKER="q-proxy"
KV_TITLE="q-proxy-QPROXY_KV"
BINDING="QPROXY_KV"
SCRIPT_NAME="q-proxy.js"
BASE="https://api.cloudflare.com/client/v4"
COMPAT_DATE="2026-08-01"
TOKEN_URL="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all"

ok() { echo "$1" | grep -q '"success":true'; }
extract() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"//;s/".*//'; }
die() { echo "$1" >&2; exit 1; }
winpath() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || echo "$1"; }

cf() {
  local method="$1" path="$2"; shift 2
  local auth=(-H "Authorization: Bearer $TOKEN")
  [[ "$TOKEN" == cfk_* ]] && auth=(-H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL")
  curl -s -X "$method" "$BASE$path" "${auth[@]}" -H "Content-Type: application/json" "$@"
}

get_kv_id() {
  cf GET "/accounts/$ACCOUNT_ID/storage/kv/namespaces" \
    | grep -o "\"id\":\"[^\"]*\",\"title\":\"$KV_TITLE\"" | head -1 | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//'
}

get_subdomain() {
  cf PUT "/accounts/$ACCOUNT_ID/workers/subdomain" -d '{"enabled":true}' > /dev/null 2>&1 || true
  cf GET "/accounts/$ACCOUNT_ID/workers/subdomain" | extract subdomain
}

get_secure_path() {
  cf GET "/accounts/$ACCOUNT_ID/storage/kv/namespaces/$1/values/qproxy:settings" \
    | grep -o '"securePath":"[^"]*"' | head -1 | sed 's/"securePath":"//;s/"//'
}

ensure_kv() {
  local id; id=$(get_kv_id)
  if [[ -n "$id" ]]; then echo "Reusing existing KV: $id"; echo "$id"; return; fi
  echo "Creating KV namespace ($KV_TITLE)..."
  local r; r=$(cf POST "/accounts/$ACCOUNT_ID/storage/kv/namespaces" -d "{\"title\":\"$KV_TITLE\"}")
  id=$(echo "$r" | extract id)
  [[ -n "$id" ]] || id=$(get_kv_id)
  [[ -n "$id" ]] || die "KV creation failed: $r"
  echo "Created KV: $id"
  echo "$id"
}

detect_default_branch() {
  local br
  br=$(curl -fsSL "https://api.github.com/repos/$REPO" 2>/dev/null | grep -o '"default_branch"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*: *"//;s/"//')
  if [[ -n "$br" ]]; then echo "$br"; else echo "master"; fi
}

download_worker() {
  echo "Downloading $SCRIPT_NAME..."
  local out="$1"
  if curl -fsSL "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" -o "$out" 2>/dev/null; then
    :
  else
    local branch; branch=$(detect_default_branch)
    local fallback="main"
    [[ "$branch" == "main" ]] && fallback="master"
    curl -fsSL "https://raw.githubusercontent.com/$REPO/$branch/dist/$SCRIPT_NAME" -o "$out" 2>/dev/null || \
      curl -fsSL "https://raw.githubusercontent.com/$REPO/$fallback/dist/$SCRIPT_NAME" -o "$out" 2>/dev/null || \
      curl -fsSL "https://raw.githubusercontent.com/$REPO/master/dist/$SCRIPT_NAME" -o "$out"
  fi
  local size; size=$(wc -c < "$out" 2>/dev/null || echo 0)
  [[ "$size" -lt 10000 ]] && die "Download failed ($size bytes)"
  echo "Downloaded $size bytes"
}

upload_worker() {
  local script="$1" meta="$2"
  echo "Uploading worker..."
  local s_win m_win
  s_win=$(winpath "$script")
  m_win=$(winpath "$meta")
  local r
  r=$(cf PUT "/accounts/$ACCOUNT_ID/workers/scripts/$WORKER" \
    -F "metadata=@$m_win;type=application/json" \
    -F "$SCRIPT_NAME=@$s_win;filename=$SCRIPT_NAME;type=application/javascript+module")
  ok "$r" || die "Upload failed: $r"
  echo "Worker uploaded"
}

DRY=0; TOKEN=""; EMAIL=""; PASSWORD=""; ACTION="deploy"; KV_ID_TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=1; shift;;
    --token) TOKEN="$2"; shift 2;;
    --email) EMAIL="$2"; shift 2;;
    --password) PASSWORD="$2"; shift 2;;
    --action) ACTION="$2"; shift 2;;
    --kv-id) KV_ID_TARGET="$2"; shift 2;;
    --title) KV_TITLE="$2"; shift 2;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done

# auth
if [[ -z "$TOKEN" ]]; then
  echo ""
  echo "Open this URL to create an API token (pre-filled permissions):"
  echo "  $TOKEN_URL"
  echo ""
  read -rp "Paste API Token or Global Key (cfk_...): " TOKEN
fi
if [[ "$TOKEN" == cfk_* && -z "$EMAIL" ]]; then
  read -rp "Cloudflare email: " EMAIL
fi

ACCOUNT_ID=$(cf GET "/accounts?per_page=5" | extract id)
[[ -z "$ACCOUNT_ID" ]] && die "Failed to get account ID (bad token?)"
echo "Account: $ACCOUNT_ID"

WORKDIR=$(mktemp -d)
trap 'rm -rf "$WORKDIR"' EXIT
SCRIPT_FILE="$WORKDIR/q-proxy.js"
META_FILE="$WORKDIR/metadata.json"

case "$ACTION" in

list-kv)
  echo ""
  echo "KV Namespaces:"
  printf "%-40s %s\n" "ID" "Title"
  printf "%-40s %s\n" "----" "-----"
  cf GET "/accounts/$ACCOUNT_ID/storage/kv/namespaces" | tr '}' '\n' | while IFS= read -r obj; do
    id=$(echo "$obj" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')
    title=$(echo "$obj" | grep -o '"title":"[^"]*"' | head -1 | sed 's/"title":"//;s/"//')
    [[ -z "$id" || -z "$title" ]] && continue
    mark=""; [[ "$title" == "$KV_TITLE" ]] && mark=" *"
    printf "%-40s %s%s\n" "$id" "$title" "$mark"
  done
  echo ""
  echo "* = current project namespace"
  ;;

remove-kv)
  KV_ID=$(get_kv_id)
  [[ -z "$KV_ID" ]] && die "No Q Proxy KV found"
  echo "KV: $KV_ID ($KV_TITLE)"
  read -rp "Delete this KV namespace? (yes/no): " confirm
  [[ "$confirm" != "yes" ]] && die "Cancelled"
  cf DELETE "/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID" > /dev/null
  echo "KV deleted"
  ;;

status)
  echo ""
  WR=$(cf GET "/accounts/$ACCOUNT_ID/workers/scripts/$WORKER")
  if ok "$WR"; then
    echo "Worker: $WORKER"
    echo "  Modified: $(echo "$WR" | grep -o '"modified_on":"[^"]*"' | head -1 | sed 's/"modified_on":"//;s/"//')"
  else
    echo "Worker: not deployed"
  fi
  SUB=$(get_subdomain)
  [[ -n "$SUB" ]] && echo "  URL: https://$WORKER.$SUB.workers.dev"
  KV_ID=$(get_kv_id)
  if [[ -n "$KV_ID" ]]; then
    echo ""
    echo "KV: $KV_ID ($KV_TITLE)"
    SP=$(get_secure_path "$KV_ID")
    [[ -n "$SP" ]] && echo "  Panel: https://$WORKER.$SUB.workers.dev/$SP/panel"
  else
    echo ""
    echo "KV: not found"
  fi
  ;;

seed)
  SUB=$(get_subdomain)
  URL="https://$WORKER.$SUB.workers.dev"
  echo "Seeding $URL/ ..."
  curl -sf "$URL/" > /dev/null 2>&1 || true
  echo "Done"
  ;;

set-password)
  [[ -z "$PASSWORD" ]] && read -rp "New panel password: " PASSWORD
  KV_ID=$(get_kv_id)
  [[ -z "$KV_ID" ]] && die "No Q Proxy KV found. Deploy first."
  SUB=$(get_subdomain)
  [[ -z "$SUB" ]] && die "Could not get subdomain"
  URL="https://$WORKER.$SUB.workers.dev"
  SP=$(get_secure_path "$KV_ID")
  [[ -z "$SP" ]] && die "Could not read securePath. Seed first."
  SETUP=$(printf '{"newPassword":"%s"}' "$PASSWORD" | curl -s -X POST "$URL/$SP/api/auth/setup" -H "Content-Type: application/json" -H "X-Q-Panel: 1" -d @-)
  ok "$SETUP" && echo "Password set" || echo "Failed"
  ;;

update)
  KV_ID="${KV_ID_TARGET:-}"
  [[ -z "$KV_ID" ]] && KV_ID=$(get_kv_id)
  [[ -z "$KV_ID" ]] && die "No Q Proxy KV found. Deploy first."
  download_worker "$SCRIPT_FILE"
  [[ "$DRY" -eq 1 ]] && { echo "[dry] Would upload with KV $KV_ID"; exit 0; }
  printf '{"main_module":"%s","compatibility_date":"%s","bindings":[{"type":"kv_namespace","name":"%s","namespace_id":"%s"}]}' \
    "$SCRIPT_NAME" "$COMPAT_DATE" "$BINDING" "$KV_ID" > "$META_FILE"
  upload_worker "$SCRIPT_FILE" "$META_FILE"
  echo "Update complete"
  ;;

deploy)
  [[ -z "$PASSWORD" ]] && read -rp "First panel password [empty to set later]: " PASSWORD
  KV_ID=$(ensure_kv)
  download_worker "$SCRIPT_FILE"
  [[ "$DRY" -eq 1 ]] && { echo "[dry] Would upload worker with KV $KV_ID"; exit 0; }
  printf '{"main_module":"%s","compatibility_date":"%s","bindings":[{"type":"kv_namespace","name":"%s","namespace_id":"%s"}]}' \
    "$SCRIPT_NAME" "$COMPAT_DATE" "$BINDING" "$KV_ID" > "$META_FILE"
  upload_worker "$SCRIPT_FILE" "$META_FILE"

  SUB=$(get_subdomain)
  WORKER_URL="https://$WORKER.$SUB.workers.dev"
  echo "Worker URL: $WORKER_URL"

  echo "Seeding..."
  curl -sf "$WORKER_URL/" > /dev/null 2>&1 || true
  # KV is eventually consistent — wait 2s for propagation before reading securePath
  sleep 2

  SP=$(get_secure_path "$KV_ID")
  if [[ -n "$SP" && -n "$PASSWORD" ]]; then
    SETUP=$(printf '{"newPassword":"%s"}' "$PASSWORD" | curl -s -X POST "$WORKER_URL/$SP/api/auth/setup" -H "Content-Type: application/json" -H "X-Q-Panel: 1" -d @-)
    ok "$SETUP" && echo "Password set" || echo "Password setup failed (set manually)"
  fi

  echo ""
  if [[ -n "$SP" ]]; then
    echo "Panel:        $WORKER_URL/$SP/panel"
    echo "Subscription: $WORKER_URL/$SP/sub"
  else
    echo "Could not read securePath."
    echo "Check KV -> $KV_TITLE -> qproxy:settings -> data.securePath"
    echo "Panel: $WORKER_URL/<securePath>/panel"
  fi
  ;;

*) die "Unknown action: $ACTION (use deploy, update, list-kv, remove-kv, status, seed, set-password)" ;;
esac