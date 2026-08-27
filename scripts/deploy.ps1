<# Q Proxy — one-command deploy via Cloudflare API (PowerShell only, no wrangler/node/git) #>
param(
  [string]$Token,
  [string]$Email,
  [string]$Password,
  [switch]$Dry
)

$ErrorActionPreference = "Stop"
$REPO = "QMahyar/q-proxy"
$WORKER = "q-proxy"
$KV_TITLE = "q-proxy-QPROXY_KV"
$BINDING = "QPROXY_KV"
$SCRIPT_NAME = "q-proxy.js"
$TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all'

# --- prompt ---
if (-not $Token) {
  Write-Host ""
  Write-Host "Open this URL to create an API token (pre-filled permissions):" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  $TOKEN_URL" -ForegroundColor Yellow
  Write-Host ""
  $Token = Read-Host "Paste API Token or Global Key (cfk_...)"
}

$headers = @{ "Authorization" = "Bearer $Token"; "Content-Type" = "application/json" }
$isGlobal = $Token.StartsWith("cfk_")

if ($isGlobal) {
  if (-not $Email) { $Email = Read-Host "Cloudflare email" }
  $headers = @{ "X-Auth-Key" = $Token; "X-Auth-Email" = $Email; "Content-Type" = "application/json" }
}

# --- account ---
$accounts = (Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts?per_page=5" -Headers $headers -Method Get)
$accountId = $accounts.result[0].id
if (-not $accountId) { Write-Host "Failed to get account ID" -ForegroundColor Red; exit 1 }

# --- password ---
if (-not $Password) { $Password = Read-Host "First panel password [empty to set later]" }

# --- KV ---
Write-Host "Creating KV namespace..." -ForegroundColor Gray
try {
  $kv = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/storage/kv/namespaces" -Headers $headers -Method Post -Body (@{title=$KV_TITLE} | ConvertTo-Json)
  $kvId = $kv.result.id
} catch {
  if ($_.Exception.Message -match "10014") {
    $existing = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/storage/kv/namespaces" -Headers $headers -Method Get
    $kvId = ($existing.result | Where-Object { $_.title -eq $KV_TITLE }).id
    if (-not $kvId) { Write-Host "KV exists but not found. Create it manually." -ForegroundColor Red; exit 1 }
    Write-Host "Reusing existing KV: $kvId" -ForegroundColor Yellow
  } else { throw }
}
Write-Host "KV namespace: $kvId" -ForegroundColor Green

# --- download ---
Write-Host "Downloading $SCRIPT_NAME from Releases..." -ForegroundColor Gray
try {
  $workerData = (Invoke-WebRequest -Uri "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" -UseBasicParsing).Content
} catch {
  $workerData = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$REPO/master/dist/$SCRIPT_NAME" -UseBasicParsing).Content
}
if ($workerData.Length -lt 10000) { Write-Host "Download failed" -ForegroundColor Red; exit 1 }
Write-Host "Downloaded $($workerData.Length) bytes" -ForegroundColor Green

# --- dry run ---
if ($Dry) {
  Write-Host "[dry] Would upload worker with KV binding $kvId" -ForegroundColor Yellow
  exit 0
}

# --- upload ---
Write-Host "Uploading worker..." -ForegroundColor Gray
$boundary = [System.Guid]::NewGuid().ToString()
$LF = "`r`n"
$bodyLines = @(
  "--$boundary",
  "Content-Disposition: form-data; name=`"metadata`"",
  "Content-Type: application/json",
  "",
  (@{main_module=$SCRIPT_NAME; compatibility_date="2026-08-01"; bindings=@(@{type="kv_namespace"; name=$BINDING; namespace_id=$kvId})} | ConvertTo-Json -Compress),
  "--$boundary",
  "Content-Disposition: form-data; name=`"$SCRIPT_NAME`"`; filename=`"$SCRIPT_NAME`"",
  "Content-Type: application/javascript+module",
  "",
  $workerData,
  "--$boundary--"
) -join $LF

$uploadHeaders = $headers.Clone()
$uploadHeaders.Remove("Content-Type")
$upload = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/$WORKER" -Headers $uploadHeaders -Method Put -ContentType "multipart/form-data; boundary=$boundary" -Body $bodyLines
if (-not $upload.success) { Write-Host "Upload failed" -ForegroundColor Red; exit 1 }
Write-Host "Worker uploaded" -ForegroundColor Green

# --- enable subdomain ---
Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain" -Headers $headers -Method Put -Body (@{enabled=$true} | ConvertTo-Json) | Out-Null
$sub = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain" -Headers $headers -Method Get
$subdomain = $sub.result.subdomain
$workerUrl = "https://$WORKER.$subdomain.workers.dev"
Write-Host "Worker URL: $workerUrl" -ForegroundColor Green

# --- seed ---
Write-Host "Seeding..." -ForegroundColor Gray
try { Invoke-WebRequest -Uri "$workerUrl/" -UseBasicParsing | Out-Null } catch {}
Start-Sleep -Seconds 2

# --- read securePath ---
Write-Host "Reading securePath from KV..." -ForegroundColor Gray
$kvVal = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$accountId/storage/kv/namespaces/$kvId/values/qproxy:settings" -Headers $headers -Method Get
$securePath = ($kvVal.result | ConvertTo-Json -Compress) -replace '.*"securePath":"([^"]+)".*','$1'

if (-not $securePath -or $securePath -eq ($kvVal.result | ConvertTo-Json -Compress)) {
  Write-Host ""
  Write-Host "Could not read securePath. Check:" -ForegroundColor Yellow
  Write-Host "  https://dash.cloudflare.com → KV → $KV_TITLE → qproxy:settings → data.securePath"
  Write-Host "  Panel: $workerUrl/<securePath>/panel"
  exit 0
}

# --- set password ---
if ($Password) {
  try {
    $setup = Invoke-RestMethod -Uri "$workerUrl/$securePath/api/auth/setup" -Method Post -ContentType "application/json" -Body (@{newPassword=$Password} | ConvertTo-Json)
    if ($setup.ok) { Write-Host "Password set" -ForegroundColor Green }
  } catch { Write-Host "Password setup failed (set manually in panel)" -ForegroundColor Yellow }
}

Write-Host ""
Write-Host "Panel:        $workerUrl/$securePath/panel" -ForegroundColor Cyan
Write-Host "Subscription: $workerUrl/$securePath/sub" -ForegroundColor Cyan
