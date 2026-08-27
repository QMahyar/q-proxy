#!/usr/bin/env bash
set -euo pipefail
# Q Proxy — Automatic deploy (no git, no wrangler, no build)
# - Downloads q-proxy.js from GitHub Releases
# - Creates KV, uploads Worker via Cloudflare API (curl)
# - Seeds and prints Panel URL, optionally sets first password
#
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.sh)
#   curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.sh | bash
#   ./scripts/quick-deploy.sh --token <token> --password <pass>

REPO="QMahyar/q-proxy"
WORKER_NAME="q-proxy"
KV_TITLE="q-proxy-QPROXY_KV"
COMPAT_DATE="2026-08-01"

TOKEN=""
EMAIL=""
ACCOUNT_ID=""
PASSWORD=""
DRY=""

# Pre-filled API token URL (Workers Scripts:Edit + KV Storage:Edit)
TOKEN_URL="https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --token) TOKEN="$2"; shift 2;;
    --email) EMAIL="$2"; shift 2;;
    --account-id) ACCOUNT_ID="$2"; shift 2;;
    --password) PASSWORD="$2"; shift 2;;
    --dry) DRY=1; shift;;
    --help|-h) echo "Usage: $0 [--token TOKEN] [--email EMAIL] [--account-id ID] [--password PASS] [--dry]"; exit 0;;
    *) shift;;
  esac
done

# Env fallback
TOKEN="${TOKEN:-${CLOUDFLARE_API_TOKEN:-${CLOUDFLARE_API_KEY:-}}}"
EMAIL="${EMAIL:-${CLOUDFLARE_EMAIL:-}}"
ACCOUNT_ID="${ACCOUNT_ID:-${CLOUDFLARE_ACCOUNT_ID:-}}"

redact() { echo "$1" | sed -E 's/^(.{4}).*(.{4})$/\1***\2/'; }

if [[ -z "$TOKEN" ]]; then
  echo ""
  echo "Q Proxy — automatic deploy"
  echo "=========================="
  echo ""
  echo "Create an API token with Workers:Edit + KV:Edit:"
  echo "  $TOKEN_URL"
  echo ""
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$TOKEN_URL" 2>/dev/null || true
  elif command -v open >/dev/null 2>&1; then open "$TOKEN_URL" 2>/dev/null || true
  elif command -v start >/dev/null 2>&1; then start "$TOKEN_URL" 2>/dev/null || true
  fi
  echo -n "Paste API Token (or Global Key cfk_...): "
  read -r TOKEN
fi

if [[ -z "$TOKEN" ]]; then echo "No token — abort"; exit 1; fi

IS_GLOBAL=0
if [[ "$TOKEN" == cfk_* ]]; then IS_GLOBAL=1; fi

if [[ $IS_GLOBAL -eq 1 && -z "$EMAIL" ]]; then
  echo -n "Global Key detected — Cloudflare email: "
  read -r EMAIL
  if [[ -z "$EMAIL" ]]; then echo "Email required for Global Key"; exit 1; fi
fi

if [[ -z "$PASSWORD" ]]; then
  echo -n "First panel password (8+ chars, letter + digit) [leave empty to set later in panel]: "
  read -r -s PASSWORD; echo ""
  if [[ -n "$PASSWORD" && ${#PASSWORD} -lt 8 ]]; then echo "Password too short (8+ chars)"; exit 1; fi
fi

auth_header() {
  if [[ $IS_GLOBAL -eq 1 ]]; then
    echo "-H X-Auth-Email: $EMAIL -H X-Auth-Key: $TOKEN"
  else
    echo "-H Authorization: Bearer $TOKEN"
  fi
}

# Resolve account ID if not given
if [[ -z "$ACCOUNT_ID" ]]; then
  echo "Resolving account ID..."
  if [[ $IS_GLOBAL -eq 1 ]]; then
    RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
  else
    RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts" -H "Authorization: Bearer $TOKEN")
  fi
  ACCOUNT_ID=$(echo "$RESP" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4)
  if [[ -z "$ACCOUNT_ID" ]]; then
    echo "Could not auto-detect account ID. Response:"
    echo "$RESP" | head -c 600
    echo -n "Enter Account ID (32 hex, from dashboard URL): "
    read -r ACCOUNT_ID
  fi
  echo "Account ID: $ACCOUNT_ID"
fi

if [[ -n "$DRY" ]]; then
  echo "[dry] Would create KV \"$KV_TITLE\" in $ACCOUNT_ID"
  echo "[dry] Would download q-proxy.js and upload Worker \"$WORKER_NAME\" with KV binding QPROXY_KV"
  echo "[dry] Would seed and print Panel URL"
  exit 0
fi

# Get worker script (prefer Releases, fallback to raw)
WORKER_JS=""
if [[ -f "dist/q-proxy.js" ]]; then
  echo "Using local dist/q-proxy.js"
  WORKER_JS="dist/q-proxy.js"
else
  TMPDIR=$(mktemp -d)
  trap 'rm -rf "$TMPDIR"' EXIT
  WORKER_JS="$TMPDIR/q-proxy.js"
  echo "Downloading q-proxy.js from Releases..."
  if ! curl -fsSL "https://github.com/$REPO/releases/latest/download/q-proxy.js" -o "$WORKER_JS" 2>/dev/null; then
    echo "Release not found, trying raw main..."
    curl -fsSL "https://raw.githubusercontent.com/$REPO/main/dist/q-proxy.js" -o "$WORKER_JS" || {
      echo "Download failed — run: npm run build  or download q-proxy.js from https://github.com/$REPO/releases"
      exit 1
    }
  fi
  echo "Downloaded $(wc -c < "$WORKER_JS") bytes"
fi

# Create or reuse KV
echo "Creating KV namespace \"$KV_TITLE\"..."
if [[ $IS_GLOBAL -eq 1 ]]; then
  KV_RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN" -H "Content-Type: application/json" -d "{\"title\":\"$KV_TITLE\"}")
else
  KV_RESP=$(curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{\"title\":\"$KV_TITLE\"}")
fi

KV_ID=$(echo "$KV_RESP" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4)
if [[ -z "$KV_ID" ]]; then
  if echo "$KV_RESP" | grep -q "already exists\|10014"; then
    echo "KV already exists, reusing..."
    if [[ $IS_GLOBAL -eq 1 ]]; then
      LIST=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
    else
      LIST=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces" -H "Authorization: Bearer $TOKEN")
    fi
    KV_ID=$(echo "$LIST" | grep -o "\"title\":\"$KV_TITLE\",\"id\":\"[a-f0-9]\{32\}\"" | grep -o '"id":"[a-f0-9]\{32\}"' | cut -d'"' -f4 | head -1)
    if [[ -z "$KV_ID" ]]; then KV_ID=$(echo "$LIST" | grep -o '"id":"[a-f0-9]\{32\}"' | head -1 | cut -d'"' -f4); fi
  fi
fi

if [[ -z "$KV_ID" ]]; then
  echo "KV create failed:"
  echo "$KV_RESP" | head -c 800
  exit 1
fi
echo "KV: $KV_ID"

# Upload Worker (multipart)
echo "Uploading Worker \"$WORKER_NAME\"..."
META=$(printf '{"main_module":"q-proxy.js","compatibility_date":"%s","bindings":[{"type":"kv_namespace","name":"QPROXY_KV","namespace_id":"%s"}]}' "$COMPAT_DATE" "$KV_ID")

if [[ $IS_GLOBAL -eq 1 ]]; then
  UP_RESP=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
    -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN" \
    -F "metadata=$META;type=application/json" \
    -F "q-proxy.js=@$WORKER_JS;type=application/javascript+module")
else
  UP_RESP=$(curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
    -H "Authorization: Bearer $TOKEN" \
    -F "metadata=$META;type=application/json" \
    -F "q-proxy.js=@$WORKER_JS;type=application/javascript+module")
fi

if ! echo "$UP_RESP" | grep -q '"success":true'; then
  echo "Upload failed:"
  echo "$UP_RESP" | head -c 1000
  exit 1
fi
echo "Worker uploaded"

# Get subdomain
if [[ $IS_GLOBAL -eq 1 ]]; then
  SUB_RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
else
  SUB_RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "Authorization: Bearer $TOKEN")
fi
SUB=$(echo "$SUB_RESP" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4)
if [[ -z "$SUB" ]]; then
  # try enable
  if [[ $IS_GLOBAL -eq 1 ]]; then
    curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN" -H "Content-Type: application/json" -d '{"enabled":true}' >/dev/null 2>&1 || true
    SUB_RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
  else
    curl -s -X PUT "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"enabled":true}' >/dev/null 2>&1 || true
    SUB_RESP=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/subdomain" -H "Authorization: Bearer $TOKEN")
  fi
  SUB=$(echo "$SUB_RESP" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4)
fi

WORKER_URL="https://${WORKER_NAME}.${SUB}.workers.dev"
if [[ -z "$SUB" ]]; then WORKER_URL="https://${WORKER_NAME}.workers.dev"; fi
echo "Worker URL: $WORKER_URL"

# Seed
echo "Seeding $WORKER_URL/ ..."
curl -fsSL "$WORKER_URL/" -A "q-proxy/quick-deploy" >/dev/null 2>&1 || true
sleep 2

# Read securePath from KV
echo "Reading securePath..."
if [[ $IS_GLOBAL -eq 1 ]]; then
  KV_VAL=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/qproxy:settings" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
else
  KV_VAL=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/qproxy:settings" -H "Authorization: Bearer $TOKEN")
fi

SECURE_PATH=$(echo "$KV_VAL" | grep -o '"securePath":"[^"]*"' | head -1 | cut -d'"' -f4)
if [[ -z "$SECURE_PATH" ]]; then
  SECURE_PATH=$(echo "$KV_VAL" | grep -o '"securePath" *: *"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [[ -z "$SECURE_PATH" ]]; then
  echo "Could not read securePath (KV eventual consistency, retry in 5s)..."
  sleep 5
  if [[ $IS_GLOBAL -eq 1 ]]; then
    KV_VAL=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/qproxy:settings" -H "X-Auth-Email: $EMAIL" -H "X-Auth-Key: $TOKEN")
  else
    KV_VAL=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/qproxy:settings" -H "Authorization: Bearer $TOKEN")
  fi
  SECURE_PATH=$(echo "$KV_VAL" | grep -o '"securePath":"[^"]*"' | head -1 | cut -d'"' -f4)
fi

if [[ -z "$SECURE_PATH" ]]; then
  echo "Failed to read securePath. Try:"
  echo "  curl \"$WORKER_URL/\" && curl -s \"https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values/qproxy:settings\" -H \"Authorization: Bearer $(redact "$TOKEN")\" | grep securePath"
  exit 1
fi

PANEL_URL="${WORKER_URL}/${SECURE_PATH}/panel"

# Optionally set first password via API
if [[ -n "$PASSWORD" ]]; then
  echo "Setting first password..."
  SET_RESP=$(curl -s -X POST "${WORKER_URL}/${SECURE_PATH}/api/auth/setup" -H "Content-Type: application/json" -d "{\"newPassword\":\"$PASSWORD\"}")
  if echo "$SET_RESP" | grep -q '"ok":true'; then
    echo "Password set"
  else
    echo "Password set failed (you can set it in panel): $SET_RESP" | head -c 300
  fi
fi

echo ""
echo "=============================================================="
echo "  Q Proxy is live (no wrangler, no git)"
echo "=============================================================="
echo "  Panel:        $PANEL_URL"
echo "  Subscription: ${WORKER_URL}/${SECURE_PATH}/sub"
echo "  securePath:   $SECURE_PATH"
echo "  KV: $KV_ID  Account: $ACCOUNT_ID"
echo "=============================================================="
if [[ -z "$PASSWORD" ]]; then
  echo "Next: open Panel URL and set a password (8+ chars, letter + digit)."
else
  echo "Password already set — open Panel and log in."
fi
echo "Keep the full https://<host>/<sp> URL — rotating the path invalidates clients."
