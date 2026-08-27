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
TOKEN_URL="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all"

DRY=0; TOKEN=""; EMAIL=""; PASSWORD=""; ACTION="deploy"; KV_ID_TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=1; shift;;
    --token) TOKEN="$2"; shift 2;;
    --email) EMAIL="$2"; shift 2;;
    --password) PASSWORD="$2"; shift 2;;
    --action) ACTION="$2"; shift 2;;
    --kv-id) KV_ID_TARGET="$2"; shift 2;;
    *) shift;;
  esac
done

# ── helpers ──────────────────────────────────────────────────────────────────
auth_header() {
  if [[ "$TOKEN" == cfk_* ]]; then
    echo "-H X-Auth-Key:$TOKEN -H X-Auth-Email:$EMAIL"
  else
    echo "-H Authorization:Bearer$TOKEN"
  fi
}

cf() {
  local method="$1" path="$2"; shift 2
  local hdr; hdr=$(auth_header)
  # shellcheck disable=SC2086
  local resp; resp=$(curl -s -w '\n%{http_code}' -X "$method" "$BASE$path" \
    -H "Content-Type: application/json" $hdr "$@")
  local body status; body=$(echo "$resp" | sed '$d'); status=$(echo "$resp" | tail -1)
  echo "$body"
}

cf_post() {
  local path="$1" data="$2"
  if [[ "$TOKEN" == cfk_* ]]; then
    curl -s -X POST "$BASE$path" \
      -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" -H "Content-Type: application/json" \
      -d "$data"
  else
    curl -s -X POST "$BASE$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "$data"
  fi
}

cf_put() {
  local path="$1" data="${2:-}"
  if [[ "$TOKEN" == cfk_* ]]; then
    curl -s -X PUT "$BASE$path" \
      -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" -H "Content-Type: application/json" \
      ${data:+-d "$data"}
  else
    curl -s -X PUT "$BASE$path" \
      -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      ${data:+-d "$data"}
  fi
}

cf_get() {
  local path="$1"
  if [[ "$TOKEN" == cfk_* ]]; then
    curl -s "$BASE$path" -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL"
  else
    curl -s "$BASE$path" -H "Authorization: Bearer $TOKEN"
  fi
}

ok() { echo "$1" | grep -q '"success":true'; }
extract() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"//;s/".*//'; }
die() { echo "$1" >&2; exit 1; }

get_kv_id() {
  local r; r=$(cf_get "/accounts/$ACCOUNT_ID/storage/kv/namespaces")
  echo "$r" | grep -o "\"id\":\"[^\"]*\",\"title\":\"$KV_TITLE\"" | head -1 | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//'
}

get_subdomain() {
  cf_put "/accounts/$ACCOUNT_ID/workers/subdomain" '{"enabled":true}' > /dev/null 2>&1 || true
  local r; r=$(cf_get "/accounts/$ACCOUNT_ID/workers/subdomain")
  echo "$r" | extract "subdomain"
}

get_secure_path() {
  local r; r=$(cf_get "/accounts/$ACCOUNT_ID/storage/kv/namespaces/$1/values/qproxy:settings")
  echo "$r" | grep -o '"securePath":"[^"]*"' | head -1 | sed 's/"securePath":"//;s/"//'
}

# ── auth ─────────────────────────────────────────────────────────────────────
if [[ -z "$TOKEN" ]]; then
  echo ""
  echo "Open this URL to create an API token (pre-filled permissions):"
  echo ""
  echo "  $TOKEN_URL"
  echo ""
  read -rp "Paste API Token or Global Key (cfk_...): " TOKEN
fi
if [[ "$TOKEN" == cfk_* && -z "$EMAIL" ]]; then
  read -rp "Cloudflare email: " EMAIL
fi

ACCOUNTS=$(cf_get "/accounts?per_page=5")
ACCOUNT_ID=$(echo "$ACCOUNTS" | extract "id")
[[ -z "$ACCOUNT_ID" ]] && die "Failed to get account ID"
echo "Account: $ACCOUNT_ID"

# ═════════════════════════════════════════════════════════════════════════════
# ACTIONS
# ═════════════════════════════════════════════════════════════════════════════

case "$ACTION" in

list-kv)
  echo ""
  echo "KV Namespaces:"
  printf "%-40s %s\n" "ID" "Title"
  printf "%-40s %s\n" "----" "-----"
  cf_get "/accounts/$ACCOUNT_ID/storage/kv/namespaces" | grep -o '"id":"[^"]*","title":"[^"]*"' | while IFS= read -r line; do
    id=$(echo "$line" | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//')
    title=$(echo "$line" | grep -o '"title":"[^"]*"' | sed 's/"title":"//;s/"//')
    mark=""; [[ "$title" == "$KV_TITLE" ]] && mark=" *"
    printf "%-40s %s%s\n" "$id" "$title" "$mark"
  done
  echo ""
  echo "* = Q Proxy namespace"
  ;;

remove-kv)
  KV_ID=$(get_kv_id)
  [[ -z "$KV_ID" ]] && die "No Q Proxy KV found"
  echo "KV: $KV_ID ($KV_TITLE)"
  read -rp "Delete this KV namespace? (yes/no): " confirm
  [[ "$confirm" != "yes" ]] && die "Cancelled"
  cf_post "/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID" '{}' > /dev/null
  echo "KV deleted"
  ;;

status)
  echo ""
  WR=$(cf_get "/accounts/$ACCOUNT_ID/workers/scripts/$WORKER")
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
  URL="https://$WORKER.$SUB.workers.dev"
  SP=$(get_secure_path "$KV_ID")
  [[ -z "$SP" ]] && die "Could not read securePath. Seed first."
  SETUP=$(curl -s -X POST "$URL/$SP/api/auth/setup" \
    -H "Content-Type: application/json" \
    -d "{\"newPassword\":\"$PASSWORD\"}")
  ok "$SETUP" && echo "Password set" || echo "Failed"
  ;;

update)
  KV_ID="${KV_ID_TARGET:-}"
  if [[ -z "$KV_ID" ]]; then
    KV_ID=$(get_kv_id)
    [[ -z "$KV_ID" ]] && die "No Q Proxy KV found. Deploy first."
  fi
  echo "Downloading $SCRIPT_NAME..."
  WORKER_DATA=$(curl -fsSL "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" 2>/dev/null) || \
    WORKER_DATA=$(curl -fsSL "https://raw.githubusercontent.com/$REPO/master/dist/$SCRIPT_NAME")
  [[ -z "$WORKER_DATA" || ${#WORKER_DATA} -lt 10000 ]] && die "Download failed"
  echo "Downloaded ${#WORKER_DATA} bytes"
  if [[ "$DRY" -eq 1 ]]; then echo "[dry] Would upload with KV $KV_ID"; exit 0; fi
  METADATA="{\"main_module\":\"$SCRIPT_NAME\",\"compatibility_date\":\"2026-08-01\",\"bindings\":[{\"type\":\"kv_namespace\",\"name\":\"$BINDING\",\"namespace_id\":\"$KV_ID\"}]}"
  if [[ "$TOKEN" == cfk_* ]]; then
    UPLOAD=$(curl -s -X PUT "$BASE/accounts/$ACCOUNT_ID/workers/scripts/$WORKER" \
      -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" \
      -F "metadata=${METADATA};type=application/json" \
      -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
  else
    UPLOAD=$(curl -s -X PUT "$BASE/accounts/$ACCOUNT_ID/workers/scripts/$WORKER" \
      -H "Authorization: Bearer $TOKEN" \
      -F "metadata=${METADATA};type=application/json" \
      -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
  fi
  ok "$UPLOAD" || die "Upload failed: $UPLOAD"
  echo "Worker updated"
  ;;

deploy)
  [[ -z "$PASSWORD" ]] && read -rp "First panel password [empty to set later]: " PASSWORD

  # KV
  KV_ID=$(get_kv_id)
  if [[ -n "$KV_ID" ]]; then
    echo "Reusing existing KV: $KV_ID"
  else
    echo "Creating KV namespace..."
    KV_RESP=$(cf_post "/accounts/$ACCOUNT_ID/storage/kv/namespaces" "{\"title\":\"$KV_TITLE\"}")
    KV_ID=$(echo "$KV_RESP" | extract "id")
    if [[ -z "$KV_ID" ]]; then
      # might already exist (race)
      KV_ID=$(get_kv_id)
      [[ -z "$KV_ID" ]] && die "KV creation failed: $KV_RESP"
      echo "Reusing existing KV: $KV_ID"
    else
      echo "Created KV: $KV_ID"
    fi
  fi

  # download
  echo "Downloading $SCRIPT_NAME..."
  WORKER_DATA=$(curl -fsSL "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" 2>/dev/null) || \
    WORKER_DATA=$(curl -fsSL "https://raw.githubusercontent.com/$REPO/master/dist/$SCRIPT_NAME")
  [[ -z "$WORKER_DATA" || ${#WORKER_DATA} -lt 10000 ]] && die "Download failed"
  echo "Downloaded ${#WORKER_DATA} bytes"

  if [[ "$DRY" -eq 1 ]]; then echo "[dry] Would upload with KV $KV_ID"; exit 0; fi

  # upload
  echo "Uploading worker..."
  METADATA="{\"main_module\":\"$SCRIPT_NAME\",\"compatibility_date\":\"2026-08-01\",\"bindings\":[{\"type\":\"kv_namespace\",\"name\":\"$BINDING\",\"namespace_id\":\"$KV_ID\"}]}"
  if [[ "$TOKEN" == cfk_* ]]; then
    UPLOAD=$(curl -s -X PUT "$BASE/accounts/$ACCOUNT_ID/workers/scripts/$WORKER" \
      -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" \
      -F "metadata=${METADATA};type=application/json" \
      -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
  else
    UPLOAD=$(curl -s -X PUT "$BASE/accounts/$ACCOUNT_ID/workers/scripts/$WORKER" \
      -H "Authorization: Bearer $TOKEN" \
      -F "metadata=${METADATA};type=application/json" \
      -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
  fi
  ok "$UPLOAD" || die "Upload failed: $UPLOAD"
  echo "Worker uploaded"

  # subdomain
  SUB=$(get_subdomain)
  WORKER_URL="https://$WORKER.$SUB.workers.dev"
  echo "Worker URL: $WORKER_URL"

  # seed
  echo "Seeding..."
  curl -sf "$WORKER_URL/" > /dev/null 2>&1 || true
  sleep 2

  # securePath
  SP=$(get_secure_path "$KV_ID")
  if [[ -n "$SP" && -n "$PASSWORD" ]]; then
    SETUP=$(curl -s -X POST "$WORKER_URL/$SP/api/auth/setup" \
      -H "Content-Type: application/json" \
      -d "{\"newPassword\":\"$PASSWORD\"}")
    ok "$SETUP" && echo "Password set" || echo "Password setup failed (set manually)"
  fi

  echo ""
  if [[ -n "$SP" ]]; then
    echo "Panel:        $WORKER_URL/$SP/panel"
    echo "Subscription: $WORKER_URL/$SP/sub"
  else
    echo "Could not read securePath."
    echo "Check KV → $KV_TITLE → qproxy:settings → data.securePath"
    echo "Panel: $WORKER_URL/<securePath>/panel"
  fi
  ;;

*) die "Unknown action: $ACTION (use deploy, update, list-kv, remove-kv, status, seed, set-password)" ;;
esac
