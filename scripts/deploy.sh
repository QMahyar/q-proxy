#!/usr/bin/env bash
# Q Proxy — one-command deploy via Cloudflare API (curl only, no wrangler/node/git)
# Usage: bash scripts/deploy.sh [--token TOKEN] [--password PASS] [--dry]
set -euo pipefail

REPO="QMahyar/q-proxy"
WORKER="q-proxy"
KV_TITLE="q-proxy-QPROXY_KV"
BINDING="QPROXY_KV"
SCRIPT_NAME="q-proxy.js"
TOKEN_URL="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all"

DRY=0; TOKEN=""; PASSWORD=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry) DRY=1; shift;; --token) TOKEN="$2"; shift 2;; --password) PASSWORD="$2"; shift 2;; *) shift;;
  esac
done

api() {
  local method="$1" path="$2"; shift 2
  local args=(-s -w '\n%{http_code}' -X "$method" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" "$@")
  local resp; resp=$(curl "${args[@]}" "https://api.cloudflare.com/client/v4${path}")
  local body status; body=$(echo "$resp" | sed '$d'); status=$(echo "$resp" | tail -1)
  echo "$body"
}

extract() { grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"//;s/".*//'; }

# --- prompt ---
if [[ -z "$TOKEN" ]]; then
  echo ""
  echo "Open this URL to create an API token (pre-filled permissions):"
  echo ""
  echo "  $TOKEN_URL"
  echo ""
  read -rp "Paste API Token or Global Key (cfk_...): " TOKEN
fi
if [[ "$TOKEN" == cfk_* ]]; then
  read -rp "Cloudflare email: " EMAIL
  export CLOUDFLARE_API_KEY="$TOKEN" CLOUDFLARE_EMAIL="$EMAIL"
  ACCOUNTS=$(curl -s -X GET "https://api.cloudflare.com/client/v4/accounts?per_page=5" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" -H "Content-Type: application/json")
else
  ACCOUNTS=$(api GET "/accounts?per_page=5")
fi

ACCOUNT_ID=$(echo "$ACCOUNTS" | extract "id")
if [[ -z "$ACCOUNT_ID" ]]; then echo "Failed to get account ID"; exit 1; fi

if [[ -z "$PASSWORD" ]]; then read -rp "First panel password [empty to set later]: " PASSWORD; fi
echo "Workers or Pages? [Workers]: " >&2; read -rp "" TARGET; TARGET="${TARGET:-workers}"

# --- KV ---
if [[ "$TOKEN" == cfk_* ]]; then
  KV_RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" -H "Content-Type: application/json" \
    -d "{\"title\":\"${KV_TITLE}\"}")
else
  KV_RESP=$(api POST "/accounts/${ACCOUNT_ID}/storage/kv/namespaces" -d "{\"title\":\"${KV_TITLE}\"}")
fi
KV_ID=$(echo "$KV_RESP" | extract "id")
if [[ -z "$KV_ID" ]]; then KV_ID=$(echo "$KV_RESP" | grep -o '"result":{"id":"[^"]*"' | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//'); fi
if [[ -z "$KV_ID" ]]; then echo "KV creation failed: $KV_RESP"; exit 1; fi
echo "KV namespace: $KV_ID"

# --- download worker ---
echo "Downloading $SCRIPT_NAME from Releases..."
WORKER_DATA=$(curl -fsSL "https://github.com/${REPO}/releases/latest/download/${SCRIPT_NAME}" 2>/dev/null) || \
  WORKER_DATA=$(curl -fsSL "https://raw.githubusercontent.com/${REPO}/master/dist/${SCRIPT_NAME}")
if [[ -z "$WORKER_DATA" ]] || [[ ${#WORKER_DATA} -lt 10000 ]]; then echo "Download failed"; exit 1; fi
echo "Downloaded ${#WORKER_DATA} bytes"

# --- upload worker ---
if [[ "$DRY" -eq 1 ]]; then
  echo "[dry] Would upload worker with KV binding $KV_ID to $TARGET"
  exit 0
fi

METADATA="{\"main_module\":\"${SCRIPT_NAME}\",\"compatibility_date\":\"2026-08-01\",\"bindings\":[{\"type\":\"kv_namespace\",\"name\":\"${BINDING}\",\"namespace_id\":\"${KV_ID}\"}]}"
if [[ "$TOKEN" == cfk_* ]]; then
  UPLOAD=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" \
    -F "metadata=${METADATA};type=application/json" \
    -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
else
  UPLOAD=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}" \
    -H "Authorization: Bearer $TOKEN" \
    -F "metadata=${METADATA};type=application/json" \
    -F "${SCRIPT_NAME}=${WORKER_DATA};type=application/javascript+module")
fi
echo "$UPLOAD" | grep -q '"success":true' || { echo "Upload failed: $UPLOAD"; exit 1; }
echo "Worker uploaded"

# --- enable subdomain ---
if [[ "$TOKEN" == cfk_* ]]; then
  curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL" -H "Content-Type: application/json" \
    -d '{"enabled":true}' > /dev/null
else
  api PUT "/accounts/${ACCOUNT_ID}/workers/subdomain" -d '{"enabled":true}' > /dev/null
fi

# --- get subdomain ---
if [[ "$TOKEN" == cfk_* ]]; then
  SUB_RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/subdomain" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL")
else
  SUB_RESP=$(api GET "/accounts/${ACCOUNT_ID}/workers/subdomain")
fi
SUBDOMAIN=$(echo "$SUB_RESP" | extract "subdomain")
WORKER_URL="https://${WORKER}.${SUBDOMAIN}.workers.dev"
echo "Worker URL: $WORKER_URL"

# --- seed ---
echo "Seeding..."
curl -sf "$WORKER_URL/" > /dev/null 2>&1 || true
sleep 2

# --- read securePath ---
if [[ "$TOKEN" == cfk_* ]]; then
  KV_VAL=$(curl -s "https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values/qproxy:settings" \
    -H "X-Auth-Key: $TOKEN" -H "X-Auth-Email: $EMAIL")
else
  KV_VAL=$(api GET "/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_ID}/values/qproxy:settings")
fi
SECURE_PATH=$(echo "$KV_VAL" | grep -o '"securePath":"[^"]*"' | head -1 | sed 's/"securePath":"//;s/"//')

if [[ -z "$SECURE_PATH" ]]; then
  echo "Could not read securePath from KV. Check https://dash.cloudflare.com → KV → $KV_TITLE → qproxy:settings → data.securePath"
  echo "Then open: $WORKER_URL/<securePath>/panel"
  exit 0
fi

# --- set password ---
if [[ -n "$PASSWORD" ]]; then
  SETUP=$(curl -s -X POST "${WORKER_URL}/${SECURE_PATH}/api/auth/setup" \
    -H "Content-Type: application/json" \
    -d "{\"newPassword\":\"${PASSWORD}\"}")
  echo "$SETUP" | grep -q '"ok":true' 2>/dev/null && echo "Password set" || echo "Password setup failed (set manually in panel)"
fi

echo ""
echo "Panel:        ${WORKER_URL}/${SECURE_PATH}/panel"
echo "Subscription: ${WORKER_URL}/${SECURE_PATH}/sub"
