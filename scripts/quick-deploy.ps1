# Q Proxy — Automatic deploy (no git, no wrangler, no build) — PowerShell
# - Downloads q-proxy.js from GitHub Releases
# - Creates KV, uploads Worker via Cloudflare API (Invoke-RestMethod)
# - Seeds and prints Panel URL, optionally sets first password
#
# Usage:
#   irm https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.ps1 | iex
#   powershell -ExecutionPolicy Bypass -c "irm https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/quick-deploy.ps1 | iex"
#   .\scripts\quick-deploy.ps1 -Token <token> -Password <pass>
# Env:
#   $env:CLOUDFLARE_API_TOKEN="xxx"  or  $env:CLOUDFLARE_API_KEY="cfk_xxx"; $env:CLOUDFLARE_EMAIL="you@example.com"

param(
  [string]$Token = $env:CLOUDFLARE_API_TOKEN,
  [string]$Email = $env:CLOUDFLARE_EMAIL,
  [string]$AccountId = $env:CLOUDFLARE_ACCOUNT_ID,
  [string]$Password = "",
  [switch]$Dry
)

$Repo = "QMahyar/q-proxy"
$WorkerName = "q-proxy"
$KvTitle = "q-proxy-QPROXY_KV"
$CompatDate = "2026-08-01"
$TokenUrl = "https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy&accountId=*&zoneId=all"

if (-not $Token) { $Token = $env:CLOUDFLARE_API_KEY }
if (-not $Token) {
  Write-Host ""
  Write-Host "Q Proxy — automatic deploy"
  Write-Host "=========================="
  Write-Host ""
  Write-Host "Create an API token with Workers:Edit + KV:Edit:"
  Write-Host "  $TokenUrl"
  Write-Host ""
  try { Start-Process $TokenUrl | Out-Null; Write-Host "Opened browser" } catch { Write-Host "Open manually: $TokenUrl" }
  $Token = Read-Host "Paste API Token (or Global Key cfk_...)"
}
if (-not $Token) { Write-Error "No token — abort"; exit 1 }

$IsGlobal = $Token.StartsWith("cfk_")
if ($IsGlobal -and -not $Email) {
  Write-Host "Global Key detected — needs email + account ID"
  $Email = Read-Host "Cloudflare email"
  if (-not $Email) { Write-Error "Email required"; exit 1 }
}
if (-not $Password) {
  $sec = Read-Host "First panel password (8+ chars, letter + digit) [empty to set later]" -AsSecureString
  if ($sec.Length -gt 0) {
    $Password = [System.Net.NetworkCredential]::new("", $sec).Password
    if ($Password.Length -lt 8) { Write-Error "Password too short"; exit 1 }
  }
}

function Get-AuthHeader($t, $e) {
  if ($t.StartsWith("cfk_")) { return @{ "X-Auth-Email" = $e; "X-Auth-Key" = $t } }
  return @{ "Authorization" = "Bearer $t" }
}

function Redact($t) { if ($t.Length -le 8) { return "***" } return $t.Substring(0,4) + "***" + $t.Substring($t.Length-4) }

Write-Host "`nAuth: $(if($IsGlobal){'Global Key'}else{'API Token'}) $(Redact $Token)$(if($Email){" / $Email"})"

if (-not $AccountId) {
  Write-Host "Resolving account ID..."
  try {
    $h = Get-AuthHeader $Token $Email
    $resp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts" -Headers $h -Method Get
    $accts = $resp.result
    if ($accts.Count -eq 1) { $AccountId = $accts[0].id }
    elseif ($accts.Count -gt 1) {
      Write-Host "Multiple accounts:"
      for ($i=0; $i -lt $accts.Count; $i++) { Write-Host "  $($i+1). $($accts[$i].name) — $($accts[$i].id)" }
      $idx = Read-Host "Pick number [1]"
      if (-not $idx) { $idx = "1" }
      $AccountId = $accts[[int]$idx-1].id
    }
    Write-Host "Account ID: $AccountId"
  } catch {
    Write-Host "Could not list accounts: $($_.Exception.Message)"
    $AccountId = Read-Host "Enter Account ID (32 hex)"
  }
}

if ($Dry) {
  Write-Host "[dry] Would create KV `"$KvTitle`" in $AccountId"
  Write-Host "[dry] Would upload Worker `"$WorkerName`" with KV binding QPROXY_KV"
  exit 0
}

# Get worker script
$WorkerJs = $null
$TmpFile = $null
if (Test-Path "dist/q-proxy.js") {
  Write-Host "Using local dist/q-proxy.js"
  $WorkerJs = Get-Content "dist/q-proxy.js" -Raw -Encoding UTF8
} else {
  $TmpFile = Join-Path $env:TEMP "q-proxy-$(Get-Random).js"
  Write-Host "Downloading q-proxy.js from Releases..."
  try {
    Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest/download/q-proxy.js" -OutFile $TmpFile -UseBasicParsing
    $WorkerJs = Get-Content $TmpFile -Raw -Encoding UTF8
    Write-Host "Downloaded $($WorkerJs.Length) chars"
  } catch {
    Write-Host "Release not found, trying raw main..."
    Invoke-WebRequest -Uri "https://raw.githubusercontent.com/$Repo/main/dist/q-proxy.js" -OutFile $TmpFile -UseBasicParsing
    $WorkerJs = Get-Content $TmpFile -Raw -Encoding UTF8
  }
  if (-not $WorkerJs -or $WorkerJs.Length -lt 10000) { Write-Error "Download failed — run: npm run build"; exit 1 }
}

# Create or reuse KV
Write-Host "Creating KV namespace `"$KvTitle`"..."
$h = Get-AuthHeader $Token $Email
try {
  $kvResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/storage/kv/namespaces" -Headers $h -Method Post -ContentType "application/json" -Body (@{title=$KvTitle} | ConvertTo-Json)
  $KvId = $kvResp.result.id
  Write-Host "KV created: $KvId"
} catch {
  $msg = $_.ErrorDetails.Message
  if ($msg -match "already exists|10014") {
    Write-Host "KV already exists, reusing..."
    $list = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/storage/kv/namespaces" -Headers $h -Method Get
    $found = $list.result | Where-Object { $_.title -eq $KvTitle } | Select-Object -First 1
    if (-not $found) { $found = $list.result | Select-Object -First 1 }
    $KvId = $found.id
  } else {
    Write-Host "KV create failed: $msg"
    throw
  }
}
Write-Host "KV: $KvId"

# Upload Worker (multipart)
Write-Host "Uploading Worker `"$WorkerName`"..."
$meta = @{main_module="q-proxy.js"; compatibility_date=$CompatDate; bindings=@(@{type="kv_namespace"; name="QPROXY_KV"; namespace_id=$KvId})} | ConvertTo-Json -Compress
# Use curl if available for multipart, else .NET
$HasCurl = Get-Command curl -ErrorAction SilentlyContinue
if ($HasCurl -and (curl --version 2>$null | Select-String "curl")) {
  $metaFile = Join-Path $env:TEMP "meta-$(Get-Random).json"
  Set-Content $metaFile $meta -Encoding UTF8
  $jsFile = if ($TmpFile -and (Test-Path $TmpFile)) { $TmpFile } else { "dist/q-proxy.js" }
  if (-not (Test-Path $jsFile)) { $jsFile = $TmpFile; Set-Content $jsFile $WorkerJs -Encoding UTF8 }
  $auth1 = if ($IsGlobal) { @("-H","X-Auth-Email: $Email","-H","X-Auth-Key: $Token") } else { @("-H","Authorization: Bearer $Token") }
  $curlArgs = @("-s","-X","PUT","https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/scripts/$WorkerName") + $auth1 + @("-F","metadata=$meta;type=application/json","-F","q-proxy.js=@$jsFile;type=application/javascript+module")
  $upResp = & curl @curlArgs 2>&1 | Out-String
  if ($upResp -notmatch '"success":true') { Write-Host "Upload failed: $upResp"; throw "Upload failed" }
} else {
  # Fallback: use Invoke-RestMethod with .NET multipart (simplified — may fail on large file)
  Add-Type -AssemblyName System.Net.Http
  $client = [System.Net.Http.HttpClient]::new()
  if ($IsGlobal) { $client.DefaultRequestHeaders.Add("X-Auth-Email",$Email); $client.DefaultRequestHeaders.Add("X-Auth-Key",$Token) } else { $client.DefaultRequestHeaders.Add("Authorization","Bearer $Token") }
  $form = [System.Net.Http.MultipartFormDataContent]::new()
  $form.Add([System.Net.Http.StringContent]::new($meta,[System.Text.Encoding]::UTF8,"application/json"),"metadata")
  $form.Add([System.Net.Http.StringContent]::new($WorkerJs,[System.Text.Encoding]::UTF8,"application/javascript+module"),"q-proxy.js","q-proxy.js")
  $resp = $client.PutAsync("https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/scripts/$WorkerName",$form).Result
  $txt = $resp.Content.ReadAsStringAsync().Result
  if ($txt -notmatch '"success":true') { Write-Host "Upload failed: $txt"; throw "Upload failed" }
}
Write-Host "Worker uploaded"

# Subdomain
try {
  $subResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/subdomain" -Headers (Get-AuthHeader $Token $Email) -Method Get
  $Sub = $subResp.result.subdomain
} catch { $Sub = $null }
if (-not $Sub) {
  try { Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/subdomain" -Headers (Get-AuthHeader $Token $Email) -Method Put -ContentType "application/json" -Body '{"enabled":true}' | Out-Null } catch {}
  $subResp = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/workers/subdomain" -Headers (Get-AuthHeader $Token $Email) -Method Get
  $Sub = $subResp.result.subdomain
}
$WorkerUrl = if ($Sub) { "https://$WorkerName.$Sub.workers.dev" } else { "https://$WorkerName.workers.dev" }
Write-Host "Worker URL: $WorkerUrl"

Write-Host "Seeding $WorkerUrl/ ..."
try { Invoke-WebRequest -Uri "$WorkerUrl/" -UseBasicParsing -TimeoutSec 8 | Out-Null; Write-Host "Seed OK" } catch { Write-Host "Seed warning: $($_.Exception.Message)" }
Start-Sleep -Seconds 2

Write-Host "Reading securePath..."
try {
  $kvVal = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/accounts/$AccountId/storage/kv/namespaces/$KvId/values/qproxy:settings" -Headers (Get-AuthHeader $Token $Email) -Method Get
  if ($kvVal -is [string]) { $kvVal = $kvVal | ConvertFrom-Json }
  $SecurePath = $kvVal.data.securePath
  if (-not $SecurePath) { $SecurePath = $kvVal.securePath }
} catch {
  Write-Host "KV read failed: $($_.Exception.Message)"
  $SecurePath = $null
}
if (-not $SecurePath) {
  Write-Host "Could not read securePath — try manual:"
  Write-Host "  Invoke-RestMethod https://api.cloudflare.com/client/v4/accounts/$AccountId/storage/kv/namespaces/$KvId/values/qproxy:settings -Headers @{Authorization='Bearer $(Redact $Token)'}"
  exit 0
}
$PanelUrl = "$WorkerUrl/$SecurePath/panel"
if ($Password) {
  Write-Host "Setting first password..."
  try {
    $body = @{newPassword=$Password} | ConvertTo-Json
    $setResp = Invoke-RestMethod -Uri "$WorkerUrl/$SecurePath/api/auth/setup" -Method Post -ContentType "application/json" -Body $body
    if ($setResp.ok) { Write-Host "Password set" } else { Write-Host "Password set response: $($setResp | ConvertTo-Json -Compress)" }
  } catch { Write-Host "Password set failed (set it in panel): $($_.Exception.Message)" }
}
Write-Host ""
Write-Host "=============================================================="
Write-Host "  Q Proxy is live (no wrangler, no git)"
Write-Host "=============================================================="
Write-Host "  Panel:        $PanelUrl"
Write-Host "  Subscription: $WorkerUrl/$SecurePath/sub"
Write-Host "  securePath:   $SecurePath"
Write-Host "  KV: $KvId  Account: $AccountId"
Write-Host "=============================================================="
if (-not $Password) { Write-Host "Next: open Panel URL and set a password (8+ chars, letter + digit)." } else { Write-Host "Password already set — open Panel and log in." }

if ($TmpFile -and (Test-Path $TmpFile)) { Remove-Item $TmpFile -Force -ErrorAction SilentlyContinue }
