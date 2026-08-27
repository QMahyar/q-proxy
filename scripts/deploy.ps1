<# Q Proxy — deploy via Cloudflare API (PowerShell only, no wrangler/node/git)
Usage:
  .\deploy.ps1                          # full deploy (interactive)
  .\deploy.ps1 -Token T -Password P     # full deploy (non-interactive)
  .\deploy.ps1 -Action update           # update worker script only
  .\deploy.ps1 -Action list-kv          # list KV namespaces
  .\deploy.ps1 -Action remove-kv        # remove KV namespace
  .\deploy.ps1 -Action status           # show worker + KV status
  .\deploy.ps1 -Action seed             # re-seed the worker
  .\deploy.ps1 -Action set-password     # set/change password
#>
param(
  [string]$Token,
  [string]$Email,
  [string]$Password,
  [ValidateSet("deploy","update","list-kv","remove-kv","status","seed","set-password")]
  [string]$Action = "deploy",
  [string]$KVId,
  [switch]$Dry
)

$ErrorActionPreference = "Stop"
$REPO = "QMahyar/q-proxy"
$WORKER = "q-proxy"
$KV_TITLE = "q-proxy-QPROXY_KV"
$BINDING = "QPROXY_KV"
$SCRIPT_NAME = "q-proxy.js"
$BASE = "https://api.cloudflare.com/client/v4"
$TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all'

# ── helpers ──────────────────────────────────────────────────────────────────
function cf($Method, $Path, $Body) {
  $h = $headers.Clone(); $h.Remove("Content-Type")
  $uri = "$BASE$Path"
  $jsonBody = if ($Body) { $Body | ConvertTo-Json -Compress } else { $null }
  try {
    if ($jsonBody) {
      $resp = Invoke-RestMethod -Uri $uri -Headers $h -Method $Method -Body $jsonBody -ContentType "application/json"
    } else {
      $resp = Invoke-RestMethod -Uri $uri -Headers $h -Method $Method
    }
  } catch {
    $errResp = $_.ErrorDetails.Message
    if ($errResp) {
      $p = $errResp | ConvertFrom-Json
      $code = if ($p.errors.Count -gt 0) { $p.errors[0].code } else { "?" }
      $msg  = if ($p.errors.Count -gt 0) { $p.errors[0].message } else { $errResp }
      return @{ ok=$false; code=$code; msg=$msg; raw=$p }
    }
    return @{ ok=$false; code="?"; msg=$_.Exception.Message; raw=$null }
  }
  if (-not $resp.success) {
    $code = if ($resp.errors.Count -gt 0) { $resp.errors[0].code } else { "?" }
    $msg  = if ($resp.errors.Count -gt 0) { $resp.errors[0].message } else { "unknown error" }
    return @{ ok=$false; code=$code; msg=$msg; raw=$resp }
  }
  return @{ ok=$true; result=$resp.result; raw=$resp }
}

function cfJson($Method, $Path, $RawJson) {
  $h = $headers.Clone(); $h.Remove("Content-Type")
  $resp = Invoke-RestMethod -Uri "$BASE$Path" -Headers $h -Method $Method -Body $RawJson -ContentType "application/json"
  if (-not $resp.success) {
    $code = if ($resp.errors.Count -gt 0) { $resp.errors[0].code } else { "?" }
    $msg  = if ($resp.errors.Count -gt 0) { $resp.errors[0].message } else { "unknown error" }
    return @{ ok=$false; code=$code; msg=$msg; raw=$resp }
  }
  return @{ ok=$true; result=$resp.result; raw=$resp }
}

# ── auth ─────────────────────────────────────────────────────────────────────
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

$accts = cf GET "/accounts?per_page=5"
if (-not $accts.ok -or -not $accts.result -or $accts.result.Count -eq 0) {
  Write-Host "Failed to get account ID: $($accts.msg)" -ForegroundColor Red; exit 1
}
$accountId = $accts.result[0].id
Write-Host "Account: $accountId" -ForegroundColor Gray

# ── KV helpers ───────────────────────────────────────────────────────────────
function Get-QProxyKV {
  $r = cf GET "/accounts/$accountId/storage/kv/namespaces"
  if ($r.ok) { return ($r.result | Where-Object { $_.title -eq $KV_TITLE }) }
  return $null
}

function Ensure-KV {
  $existing = Get-QProxyKV
  if ($existing) {
    Write-Host "Reusing existing KV: $($existing.id) ($KV_TITLE)" -ForegroundColor Yellow
    return $existing.id
  }
  Write-Host "Creating KV namespace..." -ForegroundColor Gray
  $r = cf POST "/accounts/$accountId/storage/kv/namespaces" @{ title=$KV_TITLE }
  if ($r.ok) {
    Write-Host "Created KV: $($r.result.id)" -ForegroundColor Green
    return $r.result.id
  }
  if ($r.code -eq 10014) {
    $existing = Get-QProxyKV
    if ($existing) { Write-Host "Reusing existing KV: $($existing.id)" -ForegroundColor Yellow; return $existing.id }
  }
  Write-Host "KV creation failed: $($r.msg)" -ForegroundColor Red; exit 1
}

# ── download worker ──────────────────────────────────────────────────────────
function Get-WorkerData {
  Write-Host "Downloading $SCRIPT_NAME from Releases..." -ForegroundColor Gray
  try {
    $data = (Invoke-WebRequest -Uri "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" -UseBasicParsing).Content
  } catch {
    $data = (Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$REPO/master/dist/$SCRIPT_NAME" -UseBasicParsing).Content
  }
  if ($data.Length -lt 10000) { Write-Host "Download failed ($($data.Length) bytes)" -ForegroundColor Red; exit 1 }
  Write-Host "Downloaded $($data.Length) bytes" -ForegroundColor Green
  return $data
}

# ── upload worker ────────────────────────────────────────────────────────────
function Upload-Worker($WorkerData, $KvId) {
  Write-Host "Uploading worker..." -ForegroundColor Gray
  $metadata = @{main_module=$SCRIPT_NAME; compatibility_date="2026-08-01"; bindings=@(@{type="kv_namespace"; name=$BINDING; namespace_id=$KvId})} | ConvertTo-Json -Compress

  $mp = [System.Net.Http.MultipartFormDataContent]::new()
  $mp.Add([System.Net.Http.StringContent]::new($metadata, [System.Text.Encoding]::UTF8, "application/json"), "metadata")
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($WorkerData)
  $sc = [System.Net.Http.ByteArrayContent]::new($bytes)
  $sc.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("application/javascript+module")
  $mp.Add($sc, $SCRIPT_NAME, $SCRIPT_NAME)

  $h = $headers.Clone(); $h.Remove("Content-Type")
  $hc = [System.Net.Http.HttpClient]::new()
  foreach ($kv in $h.GetEnumerator()) { $hc.DefaultRequestHeaders.TryAddWithoutValidation($kv.Key, $kv.Value) | Out-Null }
  $req = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Put, "$BASE/accounts/$accountId/workers/scripts/$WORKER")
  $req.Content = $mp
  $resp = $hc.SendAsync($req).Result
  $body = $resp.Content.ReadAsStringAsync().Result | ConvertFrom-Json
  if (-not $body.success) { Write-Host "Upload failed: $($body.errors[0].message)" -ForegroundColor Red; exit 1 }
  Write-Host "Worker uploaded" -ForegroundColor Green
}

# ── subdomain + URL ──────────────────────────────────────────────────────────
function Get-WorkerUrl {
  cf PUT "/accounts/$accountId/workers/subdomain" @{ enabled=$true } | Out-Null
  $r = cf GET "/accounts/$accountId/workers/subdomain"
  $sub = $r.result.subdomain
  return "https://$WORKER.$sub.workers.dev"
}

# ── read securePath ──────────────────────────────────────────────────────────
function Get-SecurePath($KvId) {
  $r = cf GET "/accounts/$accountId/storage/kv/namespaces/$KvId/values/qproxy:settings"
  if (-not $r.ok) { return $null }
  $json = $r.result | ConvertTo-Json -Compress
  if ($json -match '"securePath":"([a-f0-9]{12})"') { return $Matches[1] }
  return $null
}

# ═════════════════════════════════════════════════════════════════════════════
# ACTIONS
# ═════════════════════════════════════════════════════════════════════════════

switch ($Action) {

  "list-kv" {
    $r = cf GET "/accounts/$accountId/storage/kv/namespaces"
    if (-not $r.ok) { Write-Host "Failed: $($r.msg)" -ForegroundColor Red; exit 1 }
    Write-Host ""
    Write-Host "KV Namespaces:" -ForegroundColor Cyan
    Write-Host ("{0,-40} {1}" -f "ID", "Title")
    Write-Host ("{0,-40} {1}" -f "----", "-----")
    foreach ($ns in $r.result) {
      $mark = if ($ns.title -eq $KV_TITLE) { " *" } else { "" }
      Write-Host ("{0,-40} {1}{2}" -f $ns.id, $ns.title, $mark)
    }
    Write-Host ""
    Write-Host "* = Q Proxy namespace" -ForegroundColor Gray
    exit 0
  }

  "remove-kv" {
    $existing = Get-QProxyKV
    if (-not $existing) { Write-Host "No Q Proxy KV found" -ForegroundColor Yellow; exit 0 }
    Write-Host "KV: $($existing.id) ($($existing.title))" -ForegroundColor Yellow
    $confirm = Read-Host "Delete this KV namespace? (yes/no)"
    if ($confirm -ne "yes") { Write-Host "Cancelled" -ForegroundColor Gray; exit 0 }
    $r = cf DELETE "/accounts/$accountId/storage/kv/namespaces/$($existing.id)"
    if ($r.ok) { Write-Host "KV deleted" -ForegroundColor Green } else { Write-Host "Failed: $($r.msg)" -ForegroundColor Red }
    exit 0
  }

  "status" {
    # worker
    $wr = cf GET "/accounts/$accountId/workers/scripts/$WORKER"
    if ($wr.ok) {
      Write-Host ""
      Write-Host "Worker: $WORKER" -ForegroundColor Cyan
      Write-Host "  Modified: $($wr.result.modified_on)"
      Write-Host "  Size: $([math]::Round($wr.result.size/1024, 1)) KB"
    } else {
      Write-Host "Worker: not deployed" -ForegroundColor Yellow
    }
    # subdomain
    $sr = cf GET "/accounts/$accountId/workers/subdomain"
    if ($sr.ok -and $sr.result.subdomain) {
      $url = "https://$WORKER.$($sr.result.subdomain).workers.dev"
      Write-Host "  URL: $url"
    }
    # KV
    $kv = Get-QProxyKV
    if ($kv) {
      Write-Host ""
      Write-Host "KV: $($kv.id) ($($kv.title))" -ForegroundColor Cyan
      $sp = Get-SecurePath $kv.id
      if ($sp) {
        Write-Host "  Panel: https://$WORKER.$($sr.result.subdomain).workers.dev/$sp/panel"
      }
    } else {
      Write-Host ""
      Write-Host "KV: not found" -ForegroundColor Yellow
    }
    exit 0
  }

  "seed" {
    $sr = cf GET "/accounts/$accountId/workers/subdomain"
    $url = "https://$WORKER.$($sr.result.subdomain).workers.dev"
    Write-Host "Seeding $url/ ..." -ForegroundColor Gray
    try { Invoke-WebRequest -Uri "$url/" -UseBasicParsing | Out-Null } catch {}
    Write-Host "Done" -ForegroundColor Green
    exit 0
  }

  "set-password" {
    if (-not $Password) { $Password = Read-Host "New panel password" }
    $kv = Get-QProxyKV
    if (-not $kv) { Write-Host "No Q Proxy KV found. Deploy first." -ForegroundColor Red; exit 1 }
    $sr = cf GET "/accounts/$accountId/workers/subdomain"
    $url = "https://$WORKER.$($sr.result.subdomain).workers.dev"
    $sp = Get-SecurePath $kv.id
    if (-not $sp) { Write-Host "Could not read securePath. Seed first." -ForegroundColor Red; exit 1 }
    try {
      $setup = Invoke-RestMethod -Uri "$url/$sp/api/auth/setup" -Method Post -ContentType "application/json" -Body (@{newPassword=$Password} | ConvertTo-Json)
      if ($setup.ok) { Write-Host "Password set" -ForegroundColor Green }
    } catch { Write-Host "Failed: $_" -ForegroundColor Red }
    exit 0
  }

  "update" {
    if (-not $KVId) {
      $kv = Get-QProxyKV
      if ($kv) { $KVId = $kv.id } else { Write-Host "No Q Proxy KV found. Deploy first." -ForegroundColor Red; exit 1 }
    }
    $data = Get-WorkerData
    if ($Dry) { Write-Host "[dry] Would upload $($data.Length) bytes with KV $KVId" -ForegroundColor Yellow; exit 0 }
    Upload-Worker $data $KVId
    Write-Host "Update complete" -ForegroundColor Green
    exit 0
  }

  "deploy" {
    if (-not $Password) { $Password = Read-Host "First panel password [empty to set later]" }
    $kvId = Ensure-KV
    $data = Get-WorkerData
    if ($Dry) { Write-Host "[dry] Would upload worker with KV $kvId" -ForegroundColor Yellow; exit 0 }
    Upload-Worker $data $kvId
    $workerUrl = Get-WorkerUrl
    Write-Host "Worker URL: $workerUrl" -ForegroundColor Green

    Write-Host "Seeding..." -ForegroundColor Gray
    try { Invoke-WebRequest -Uri "$workerUrl/" -UseBasicParsing | Out-Null } catch {}
    Start-Sleep -Seconds 2

    $sp = Get-SecurePath $kvId
    if ($sp -and $Password) {
      try {
        $setup = Invoke-RestMethod -Uri "$workerUrl/$sp/api/auth/setup" -Method Post -ContentType "application/json" -Body (@{newPassword=$Password} | ConvertTo-Json)
        if ($setup.ok) { Write-Host "Password set" -ForegroundColor Green }
      } catch { Write-Host "Password setup failed (set manually in panel)" -ForegroundColor Yellow }
    }

    Write-Host ""
    if ($sp) {
      Write-Host "Panel:        $workerUrl/$sp/panel" -ForegroundColor Cyan
      Write-Host "Subscription: $workerUrl/$sp/sub" -ForegroundColor Cyan
    } else {
      Write-Host "Could not read securePath." -ForegroundColor Yellow
      Write-Host "Check KV → $KV_TITLE → qproxy:settings → data.securePath"
      Write-Host "Panel: $workerUrl/<securePath>/panel"
    }
    exit 0
  }
}
