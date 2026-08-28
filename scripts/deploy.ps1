<# Q Proxy — deploy via Cloudflare API (PowerShell, no wrangler/node/git)
Usage:
  .\deploy.ps1                                    # full deploy (interactive)
  .\deploy.ps1 -Token T -Password P               # full deploy (non-interactive)
  .\deploy.ps1 -Action update                     # update worker script only
  .\deploy.ps1 -Action list-kv                    # list KV namespaces
  .\deploy.ps1 -Action remove-kv                  # remove KV namespace
  .\deploy.ps1 -Action status                     # show worker + KV status
  .\deploy.ps1 -Action seed                       # re-seed the worker
  .\deploy.ps1 -Action set-password               # set/change password
  .\deploy.ps1 -Title "my-project"                # custom KV title (multi-project)
#>
param(
  [string]$Token,
  [string]$Email,
  [string]$Password,
  [string]$Title = "q-proxy-QPROXY_KV",
  [ValidateSet("deploy","update","list-kv","remove-kv","status","seed","set-password")]
  [string]$Action = "deploy",
  [string]$KVId,
  [switch]$Dry
)

$ErrorActionPreference = "Stop"
$REPO = "QMahyar/q-proxy"
$WORKER = "q-proxy"
$BINDING = "QPROXY_KV"
$SCRIPT_NAME = "q-proxy.js"
$BASE = "https://api.cloudflare.com/client/v4"
$TOKEN_URL = 'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all'

# ── helpers ──────────────────────────────────────────────────────────────────
function cf($Method, $Path, $Body) {
  $uri = "$BASE$Path"
  try {
    $params = @{ Uri = $uri; Method = $Method }
    if ($Token -like "cfk_*") {
      $params.Headers = @{ "X-Auth-Key" = $Token; "X-Auth-Email" = $Email }
    } else {
      $params.Headers = @{ "Authorization" = "Bearer $Token" }
    }
    if ($Body) {
      $params.Body = ($Body | ConvertTo-Json -Compress)
      $params.ContentType = "application/json"
    }
    $resp = Invoke-RestMethod @params
  } catch {
    $errBody = $_.ErrorDetails.Message
    if ($errBody) {
      try { $p = $errBody | ConvertFrom-Json } catch { return @{ ok=$false; code="?"; msg=$errBody; raw=$null } }
      if ($p -and $p.PSObject.Properties['errors']) {
        $code = if ($p.errors.Count -gt 0) { $p.errors[0].code } else { "?" }
        $msg  = if ($p.errors.Count -gt 0) { $p.errors[0].message } else { $errBody }
        return @{ ok=$false; code=$code; msg=$msg; raw=$p }
      }
      return @{ ok=$false; code="?"; msg=$errBody; raw=$null }
    }
    return @{ ok=$false; code="?"; msg=$_.Exception.Message; raw=$null }
  }
  if ($resp -is [string]) {
    return @{ ok=$true; result=$resp; raw=$null }
  }
  if ($null -ne $resp.PSObject.Properties['success']) {
    if (-not $resp.success) {
      $code = if ($resp.errors.Count -gt 0) { $resp.errors[0].code } else { "?" }
      $msg  = if ($resp.errors.Count -gt 0) { $resp.errors[0].message } else { "unknown" }
      return @{ ok=$false; code=$code; msg=$msg; raw=$resp }
    }
    return @{ ok=$true; result=$resp.result; raw=$resp }
  }
  return @{ ok=$true; result=$resp; raw=$null }
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
if ($Token -like "cfk_*" -and -not $Email) {
  $Email = Read-Host "Cloudflare email"
}

$accts = cf GET "/accounts?per_page=5"
if (-not $accts.ok -or -not $accts.result -or $accts.result.Count -eq 0) {
  Write-Host "Auth failed: $($accts.msg)" -ForegroundColor Red; exit 1
}
$accountId = $accts.result[0].id
Write-Host "Account: $accountId" -ForegroundColor Gray

# ── KV helpers ───────────────────────────────────────────────────────────────
function Find-KV {
  $r = cf GET "/accounts/$accountId/storage/kv/namespaces"
  if ($r.ok) { return ($r.result | Where-Object { $_.title -eq $Title }) }
  return $null
}

function Ensure-KV {
  $existing = Find-KV
  if ($existing) {
    Write-Host "Reusing existing KV: $($existing.id) ($Title)" -ForegroundColor Yellow
    return $existing.id
  }
  Write-Host "Creating KV namespace ($Title)..." -ForegroundColor Gray
  $r = cf POST "/accounts/$accountId/storage/kv/namespaces" @{ title=$Title }
  if ($r.ok) {
    Write-Host "Created KV: $($r.result.id)" -ForegroundColor Green
    return $r.result.id
  }
  if ($r.code -eq 10014) {
    $existing = Find-KV
    if ($existing) { Write-Host "Reusing existing KV: $($existing.id)" -ForegroundColor Yellow; return $existing.id }
  }
  Write-Host "KV creation failed: $($r.msg)" -ForegroundColor Red; exit 1
}

function Get-SecurePath($KvId) {
  $r = cf GET "/accounts/$accountId/storage/kv/namespaces/$KvId/values/qproxy:settings"
  if (-not $r.ok) { return $null }
  $json = if ($r.result -is [string]) { $r.result } else { $r.result | ConvertTo-Json -Compress -Depth 10 }
  if ($json -match '"securePath"\s*:\s*"([a-f0-9]{12})"') { return $Matches[1] }
  return $null
}

function Get-DefaultBranch {
  try {
    $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$REPO" -UseBasicParsing -TimeoutSec 3 2>$null
    if ($r.default_branch) { return $r.default_branch }
  } catch {}
  return "master"
}

# ── download ─────────────────────────────────────────────────────────────────
function Download-Worker {
  Write-Host "Downloading $SCRIPT_NAME from Releases..." -ForegroundColor Gray
  $tmpFile = Join-Path $env:TEMP "q-proxy-$([guid]::NewGuid().ToString('N').Substring(0,8)).js"
  curl.exe -fsSL "https://github.com/$REPO/releases/latest/download/$SCRIPT_NAME" -o $tmpFile 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpFile) -or (Test-Path $tmpFile -and (Get-Item $tmpFile).Length -lt 10000)) {
    $branch = Get-DefaultBranch
    Write-Host "Release not found, trying $branch branch..." -ForegroundColor Gray
    curl.exe -fsSL "https://raw.githubusercontent.com/$REPO/$branch/dist/$SCRIPT_NAME" -o $tmpFile 2>$null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpFile) -or (Get-Item $tmpFile).Length -lt 10000) {
      $fallback = if ($branch -eq "master") { "main" } else { "master" }
      Write-Host "Trying fallback branch $fallback..." -ForegroundColor Gray
      curl.exe -fsSL "https://raw.githubusercontent.com/$REPO/$fallback/dist/$SCRIPT_NAME" -o $tmpFile 2>$null
    }
  }
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $tmpFile)) {
    Write-Host "Download failed" -ForegroundColor Red; exit 1
  }
  $size = (Get-Item $tmpFile).Length
  if ($size -lt 10000) { Write-Host "Download failed ($size bytes)" -ForegroundColor Red; Remove-Item $tmpFile -Force; exit 1 }
  Write-Host "Downloaded $size bytes" -ForegroundColor Green
  return $tmpFile
}

# ── upload via curl.exe (avoids PowerShell multipart corruption) ─────────────
function Upload-Worker($WorkerFilePath, $KvId) {
  Write-Host "Uploading worker..." -ForegroundColor Gray

  $metadata = @{
    main_module        = $SCRIPT_NAME
    compatibility_date = "2026-08-01"
    bindings           = @(@{ type="kv_namespace"; name=$BINDING; namespace_id=$KvId })
  } | ConvertTo-Json -Compress

  # Write metadata as bytes (no BOM) — WriteAllText can inject BOM in some PS versions
  $tmpMeta = Join-Path $env:TEMP "q-meta-$([guid]::NewGuid().ToString('N').Substring(0,8)).json"
  $metaBytes = [System.Text.Encoding]::UTF8.GetBytes($metadata)
  [System.IO.File]::WriteAllBytes($tmpMeta, $metaBytes)

  try {
    $authArg = if ($Token -like "cfk_*") {
      @("-H", "X-Auth-Key: $Token", "-H", "X-Auth-Email: $Email")
    } else {
      @("-H", "Authorization: Bearer $Token")
    }

    # Use @file for BOTH parts — no variable interpolation, no quoting issues
    $result = & curl.exe -s -X PUT "$BASE/accounts/$accountId/workers/scripts/$WORKER" `
      @authArg `
      -F "metadata=@$tmpMeta;type=application/json" `
      -F "$SCRIPT_NAME=@$WorkerFilePath;filename=$SCRIPT_NAME;type=application/javascript+module"

    if ($LASTEXITCODE -ne 0 -or -not $result) {
      Write-Host "Upload failed: curl exited with code $LASTEXITCODE" -ForegroundColor Red
      if ($result) { Write-Host $result -ForegroundColor Red }
      exit 1
    }
    $resp = $result | ConvertFrom-Json
    if (-not $resp.success) {
      Write-Host "Upload failed: $($resp.errors[0].message)" -ForegroundColor Red
      exit 1
    }
    Write-Host "Worker uploaded" -ForegroundColor Green
  } finally {
    if (Test-Path $WorkerFilePath) { Remove-Item $WorkerFilePath -Force }
    if (Test-Path $tmpMeta) { Remove-Item $tmpMeta -Force }
  }
}

# ── subdomain ────────────────────────────────────────────────────────────────
function Get-WorkerUrl {
  cf PUT "/accounts/$accountId/workers/subdomain" @{ enabled=$true } | Out-Null
  $r = cf GET "/accounts/$accountId/workers/subdomain"
  $sub = $r.result.subdomain
  return "https://$WORKER.$sub.workers.dev"
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
      $mark = if ($ns.title -eq $Title) { " *" } else { "" }
      Write-Host ("{0,-40} {1}{2}" -f $ns.id, $ns.title, $mark)
    }
    Write-Host ""
    Write-Host "* = current project namespace" -ForegroundColor Gray
    exit 0
  }

  "remove-kv" {
    $existing = Find-KV
    if (-not $existing) { Write-Host "No KV found with title: $Title" -ForegroundColor Yellow; exit 0 }
    Write-Host "KV: $($existing.id) ($($existing.title))" -ForegroundColor Yellow
    $confirm = Read-Host "Delete this KV namespace? (yes/no)"
    if ($confirm -ne "yes") { Write-Host "Cancelled" -ForegroundColor Gray; exit 0 }
    $r = cf DELETE "/accounts/$accountId/storage/kv/namespaces/$($existing.id)"
    if ($r.ok) { Write-Host "KV deleted" -ForegroundColor Green } else { Write-Host "Failed: $($r.msg)" -ForegroundColor Red }
    exit 0
  }

  "status" {
    $wr = cf GET "/accounts/$accountId/workers/scripts/$WORKER"
    if ($wr.ok) {
      Write-Host ""
      Write-Host "Worker: $WORKER" -ForegroundColor Cyan
      Write-Host "  Modified: $($wr.result.modified_on)"
      Write-Host "  Size: $([math]::Round($wr.result.size/1024, 1)) KB"
    } else {
      Write-Host "Worker: not deployed" -ForegroundColor Yellow
    }
    $sr = cf GET "/accounts/$accountId/workers/subdomain"
    if ($sr.ok -and $sr.result.subdomain) {
      $url = "https://$WORKER.$($sr.result.subdomain).workers.dev"
      Write-Host "  URL: $url"
    }
    $kv = Find-KV
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
    if (-not $sr.ok -or -not $sr.result.subdomain) { Write-Host "Could not get subdomain" -ForegroundColor Red; exit 1 }
    $url = "https://$WORKER.$($sr.result.subdomain).workers.dev"
    Write-Host "Seeding $url/ ..." -ForegroundColor Gray
    try { Invoke-WebRequest -Uri "$url/" -UseBasicParsing | Out-Null } catch {}
    Write-Host "Done" -ForegroundColor Green
    exit 0
  }

  "set-password" {
    if (-not $Password) { $Password = Read-Host "New panel password" }
    $kv = Find-KV
    if (-not $kv) { Write-Host "No Q Proxy KV found. Deploy first." -ForegroundColor Red; exit 1 }
    $sr = cf GET "/accounts/$accountId/workers/subdomain"
    if (-not $sr.ok -or -not $sr.result.subdomain) { Write-Host "Could not get subdomain" -ForegroundColor Red; exit 1 }
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
      $kv = Find-KV
      if ($kv) { $KVId = $kv.id } else { Write-Host "No Q Proxy KV found. Deploy first." -ForegroundColor Red; exit 1 }
    }
    $workerFile = Download-Worker
    $size = (Get-Item $workerFile).Length
    if ($Dry) { Write-Host "[dry] Would upload $size bytes with KV $KVId" -ForegroundColor Yellow; Remove-Item $workerFile -Force; exit 0 }
    Upload-Worker $workerFile $KVId
    Write-Host "Update complete" -ForegroundColor Green
    exit 0
  }

  "deploy" {
    if (-not $Password) { $Password = Read-Host "First panel password [empty to set later]" }
    $kvId = Ensure-KV
    $workerFile = Download-Worker
    if ($Dry) { Write-Host "[dry] Would upload worker with KV $kvId" -ForegroundColor Yellow; Remove-Item $workerFile -Force; exit 0 }
    Upload-Worker $workerFile $kvId
    $workerUrl = Get-WorkerUrl
    Write-Host "Worker URL: $workerUrl" -ForegroundColor Green

    Write-Host "Seeding..." -ForegroundColor Gray
    try { Invoke-WebRequest -Uri "$workerUrl/" -UseBasicParsing | Out-Null } catch {}
    # KV is eventually consistent — wait 2s for propagation before reading securePath
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
      Write-Host "Check KV → $Title → qproxy:settings → data.securePath"
      Write-Host "Panel: $workerUrl/<securePath>/panel"
    }
    exit 0
  }
}