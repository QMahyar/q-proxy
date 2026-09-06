#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Q Proxy deploy and panel manager.

Deploys Q Proxy (a Cloudflare Workers / Pages proxy panel) to your Cloudflare
account using only the raw REST API and Python's standard library (no pip, no
wrangler, no node). Handles Workers (dist/q-proxy.js) and Pages Advanced Mode
(dist/_worker.js) targets, creates KV + D1 named after your choices, applies the
D1 migrations, enables routing and sets a password YOU choose. Also lists and
deletes existing deployments.

Usage:
    python deploy.py                       # interactive quick deploy
    python deploy.py --detailed            # interactive deploy with full naming control
    python deploy.py list                  # list workers, pages, KV, D1
    python deploy.py status                # health-check live panels
    python deploy.py delete --kind worker|page|kv|d1 --name <name>
    python deploy.py token                 # print the prefilled API-token URL
    python deploy.py --help

Env (optional): CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. A token from the
prefilled URL is always preferred; if neither a token nor the env var is present
the script opens your browser to create one.
"""

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from pathlib import Path

API_BASE = "https://api.cloudflare.com/client/v4"
TOKEN_URL = (
    "https://dash.cloudflare.com/profile/api-tokens"
    "?permissionGroupKeys={perms}&name=Q%20Proxy&accountId={account}&zoneId=all"
)
# Permission groups required for deploy + manage. "edit" = full write; "read" for listing accounts.
REQUIRED_PERMS = [
    {"key": "workers_scripts", "type": "edit"},
    {"key": "workers_kv_storage", "type": "edit"},
    {"key": "d1", "type": "edit"},
    {"key": "pages", "type": "edit"},
    {"key": "account", "type": "edit"},
]
COMPAT_DATE = "2026-08-01"
BINDINGS_KV = "QPROXY_KV"
BINDINGS_D1 = "QPROXY_DB"
# Exact account-scoped permission group IDs (verified against the API).
PERM_IDS = {
    "workers_scripts": "e086da7e2179491d91ee5f35b3ca210a",
    "workers_kv_storage": "f7f0eda5697f475c90846e879bab8666",
    "d1": "09b2857d1c31407795e75e3fed8617a1",
    "pages": "8d28297797f24fb8a0c332fe0866ec89",
    "account_settings": "c1fde68c7bcc44588cbb6ddbc16d6480",
}


# --------------------------------------------------------------------------- #
# HTTP helpers (stdlib only)
# --------------------------------------------------------------------------- #
class CfError(Exception):
    def __init__(self, status, errors):
        msgs = "; ".join(e.get("message", str(e)) for e in errors) if errors else str(status)
        super().__init__(f"CF API {status}: {msgs}")
        self.status = status
        self.errors = errors


def auth_headers(token=None, gkey=None, email=None):
    """Bearer token by default; Global Key (cfk_...) + email when provided."""
    if gkey:
        if not email:
            raise SystemExit("Global Key requires an email.")
        return {"X-Auth-Email": email, "X-Auth-Key": gkey}
    return {"Authorization": f"Bearer {token}"}


def cf_request(method, path, token, body=None, headers=None, raw=None, gkey=None, email=None, tries=3):
    """Cloudflare REST call with retries on transient network/5xx errors.
    Safe to retry: all deploy writes are idempotent (unique titles/names,
    PUT overwrites, setup returns ALREADY_SET, migrations are IF NOT EXISTS)."""
    import http.client
    import socket
    import ssl
    import time as _t
    last = None
    for attempt in range(tries):
        url = API_BASE + path
        data = None
        hdrs = auth_headers(token, gkey, email)
        if headers:
            hdrs.update(headers)
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            hdrs.setdefault("Content-Type", "application/json")
        req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                payload = resp.read()
                status = resp.status
        except urllib.error.HTTPError as e:
            payload = e.read()
            status = e.code
            if status != 429 and status < 500:
                try:
                    parsed = json.loads(payload.decode("utf-8")) if payload else {}
                except ValueError:
                    parsed = {}
                raise CfError(status, parsed.get("errors", []))
            last = e  # 429 / 5xx: retry below
            _t.sleep(2 ** attempt)
            continue
        except (urllib.error.URLError, TimeoutError, socket.timeout, ssl.SSLError,
                http.client.RemoteDisconnected, ConnectionResetError) as e:
            last = e
            _t.sleep(2 ** attempt)
            continue
        try:
            parsed = json.loads(payload.decode("utf-8")) if payload else {}
        except ValueError:
            parsed = {}
        if not parsed.get("success", False):
            raise CfError(status, parsed.get("errors", []))
        return parsed.get("result")
    if isinstance(last, Exception):
        raise CfError(0, [{"message": f"transient network failure after {tries} tries: {last}"}])
    raise CfError(status, parsed.get("errors", []))


def multipart_form(fields):
    """Build a multipart/form-data body from {name: (filename, bytes, mime)} / {name: str}."""
    boundary = "----qproxy" + hashlib.sha1(os.urandom(16)).hexdigest()
    parts = []
    for name, val in fields.items():
        parts.append(f"--{boundary}\r\n".encode())
        if isinstance(val, tuple):
            fname, data, mime = val
            parts.append(
                f'Content-Disposition: form-data; name="{name}"; filename="{fname}"\r\n'.encode()
            )
            parts.append(f"Content-Type: {mime}\r\n\r\n".encode())
            parts.append(data)
        else:
            parts.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
            parts.append(str(val).encode() if isinstance(val, str) else json.dumps(val).encode())
        parts.append(b"\r\n")
    parts.append(f"--{boundary}--\r\n".encode())
    return b"".join(parts), boundary


def cf_get_raw(token, path, tries=3):
    """GET a non-envelope endpoint (e.g. KV /values/) — returns raw bytes."""
    import http.client
    import socket
    import ssl
    import time as _t
    last = None
    for attempt in range(tries):
        req = urllib.request.Request(API_BASE + path, method="GET",
                                     headers=auth_headers(token))
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                if resp.status == 404:
                    return None
                return resp.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code != 429 and e.code < 500:
                raise CfError(e.code, [{"message": e.read().decode("utf-8", "replace")[:200]}])
            last = e
            _t.sleep(2 ** attempt)
        except (urllib.error.URLError, TimeoutError, socket.timeout, ssl.SSLError,
                http.client.RemoteDisconnected, ConnectionResetError) as e:
            last = e
            _t.sleep(2 ** attempt)
    raise CfError(0, [{"message": f"transient failure after {tries} tries: {last}"}])


def cf_upload(token, path, fields):
    """POST multipart/form-data; returns parsed JSON result dict."""
    body, boundary = multipart_form(fields)
    url = API_BASE + path
    req = urllib.request.Request(
        url, data=body, method="POST",
        headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        payload = e.read()
        status = e.code
    parsed = json.loads(payload.decode("utf-8")) if payload else {}
    if not parsed.get("success", False):
        raise CfError(status, parsed.get("errors", []))
    return parsed.get("result")


# --------------------------------------------------------------------------- #
# Auth / account
# --------------------------------------------------------------------------- #
def build_token_url(account_hint="*"):
    perms = json.dumps(REQUIRED_PERMS, separators=(",", ":"))
    return TOKEN_URL.format(perms=urllib.parse.quote(perms), account=account_hint)


def verify_token(token):
    try:
        return cf_request("GET", "/user/tokens/verify", token)
    except CfError as e:
        if e.status in (400, 401, 403):
            raise CfError(e.status, e.errors)
        return None


def mint_token(admin_token, account, name="Q Proxy deploy", days=30, gkey=None, email=None):
    """Create a scoped API token via an admin credential (Global Key + email or
    existing admin bearer token). Returns the token value (shown once)."""
    import datetime
    now = datetime.datetime.now(datetime.timezone.utc)
    body = {
        "name": name,
        "policies": [{
            "effect": "allow",
            "resources": {f"com.cloudflare.api.account.{account}": "*"},
            "permission_groups": [{"id": pid} for pid in PERM_IDS.values()],
        }],
        "not_before": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "expires_on": (now + datetime.timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    # admin_token may be a Global Key (needs email headers) or a bearer token.
    res = cf_request("POST", "/user/tokens", admin_token, body, gkey=gkey, email=email)
    return res.get("value")


def cmd_mk_token(args):
    key = args.key or os.environ.get("CLOUDFLARE_API_KEY", "")
    email = args.email or os.environ.get("CLOUDFLARE_EMAIL", "")
    tok = args.token or os.environ.get("CLOUDFLARE_API_TOKEN", "")
    account = args.account or env_account()
    if key and email:
        val = mint_token(key, account, name=args.name or "Q Proxy deploy", days=args.days, gkey=key, email=email)
    elif tok:
        val = mint_token(tok, account, name=args.name or "Q Proxy deploy", days=args.days)
    else:
        raise SystemExit("Provide --key + --email (Global Key) or --token (admin token).")
    if not val:
        raise SystemExit("Token creation returned no value.")
    print("\nScoped API token (shown once — save it):\n")
    print(f"  {val}\n")
    print(f"  Expires in {args.days} days. Permissions: Workers Scripts, KV Storage, D1, Pages, Account Settings.")
    print(f"  Use: CLOUDFLARE_API_TOKEN={val} python deploy.py ...\n")


def list_accounts(token):
    try:
        return cf_request("GET", "/accounts", token)
    except CfError:
        return None


# --------------------------------------------------------------------------- #
# Resources: KV / D1
# --------------------------------------------------------------------------- #
def create_kv(account, token, title):
    # list-first: titles are unique per account, so reuse is exact
    try:
        for ns in cf_request("GET", f"/accounts/{account}/storage/kv/namespaces", token) or []:
            if ns["title"] == title:
                print(f"  KV exists: {title} -> {ns['id']}")
                return ns
    except CfError:
        pass
    data = cf_request("POST", f"/accounts/{account}/storage/kv/namespaces", token, {"title": title})
    print(f"  KV created: {data['id']} ({title})")
    return data


def create_d1(account, token, name):
    # list-first: names are unique per account
    try:
        for db in cf_request("GET", f"/accounts/{account}/d1/database", token) or []:
            if db["name"] == name:
                print(f"  D1 exists: {name} -> {db['uuid']}")
                return db
    except CfError:
        pass
    data = cf_request("POST", f"/accounts/{account}/d1/database", token, {"name": name})
    print(f"  D1 created: {data['uuid']} ({name})")
    return data


def apply_d1_migrations(account, token, db_id, sql):
    """Apply migrations. Returns (applied, skipped). Idempotent."""
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    ok_n, skip_n = 0, 0
    for s in statements:
        try:
            cf_request("POST", f"/accounts/{account}/d1/database/{db_id}/query",
                       token, {"sql": s})
            ok_n += 1
        except CfError as e:
            msg = str(e)
            if "already exists" in msg.lower() or "duplicate" in msg.lower():
                skip_n += 1
                continue
            print(f"  migration note: {friendly_cf_error(e)}")
            skip_n += 1
    return ok_n, skip_n


def friendly_cf_error(e):
    s = str(e)
    if "401" in s or "403" in s:
        return "unauthorized — wrong token or missing permissions (mint a fresh one with `python deploy.py token`)"
    if "404" in s:
        return "not found — wrong account, or the name does not exist there"
    if "already exists" in s.lower() or "409" in s:
        return "already exists — reusing it"
    if "429" in s:
        return "rate-limited — wait a minute and retry"
    if "timeout" in s.lower() or "transient" in s.lower() or "urlopen" in s.lower():
        return "network hiccup — retry"
    return s[:160]


# --------------------------------------------------------------------------- #
# Worker deploy
# --------------------------------------------------------------------------- #
def upload_worker_real(account, token, worker_name, script, kv_id, d1_id):
    metadata = {
        "main_module": "q-proxy.js",
        "compatibility_date": COMPAT_DATE,
        "bindings": [
            {"type": "kv_namespace", "name": BINDINGS_KV, "namespace_id": kv_id},
            {"type": "d1", "name": BINDINGS_D1, "id": d1_id},
        ],
    }
    body, boundary = multipart_form({
        "metadata": json.dumps(metadata),
        "q-proxy.js": ("q-proxy.js", script, "application/javascript+module"),
    })
    url = f"{API_BASE}/accounts/{account}/workers/scripts/{worker_name}"
    req = urllib.request.Request(
        url, data=body, method="PUT",
        headers={"Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = resp.read(); status = resp.status
    except urllib.error.HTTPError as e:
        payload = e.read(); status = e.code
    parsed = json.loads(payload.decode("utf-8")) if payload else {}
    if not parsed.get("success", False):
        raise CfError(status, parsed.get("errors", []))
    return parsed["result"]


def get_subdomain(account, token):
    """Read-only workers.dev subdomain lookup (never enables anything)."""
    try:
        r = cf_request("GET", f"/accounts/{account}/workers/subdomain", token)
        return (r or {}).get("subdomain", "")
    except CfError:
        return ""


def read_secure_path(account, token, kv_id):
    try:
        body = cf_get_raw(token, f"/accounts/{account}/storage/kv/namespaces/{kv_id}/values/qproxy:settings")
        raw = json.loads(body.decode("utf-8")) if body else None
        if isinstance(raw, dict):
            data = raw.get("data")
            if isinstance(data, dict) and data.get("securePath"):
                return data["securePath"]
    except (CfError, ValueError):
        pass
    return ""


def cmd_urls(args):
    """Reprint an existing panel's URLs by reading securePath from its KV."""
    tok = acquire_token(args)
    account = resolve_account(tok, args.account or env_account())
    panel = args.name
    if not panel and is_tty():
        panel = pick_existing_panel(account, tok)
    if not panel:
        raise SystemExit("No --name given and not interactive.")
    found = resolve_panel(account, tok, panel)
    if not found or not found.get("kv_id"):
        raise SystemExit(f"No panel '{panel}' with a readable KV found.")
    sp = read_secure_path(account, tok, found["kv_id"])
    if not sp:
        raise SystemExit(f"Panel '{panel}' has no seeded settings yet — open its worker URL once, then retry.")
    kind = found["kind"]
    base = panel_url(account, tok, kind, panel) if kind in ("workers", "pages") else ""
    if not base:
        raise SystemExit(f"Could not determine the public URL for '{panel}'.")
    print()
    print(base)
    print(f"{base}/{sp}/login")
    print(f"{base}/{sp}/sub")
    print(f"{base}/{sp}/panel")
    print(f"securePath: {sp}")
    print()


def enable_site_subdomain(account, token):
    try:
        r = cf_request("GET", f"/accounts/{account}/workers/subdomain", token)
        if r and r.get("subdomain"):
            return r["subdomain"]
    except CfError:
        pass
    try:
        r = cf_request("PUT", f"/accounts/{account}/workers/subdomain", token, {"enabled": True})
        return r.get("subdomain")
    except CfError:
        return None


def enable_worker_route(account, token, worker_name):
    try:
        cf_request("POST", f"/accounts/{account}/workers/scripts/{worker_name}/subdomain", token, {"enabled": True})
    except CfError:
        pass  # may already be enabled


# --------------------------------------------------------------------------- #
# Pages deploy
# --------------------------------------------------------------------------- #
def create_pages_project(account, token, project_name, kv_id, d1_id):
    body = {
        "name": project_name,
        "production_branch": "main",
        "deployment_configs": {
            "production": {
                "compatibility_date": COMPAT_DATE,
                "kv_namespaces": {BINDINGS_KV: {"namespace_id": kv_id}},
                "d1_databases": {BINDINGS_D1: {"id": d1_id}},
            }
        },
    }
    try:
        return cf_request("POST", f"/accounts/{account}/pages/projects", token, body)
    except CfError as e:
        if "already exists" in str(e) or e.status == 409:
            return None  # exists; we'll redeploy
        raise


def deploy_pages(account, token, project_name, worker_script):
    fields = {
        "commit_message": "Q Proxy deploy",
        "manifest": "{}",
        "_worker.js": ("_worker.js", worker_script, "application/javascript+module"),
    }
    # Direct-upload deployment requires _worker.js; manifest maps static assets (none here).
    return cf_upload(token, f"/accounts/{account}/pages/projects/{project_name}/deployments", fields)


def list_pages_projects(account, token):
    return cf_request("GET", f"/accounts/{account}/pages/projects", token)


# --------------------------------------------------------------------------- #
# Password set via panel API
# --------------------------------------------------------------------------- #
PANEL_UA = "Mozilla/5.0 (QProxy-Deploy/1.4)"


def post_json(url, body, cookie=None):
    hdrs = {"Content-Type": "application/json", "X-Q-Panel": "1", "User-Agent": PANEL_UA}
    if cookie:
        hdrs["Cookie"] = cookie
    req = urllib.request.Request(
        url, data=json.dumps(body).encode("utf-8"), method="POST", headers=hdrs,
    )
    set_cookie = ""
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            payload = resp.read(); status = resp.status
            set_cookie = resp.headers.get("Set-Cookie", "") or ""
    except urllib.error.HTTPError as e:
        payload = e.read(); status = e.code
        try:
            set_cookie = e.headers.get("Set-Cookie", "") or ""
        except Exception:
            pass
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except ValueError:
        parsed = {}
    return parsed, status, set_cookie


def parse_set_cookie(set_cookie):
    if not set_cookie:
        return ""
    try:
        from http.cookies import SimpleCookie
        jar = SimpleCookie()
        jar.load(set_cookie)
        return "; ".join(f"{k}={m.value}" for k, m in jar.items())
    except Exception:
        return ""


def set_first_password(base_url, secure_path, password, account=None, token=None, kv_id=None):
    """Set the user-chosen password with NO bootstrap gate.
    setup() stamps bootstrap; login (with retries for KV propagation) then a
    same-password change() clears it. The result is VERIFIED by reading the KV
    blob back — returns True only when passwordIsBootstrap is actually false."""
    setup_url = f"{base_url}/{secure_path}/api/auth/setup"
    parsed, status, _ = post_json(setup_url, {"newPassword": password})
    if not parsed.get("ok"):
        code = (parsed.get("error") or {}).get("code")
        if code == "SETUP_WINDOW_EXPIRED":
            return False
        if code != "ALREADY_SET":
            raise CfError(status, [{"message": str(parsed.get("error", parsed))}])
    login_url = f"{base_url}/{secure_path}/api/auth/login"
    cookie = ""
    for _ in range(12):
        _, _, set_cookie = post_json(login_url, {"password": password})
        cookie = parse_set_cookie(set_cookie)
        if cookie:
            break
        time.sleep(5)
    if not cookie:
        print("  ! login after setup kept failing — password may be set but unverified.")
        print("    Open the login page and sign in; use Change Password once to clear the first-run gate.")
        return False
    change_url = f"{base_url}/{secure_path}/api/auth/password"
    changed, _, _ = post_json(change_url, {"currentPassword": password, "newPassword": password}, cookie=cookie)
    if not changed.get("ok"):
        print(f"  ! bootstrap-clear change failed: {changed}")
        return False
    if account and token and kv_id:
        kv_path = f"/accounts/{account}/storage/kv/namespaces/{kv_id}/values/qproxy:settings"
        for _ in range(12):
            try:
                body = cf_get_raw(token, kv_path)
                if body and b'"passwordIsBootstrap":false' in body:
                    return True
            except CfError:
                pass
            time.sleep(5)
        print("  ! password set, but the first-run flag is still visible (KV lag or change lost).")
        print("    Sign in and use Change Password once to clear it.")
        return False
    return True


# --------------------------------------------------------------------------- #
# Load built artifacts (from dist/ or fall back to GitHub releases)
# --------------------------------------------------------------------------- #
def load_artifact(kind):
    repo = Path(__file__).resolve().parent
    if kind == "worker":
        p = repo / "dist" / "q-proxy.js"
    else:
        p = repo / "dist" / "_worker.js"
    if p.exists():
        return p.read_bytes(), f"(from {p.name})"
    # Try to build via npm if available
    print(f"  {p} not found; attempting 'npm run build'...")
    try:
        import subprocess
        subprocess.run(["npm", "run", "build"], cwd=str(repo), check=True, capture_output=True)
        if p.exists():
            return p.read_bytes(), "(built)"
    except Exception:
        pass
    # Fall back to GitHub release asset
    import urllib.request as u
    url = "https://raw.githubusercontent.com/QMahyar/q-proxy/master/dist/q-proxy.js"
    try:
        data = u.urlopen(url, timeout=60).read()
        return data, "(downloaded)"
    except Exception:
        raise SystemExit("No built artifact and could not build/download. Run `npm run build` first.")


def slugify(name):
    s = re.sub(r"[^A-Za-z0-9_.-]", "-", name.strip()).lower()
    return s or "q-proxy"


# --------------------------------------------------------------------------- #
# Interactive helpers (TTY-only; flag-driven mode never touches these)
# --------------------------------------------------------------------------- #
def safe_input(prompt):
    """input() that turns EOF/Ctrl+C into a clean abort instead of a traceback."""
    try:
        return input(prompt)
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        raise SystemExit(130)


def ask(prompt, default=None):
    if default is not None:
        prompt = f"{prompt} [{default}]: "
    else:
        prompt += ": "
    v = safe_input(prompt).strip()
    return v or (default or "")


def normalize_token(raw):
    tok = (raw or "").strip()
    if tok.lower().startswith("bearer "):
        tok = tok[7:].strip()
    return tok


def arrow_capable():
    if not is_tty():
        return False
    try:
        if not sys.stdin.fileno() >= 0:
            return False
    except Exception:
        return False
    if os.name == "nt":
        try:
            import msvcrt  # noqa
            return True
        except ImportError:
            return False
    try:
        import termios  # noqa
        return True
    except ImportError:
        return False


def _read_key():
    """Return one of: up|down|enter|esc|quit."""
    if os.name == "nt":
        import msvcrt
        ch = msvcrt.getch()
        if ch in (b"\x00", b"\xe0"):
            ch2 = msvcrt.getch()
            if ch2 == b"H":
                return "up"
            if ch2 == b"P":
                return "down"
            return ""
        if ch == b"\r":
            return "enter"
        if ch == b"\x1b":
            return "esc"
        if ch == b"\x03":
            raise KeyboardInterrupt
        if ch in (b"q", b"Q"):
            return "quit"
        return ""
    import termios
    import tty
    fd = sys.stdin.fileno()
    saved = termios.tcgetattr(fd)
    try:
        tty.setraw(fd)
        ch = sys.stdin.read(1)
        if ch == "\x1b":
            seq = sys.stdin.read(2)
            if seq == "[A":
                return "up"
            if seq == "[B":
                return "down"
            return "esc"
        if ch in ("\r", "\n"):
            return "enter"
        if ch == "\x03":
            raise KeyboardInterrupt
        if ch in ("q", "Q"):
            return "quit"
        return ""
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, saved)


def select_numbered(title, options):
    print(f"\n{title}")
    for i, opt in enumerate(options):
        print(f"  {i + 1}. {opt}")
    while True:
        raw = safe_input(f"Choice [1-{len(options)}]: ").strip()
        if not raw:
            return options[0]
        try:
            n = int(raw)
            if 1 <= n <= len(options):
                return options[n - 1]
        except ValueError:
            pass
        print(f"Enter a number 1-{len(options)}.")


def select_interactive(title, options):
    idx = 0
    n = len(options)
    sys.stdout.write("\x1b[?25l")
    sys.stdout.flush()
    try:
        while True:
            lines = [f"\n{title}"]
            for i, opt in enumerate(options):
                if i == idx:
                    lines.append(f"\x1b[7m> {opt}\x1b[0m")
                else:
                    lines.append(f"  {opt}")
            lines.append("\x1b[2m↑↓ navigate · Enter select · q cancel\x1b[0m")
            sys.stdout.write("\n".join(lines))
            sys.stdout.flush()
            try:
                key = _read_key()
            except KeyboardInterrupt:
                print("\nAborted.")
                raise SystemExit(130)
            if key == "up":
                idx = (idx - 1) % n
            elif key == "down":
                idx = (idx + 1) % n
            elif key == "enter":
                print()
                return options[idx]
            elif key in ("esc", "quit"):
                print("\nAborted.")
                raise SystemExit(130)
            sys.stdout.write(f"\x1b[{n + 2}A\r\x1b[2K")
    finally:
        sys.stdout.write("\x1b[?25h")
        sys.stdout.flush()


def select_option(title, options):
    """Arrow-key menu on capable TTYs, numbered list otherwise."""
    if arrow_capable():
        try:
            return select_interactive(title, options)
        except Exception:
            pass
    return select_numbered(title, options)


def password_problems(pw):
    problems = []
    if len(pw) < 8:
        problems.append("at least 8 characters")
    if not re.search(r"[A-Za-z]", pw):
        problems.append("at least one letter")
    if not re.search(r"\d", pw):
        problems.append("at least one digit")
    return problems


def ask_password():
    import getpass
    import warnings
    while True:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pw = getpass.getpass("Panel password: ").strip()
        problems = password_problems(pw)
        if problems:
            print("  Needs: " + ", ".join(problems) + ".")
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            pw2 = getpass.getpass("Repeat password: ").strip()
        if pw != pw2:
            print("  Passwords do not match — try again.")
            continue
        return pw


def confirm_type(name):
    """Type-the-name confirmation for destructive actions."""
    v = safe_input(f"Type '{name}' to confirm deletion: ").strip()
    return v == name


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_token(args):
    url = build_token_url(args.account or "*")
    print("\nCreate a Cloudflare API token with the exact permissions")
    print("Q Proxy needs (they are pre-filled on the page). Open this URL:\n")
    print(url + "\n")


def is_tty():
    try:
        return sys.stdin.isatty() and os.isatty(sys.stdout.fileno())
    except Exception:
        return False


def prompt_or(args_val, prompt, default=None, interactive=True):
    """Return args_val if provided (flag-driven), else prompt (interactive).
    If not interactive and args_val is None, fall back to default or error."""
    if args_val is not None:
        return args_val
    if interactive and is_tty():
        return ask(prompt, default)
    return default


_SESSION = {"token": None, "verified": False}


def pause():
    if is_tty():
        try:
            input("\nPress Enter to continue...")
        except (EOFError, KeyboardInterrupt):
            print()


def acquire_token(args):
    # Precedence: --token flag > CLOUDFLARE_API_TOKEN env > interactive paste > fail fast.
    tok = normalize_token(getattr(args, "token", None))
    if not tok:
        tok = normalize_token(os.environ.get("CLOUDFLARE_API_TOKEN"))
    interactive = is_tty()
    if not tok:
        if not interactive:
            raise SystemExit("No token: set CLOUDFLARE_API_TOKEN, pass --token, or run interactively (`python deploy.py token` prints the creation link).")
        url = build_token_url(args.account or env_account() or "*")
        print("First, create a Cloudflare API token with the exact permissions")
        print("Q Proxy needs (they are pre-filled on the page). Open this URL:\n")
        print(url + "\n")
        print("Create the token, then paste it below.")
        tok = normalize_token(ask("Paste your Cloudflare API token", ""))
    if not tok:
        raise SystemExit("No token provided. Set CLOUDFLARE_API_TOKEN, pass --token, or run interactively.")
    if _SESSION["verified"] and _SESSION["token"] == tok:
        return tok
    try:
        info = verify_token(tok)
    except CfError as e:
        if e.status in (401, 403):
            raise SystemExit("Token rejected (401/403) — wrong token or missing permissions. Create a fresh one with `python deploy.py token`.")
        raise SystemExit(f"Could not verify token (network?): {e}. Retry, or check connectivity.")
    warn_token_expiry(info)
    print("Token verified.")
    _SESSION["token"] = tok
    _SESSION["verified"] = True
    return tok


def warn_token_expiry(info):
    try:
        import datetime
        exp = (info or {}).get("expires_on")
        if not exp:
            return
        dt = datetime.datetime.fromisoformat(exp.replace("Z", "+00:00"))
        left = dt - datetime.datetime.now(datetime.timezone.utc)
        if left.days < 7:
            print(f"(!) Token expires {exp} — mint a fresh one soon (`python deploy.py token`).")
    except Exception:
        pass


def resolve_account(tok, hint=None):
    """Return account id (str). Hint = --account flag or env var."""
    if hint:
        return hint
    try:
        accounts = cf_request("GET", "/accounts", tok)
    except CfError:
        accounts = None
    if accounts:
        if len(accounts) == 1:
            print(f"Account: {accounts[0].get('name')} ({accounts[0]['id']})")
            return accounts[0]["id"]
        if is_tty():
            labels = [f"{a.get('name')} ({a['id']})" for a in accounts]
            picked = select_option("Choose Cloudflare account", labels)
            idx = labels.index(picked)
            return accounts[idx]["id"]
        raise CfError(0, [{"message": "Multiple accounts; pass --account <id>."}])
    raise CfError(0, [{"message": "Could not resolve account. Provide --account <32-hex id>."}])


TARGET_LABELS = {
    "workers": "Workers — instant <name>.<sub>.workers.dev (dist/q-proxy.js)",
    "pages": "Pages — Advanced Mode, custom domains OK (dist/_worker.js)",
}


def do_deploy(args):
    print("\n=== Q Proxy — new panel ===\n")
    interactive = is_tty()

    print("-- Cloudflare access")
    tok = acquire_token(args)
    acct_id = resolve_account(tok, args.account or env_account())
    print(f"  Account: {acct_id}")

    print("\n-- Deployment target")
    if args.target:
        target = args.target
    elif interactive:
        picked = select_option("Choose deploy target", list(TARGET_LABELS.values()))
        target = next(k for k, v in TARGET_LABELS.items() if v == picked)
    else:
        raise SystemExit("No --target (workers|pages) given and not interactive.")

    if args.name:
        panel_name = args.name
    elif interactive:
        panel_name = ask("Panel name (worker/project name, e.g. my-panel)", "q-proxy")
    else:
        raise SystemExit("No --name given and not interactive.")
    slugged = slugify(panel_name)
    if slugged != panel_name:
        print(f"  (using '{slugged}')")
    panel_name = slugged

    existing = compute_exists(acct_id, tok, panel_name)
    if existing and not getattr(args, "force", False):
        msg = (f"'{panel_name}' already exists as a {existing} panel. A fresh deploy rebinds "
               f"new empty KV/D1 — settings, users and quotas on the old bindings go dark. "
               f"To refresh code instead, use `update` (keeps everything).")
        if not interactive:
            raise SystemExit(msg + " Pass --force to deploy over it anyway.")
        print(f"\n(!) {msg}")
        choice = select_option("How to proceed?", [
            "Update it instead (keeps password + data)",
            "Deploy over it anyway (fresh empty state)",
            "Abort",
        ])
        if choice.startswith("Update"):
            return cmd_update(argparse.Namespace(name=panel_name, target=existing,
                                                 token=tok, account=acct_id, func=cmd_update))
        if choice.startswith("Abort"):
            print("Aborted — nothing changed.")
            return

    kv_title = prompt_or(args.kv, "KV namespace title", f"{panel_name}-QPROXY_KV", interactive)
    d1_name = prompt_or(args.d1, "D1 database name", f"{panel_name}-db", interactive)

    print("\n-- Provisioning resources on Cloudflare")
    kv = create_kv(acct_id, tok, kv_title)
    print(f"  KV: {kv['id']} ({kv_title})")
    d1 = create_d1(acct_id, tok, d1_name)
    print(f"  D1: {d1['uuid']} ({d1_name})")
    sql_path = Path(__file__).resolve().parent / "migrations" / "0001_init.sql"
    if sql_path.exists():
        ok_n, skip_n = apply_d1_migrations(acct_id, tok, d1["uuid"], sql_path.read_text())
        print(f"  Migrations: {ok_n} applied / {skip_n} already present")

    print("\n-- Deploying")
    base_url = None
    if target == "workers":
        script, src = load_artifact("worker")
        print(f"  Using {src} ({len(script)} bytes)")
        upload_worker_real(acct_id, tok, panel_name, script, kv["id"], d1["uuid"])
        sub = enable_site_subdomain(acct_id, tok) or env_subdomain() or getattr(args, "subdomain", None)
        enable_worker_route(acct_id, tok, panel_name)
        while not sub or not re.fullmatch(r"[a-z0-9-]+", sub):
            if interactive:
                sub = ask("Workers subdomain (dashboard → Workers → your subdomain, e.g. qhorror13194)", "")
            else:
                raise SystemExit("Could not determine workers subdomain. Pass --subdomain or re-run interactively.")
        base_url = f"https://{panel_name}.{sub}.workers.dev"
        print(f"  Worker uploaded: {base_url}")
    else:
        script, src = load_artifact("pages")
        print(f"  Using {src} ({len(script)} bytes)")
        create_pages_project(acct_id, tok, panel_name, kv["id"], d1["uuid"])
        deploy_pages(acct_id, tok, panel_name, script)
        proj = None
        for p in list_pages_projects(acct_id, tok) or []:
            if p["name"] == panel_name:
                proj = p; break
        base_url = proj.get("url", f"https://{panel_name}.pages.dev") if proj else f"https://{panel_name}.pages.dev"
        print(f"  Pages project deployed: {base_url}")

    print("\n-- Panel password (you choose it; no default gating)")
    password = args.password or (ask_password() if interactive else None)
    if not password:
        raise SystemExit("No --password given and not interactive. Password is required (>=8, letter+digit).")

    print("\n-- Waiting for first seed (up to 4 min; Ctrl+C aborts — you can also set")
    print("   the password later via the login page's setup card)")
    secure_path = wait_for_seed(acct_id, tok, kv["id"], base_url)
    if not secure_path:
        print("\nSeed not visible yet. The worker is uploaded; open it once in a browser,")
        print("then re-run this script (it resumes) or set the password via the setup card:")
        print(base_url + "/")
        print(f"KV: {kv['id']}  D1: {d1['uuid']}")
        return
    print(f"  securePath: {secure_path}")
    ok = set_first_password(base_url, secure_path, password,
                            account=acct_id, token=tok, kv_id=kv["id"])
    if not ok:
        print("  ! Setup window expired / could not set password automatically;")
        print("    open the login page and use the first-visit setup card instead.")
    else:
        print("  Password set to your choice.")

    print("\n" + "=" * 60)
    print("  Q Proxy is live — save these (shown only here)")
    print("=" * 60)
    print(base_url)
    print(f"{base_url}/{secure_path}/login")
    print(f"{base_url}/{secure_path}/sub")
    print(f"{base_url}/{secure_path}/panel")
    print(f"securePath: {secure_path}")
    print(f"Password: {password}")
    print("=" * 60 + "\n")
    if interactive:
        deploy_next_steps(base_url, secure_path, panel_name)


def deploy_next_steps(base_url, secure_path, panel_name):
    login_url = f"{base_url}/{secure_path}/login"
    while True:
        choice = select_option("Results — what next?", [
            "Open panel login in browser",
            "Test health + login page",
            "Back to main menu",
            "Exit",
        ])
        if choice.startswith("Open panel"):
            try:
                webbrowser.open(login_url)
                print(f"Opened {login_url} (if nothing opened, copy it manually.)")
            except Exception:
                print(f"Could not open a browser — copy manually: {login_url}")
        elif choice.startswith("Test health"):
            test_panel_health(base_url, login_url)
        elif choice.startswith("Back"):
            return
        else:
            print("Bye.")
            raise SystemExit(0)


def test_panel_health(base_url, login_url):
    try:
        req = urllib.request.Request(base_url + "/healthz", headers={"User-Agent": PANEL_UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            info = json.loads(r.read().decode("utf-8"))
        print(f"Health OK — version {info.get('version')} at {info.get('colo')}")
    except Exception as e:
        print(f"Health FAIL: {e} — code is up but the check failed; try Update panel from the menu.")
        return
    try:
        req = urllib.request.Request(login_url, headers={"User-Agent": PANEL_UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            ok = r.status == 200
        print(f"Login page {'OK (200)' if ok else f'unexpected ({r.status})'}")
    except Exception as e:
        print(f"Login page FAIL: {e}")


def wait_for_seed(account, token, kv_id, base_url, timeout=240):
    """Poll KV for the seeded settings blob (KV propagation can take minutes).
    Also nudges the worker root to trigger a seed on first hit."""
    kv_path = f"/accounts/{account}/storage/kv/namespaces/{kv_id}/values/qproxy:settings"
    deadline = time.time() + timeout
    tick = 0
    while time.time() < deadline:
        try:
            body = cf_get_raw(token, kv_path)
            if body:
                try:
                    raw = json.loads(body.decode("utf-8"))
                except ValueError:
                    raw = None
                if isinstance(raw, dict):
                    data = raw.get("data")
                    if isinstance(data, dict) and data.get("securePath"):
                        return data["securePath"]
                    if raw.get("securePath"):
                        return raw["securePath"]
        except CfError:
            pass
        try:
            nudge = urllib.request.Request(f"{base_url}/", headers={"User-Agent": PANEL_UA})
            urllib.request.urlopen(nudge, timeout=8).read()
        except Exception:
            pass
        tick += 1
        elapsed = int(time.time() - (deadline - timeout))
        print(f"  ... {elapsed}s elapsed (poll {tick})", flush=True)
        time.sleep(5)
    return ""


def cmd_list(args):
    tok = acquire_token(args)
    account = args.account or env_account()
    if not account:
        try:
            account = resolve_account(tok, None)
        except CfError:
            raise SystemExit("Provide --account <32-hex id>")
    print("\n=== Q Proxy deployments on account", account, "===\n")

    print("Workers:")
    try:
        for w in cf_request("GET", f"/accounts/{account}/workers/scripts", tok) or []:
            print(f"  - {w['id']}")
    except Exception as e:
        print(f"  (could not list workers: {str(e)[:90]})")

    print("\nPages projects:")
    try:
        for p in cf_request("GET", f"/accounts/{account}/pages/projects", tok) or []:
            print(f"  - {p['name']}  {p.get('url','')}")
    except Exception as e:
        print(f"  (could not list pages: {str(e)[:90]})")

    print("\nKV namespaces:")
    try:
        for ns in cf_request("GET", f"/accounts/{account}/storage/kv/namespaces", tok) or []:
            print(f"  - {ns['id']}  {ns['title']}")
    except Exception as e:
        print(f"  (could not list KV: {str(e)[:90]})")

    print("\nD1 databases:")
    try:
        for db in cf_request("GET", f"/accounts/{account}/d1/database", tok) or []:
            print(f"  - {db['uuid']}  {db['name']}")
    except Exception as e:
        print(f"  (could not list D1: {str(e)[:90]})")


def need_confirm(args, name):
    """Type-the-name confirmation on TTY; --yes on flags; fail-fast otherwise."""
    if getattr(args, "yes", False):
        return True
    if is_tty():
        print(f"\nThis permanently deletes '{name}' (cannot be undone).")
        return confirm_type(name)
    raise SystemExit(f"Refusing to delete '{name}' non-interactively without --yes.")


def cmd_delete(args):
    tok = acquire_token(args)
    account = args.account or env_account()
    if not account:
        raise SystemExit("Provide --account <32-hex id>")
    if args.kind == "worker":
        if not need_confirm(args, args.name):
            print("Cancelled.")
            return
        cf_request("DELETE", f"/accounts/{account}/workers/scripts/{args.name}", tok)
        print(f"Deleted worker {args.name}")
    elif args.kind == "page":
        if not need_confirm(args, args.name):
            print("Cancelled.")
            return
        cf_request("DELETE", f"/accounts/{account}/pages/projects/{args.name}", tok)
        print(f"Deleted Pages project {args.name}")
    elif args.kind == "kv":
        for ns in cf_request("GET", f"/accounts/{account}/storage/kv/namespaces", tok) or []:
            if ns["title"] == args.name or ns["id"] == args.name:
                if not need_confirm(args, ns["title"]):
                    print("Cancelled.")
                    return
                cf_request("DELETE", f"/accounts/{account}/storage/kv/namespaces/{ns['id']}", tok)
                print(f"Deleted KV {ns['title']}")
                return
        print("KV not found")
    elif args.kind == "d1":
        for db in cf_request("GET", f"/accounts/{account}/d1/database", tok) or []:
            if db["name"] == args.name or db["uuid"] == args.name:
                if not need_confirm(args, db["name"]):
                    print("Cancelled.")
                    return
                cf_request("DELETE", f"/accounts/{account}/d1/database/{db['uuid']}", tok)
                print(f"Deleted D1 {db['name']}")
                return
        print("D1 not found")
    elif args.kind == "panel":
        cmd_delete_panel(tok, account, args)
    else:
        raise SystemExit("--kind must be worker|page|kv|d1|panel")


def resolve_panel(account, token, panel):
    """Find an existing panel. Returns dict(kind, kv_id, d1_id, source, url?).
    Compute membership comes from list endpoints; resource IDs from live Pages
    config, else the {panel}-QPROXY_KV / {panel}(-db) naming convention."""
    try:
        for w in cf_request("GET", f"/accounts/{account}/workers/scripts", token) or []:
            if w["id"] == panel:
                kv_id, d1_id = convention_ids(account, token, panel)
                return {"kind": "workers", "kv_id": kv_id, "d1_id": d1_id, "source": "convention"}
    except CfError:
        pass
    try:
        proj = cf_request("GET", f"/accounts/{account}/pages/projects/{panel}", token)
        prod = ((proj.get("deployment_configs") or {}).get("production") or {})
        kv_id = ((prod.get("kv_namespaces") or {}).get(BINDINGS_KV) or {}).get("namespace_id")
        d1_id = ((prod.get("d1_databases") or {}).get(BINDINGS_D1) or {}).get("id")
        if not kv_id or not d1_id:
            ckv, cd1 = convention_ids(account, token, panel)
            kv_id, d1_id = kv_id or ckv, d1_id or cd1
        return {"kind": "pages", "kv_id": kv_id, "d1_id": d1_id,
                "source": "live", "url": proj.get("url")}
    except CfError:
        pass
    kv_id, d1_id = convention_ids(account, token, panel)
    if kv_id or d1_id:
        print("(!) compute not found; using naming-convention leftovers")
        return {"kind": "leftovers", "kv_id": kv_id, "d1_id": d1_id, "source": "convention"}
    return None


def compute_exists(account, token, panel):
    """Return 'workers'/'pages' if a compute resource with this name exists, else ''."""
    try:
        for w in cf_request("GET", f"/accounts/{account}/workers/scripts", token) or []:
            if w["id"] == panel:
                return "workers"
    except CfError:
        pass
    try:
        cf_request("GET", f"/accounts/{account}/pages/projects/{panel}", token)
        return "pages"
    except CfError:
        return ""


def convention_ids(account, token, panel):
    kv_id, d1_id = None, None
    try:
        for ns in cf_request("GET", f"/accounts/{account}/storage/kv/namespaces", token) or []:
            if ns["title"] == f"{panel}-QPROXY_KV":
                kv_id = ns["id"]
    except CfError:
        pass
    try:
        for db in cf_request("GET", f"/accounts/{account}/d1/database", token) or []:
            if db["name"] in (panel, f"{panel}-db"):
                d1_id = db["uuid"]
    except CfError:
        pass
    return kv_id, d1_id


def cmd_delete_panel(tok, account, args):
    panel = args.name
    found = resolve_panel(account, tok, panel)
    if not found:
        print(f"No worker, Pages project, or leftover KV/D1 named '{panel}'.")
        return
    print(f"\nPanel '{panel}' resolves to:")
    print(f"  compute: {found['kind']} (source: {found['source']})")
    if found.get("kv_id"):
        print(f"  KV: {found['kv_id']}")
    if found.get("d1_id"):
        print(f"  D1: {found['d1_id']}")
    if not need_confirm(args, panel):
        print("Cancelled.")
        return
    if found["kind"] == "workers":
        cf_request("DELETE", f"/accounts/{account}/workers/scripts/{panel}", tok)
        print(f"Deleted worker {panel}")
    elif found["kind"] == "pages":
        cf_request("DELETE", f"/accounts/{account}/pages/projects/{panel}", tok)
        print(f"Deleted Pages project {panel}")
    if found.get("kv_id"):
        try:
            cf_request("DELETE", f"/accounts/{account}/storage/kv/namespaces/{found['kv_id']}", tok)
            print("Deleted bound KV")
        except CfError as e:
            print(f"KV delete note: {friendly_cf_error(e)}")
    if found.get("d1_id"):
        try:
            cf_request("DELETE", f"/accounts/{account}/d1/database/{found['d1_id']}", tok)
            print("Deleted bound D1")
        except CfError as e:
            print(f"D1 delete note: {friendly_cf_error(e)}")


def cmd_update(args):
    """Re-upload the bundle onto an existing panel. Never touches settings/password."""
    print("\n=== Q Proxy — update panel ===")
    print("(code + migrations only — password, settings and data are untouched)\n")
    interactive = is_tty()
    tok = acquire_token(args)
    account = resolve_account(tok, args.account or env_account())
    print(f"  Account: {account}")
    panel = getattr(args, "name", None)
    if not panel and interactive:
        panel = pick_existing_panel(account, tok)
    if not panel:
        raise SystemExit("No --name given and not interactive.")
    found = resolve_panel(account, tok, panel)
    if not found or found["kind"] == "leftovers":
        raise SystemExit(f"No live worker/project '{panel}'. Leftovers: "
                         f"KV={found['kv_id'] if found else None} D1={found['d1_id'] if found else None}. "
                         f"Redeploy with `deploy`, or delete leftovers with `delete --kind kv|d1`.")
    kind = found["kind"]
    if getattr(args, "target", None) and args.target != kind:
        raise SystemExit(f"'{panel}' is a {kind} panel, but --target {args.target} was given.")
    kv_id, d1_id = found["kv_id"], found["d1_id"]
    if not kv_id or not d1_id:
        raise SystemExit(f"Live bindings incomplete for '{panel}' (KV={kv_id} D1={d1_id}).")
    print(f"  Panel: {panel} ({kind}, bindings from {found['source']})")
    script, src = load_artifact("worker" if kind == "workers" else "pages")
    print(f"  Uploading {src} ({len(script)} bytes)...")
    if kind == "workers":
        upload_worker_real(account, tok, panel, script, kv_id, d1_id)
        enable_worker_route(account, tok, panel)
    else:
        deploy_pages(account, tok, panel, script)
    sql_path = Path(__file__).resolve().parent / "migrations" / "0001_init.sql"
    if sql_path.exists():
        ok_n, skip_n = apply_d1_migrations(account, tok, d1_id, sql_path.read_text())
        print(f"  Migrations: {ok_n} applied / {skip_n} already present")
    base = panel_url(account, tok, kind, panel)
    print(f"  Health: {base}/healthz")
    try:
        req = urllib.request.Request(base + "/healthz", headers={"User-Agent": PANEL_UA})
        with urllib.request.urlopen(req, timeout=30) as r:
            info = json.loads(r.read().decode("utf-8"))
        print(f"  OK — version {info.get('version')} at {info.get('colo')}")
    except Exception as e:
        raise SystemExit(f"Update uploaded but healthz failed: {e}")
    print(f"\n'{panel}' updated. Password and settings untouched.\n")


def panel_url(account, token, kind, panel):
    if kind == "pages":
        try:
            proj = cf_request("GET", f"/accounts/{account}/pages/projects/{panel}", token)
            if proj.get("url"):
                return proj["url"]
        except CfError:
            pass
        return f"https://{panel}.pages.dev"
    try:
        sub = get_subdomain(account, token)
    except CfError:
        sub = ""
    return f"https://{panel}.{sub}.workers.dev" if sub else ""


def pick_existing_panel(account, token):
    names = []
    labels = []
    try:
        for w in cf_request("GET", f"/accounts/{account}/workers/scripts", token) or []:
            names.append(("workers", w["id"]))
            labels.append(f"worker: {w['id']}")
    except CfError:
        pass
    try:
        for p in cf_request("GET", f"/accounts/{account}/pages/projects", token) or []:
            names.append(("pages", p["name"]))
            labels.append(f"pages: {p['name']}  {p.get('url', '')}")
    except CfError:
        pass
    if not names:
        print("No workers or Pages projects on this account.")
        return ""
    labels.append("Back")
    picked = select_option("Choose existing panel", labels)
    if picked == "Back":
        return ""
    return names[labels.index(picked)][1]


def cmd_status(args):
    tok = acquire_token(args)
    account = args.account or env_account()
    if not account:
        raise SystemExit("Provide --account <32-hex id>")
    print("\n=== Q Proxy live status ===\n")
    for p in cf_request("GET", f"/accounts/{account}/pages/projects", tok) or []:
        print(f"  Pages: {p.get('url','')}")
    print("  (Tip: open any panel URL + /healthz to check version.)")


def env_subdomain():
    return os.environ.get("QPROXY_SUBDOMAIN", "")


def env_account():
    return os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")


def main():
    parser = argparse.ArgumentParser(description="Q Proxy deploy & panel manager")
    sub = parser.add_subparsers(dest="cmd")

    d = sub.add_parser("deploy", help="deploy a new Q Proxy panel (flag-driven; interactive when bare)")
    d.add_argument("--target", choices=["workers", "pages"], help="deploy target")
    d.add_argument("--name", help="panel/worker/project name (slugified)")
    d.add_argument("--kv", help="KV namespace title")
    d.add_argument("--d1", help="D1 database name")
    d.add_argument("--password", help="panel password (>=8, letter+digit)")
    d.add_argument("--token", help="Cloudflare API token (or CLOUDFLARE_API_TOKEN)")
    d.add_argument("--account", help="32-hex account id")
    d.add_argument("--subdomain", help="workers.dev subdomain when workers target")
    d.add_argument("--force", action="store_true", help="allow deploying over an existing worker/project name")
    d.set_defaults(func=do_deploy)

    l = sub.add_parser("list", help="list workers, pages, KV, D1")
    l.add_argument("--token", help="Cloudflare API token")
    l.add_argument("--account", help="32-hex account id")
    l.set_defaults(func=cmd_list)

    s = sub.add_parser("status", help="show live panels")
    s.add_argument("--token", help="Cloudflare API token")
    s.add_argument("--account", help="32-hex account id")
    s.set_defaults(func=cmd_status)

    rm = sub.add_parser("delete", help="delete a deployment/resource")
    rm.add_argument("--kind", required=True, choices=["worker", "page", "kv", "d1", "panel"])
    rm.add_argument("--name", required=True, help="name or id to delete")
    rm.add_argument("--token", help="Cloudflare API token")
    rm.add_argument("--account", help="32-hex account id")
    rm.add_argument("--yes", action="store_true", help="skip confirmation (non-interactive)")
    rm.set_defaults(func=cmd_delete)

    up = sub.add_parser("update", help="re-upload code onto an existing panel (keeps password+data)")
    up.add_argument("--name", help="existing panel name")
    up.add_argument("--target", choices=["workers", "pages"], help="must match the panel kind")
    up.add_argument("--token", help="Cloudflare API token")
    up.add_argument("--account", help="32-hex account id")
    up.set_defaults(func=cmd_update)

    urls = sub.add_parser("urls", help="reprint an existing panel's login/panel/sub URLs")
    urls.add_argument("--name", help="panel name")
    urls.add_argument("--token", help="Cloudflare API token")
    urls.add_argument("--account", help="32-hex account id")
    urls.set_defaults(func=cmd_urls)

    t = sub.add_parser("token", help="print the prefilled token URL")
    t.add_argument("--account", help="account id hint for the URL")
    t.set_defaults(func=cmd_token)

    mk = sub.add_parser("mk-token", help="mint a scoped API token (needs Global Key or admin token)")
    mk.add_argument("--key", help="Global Key (cfk_...)")
    mk.add_argument("--email", help="account email (for Global Key)")
    mk.add_argument("--token", help="existing admin bearer token")
    mk.add_argument("--account", help="32-hex account id to scope the token to")
    mk.add_argument("--name", default="Q Proxy deploy", help="token name")
    mk.add_argument("--days", type=int, default=30, help="token lifetime in days")
    mk.set_defaults(func=cmd_mk_token)

    args = parser.parse_args()
    # Bare `deploy.py` (no subcommand) = interactive main menu.
    if not args.cmd:
        if not is_tty():
            parser.print_help()
            raise SystemExit("\nNo command given and not interactive. Try `deploy.py deploy --help`.")
        interactive_menu()
        return
    args.func(args)


def interactive_menu():
    print("\n=== Q Proxy ===\n")
    # Token + account once per run: every action below reuses them, never re-prompts.
    sess = argparse.Namespace(token=None, account=None)
    tok = acquire_token(sess)
    os.environ["CLOUDFLARE_API_TOKEN"] = tok
    acct = resolve_account(tok, env_account() or None)
    os.environ["CLOUDFLARE_ACCOUNT_ID"] = acct
    print(f"  Session: account {acct} (token ****{tok[-4:]})\n")
    actions = {
        "new": ("New panel — deploy a fresh panel", lambda: do_deploy(argparse.Namespace(
            target=None, name=None, kv=None, d1=None, password=None,
            token=None, account=None, subdomain=None, func=do_deploy))),
        "update": ("Update panel — re-upload code (keeps password + data)", lambda: cmd_update(
            argparse.Namespace(name=None, target=None, token=None, account=None, func=cmd_update))),
        "delete": ("Delete — remove a panel or resource", menu_delete),
        "list": ("List — show workers, pages, KV, D1", lambda: cmd_list(
            argparse.Namespace(token=None, account=None, func=cmd_list))),
        "token": ("Get API token — prefilled creation link", lambda: cmd_token(
            argparse.Namespace(account=None, func=cmd_token))),
    }
    order = ["new", "update", "delete", "list", "token"]
    while True:
        labels = [actions[k][0] for k in order] + ["Exit"]
        choice = select_option("What do you want to do?", labels)
        if choice == "Exit":
            print("Bye.")
            return
        key = order[labels.index(choice)]
        try:
            actions[key][1]()
        except SystemExit as e:
            if e.code not in (None, 0):
                print(f"\n(!) {e}")
        except CfError as e:
            print(f"\n(!) Cloudflare error: {friendly_cf_error(e)}")
        except Exception as e:  # never let the menu die on a traceback
            print(f"\n(!) Unexpected error: {e}")
        pause()


def menu_delete():
    tok = os.environ.get("CLOUDFLARE_API_TOKEN", "")
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID", "")
    name = pick_existing_panel(account, tok)
    if name:
        cmd_delete(argparse.Namespace(kind="panel", name=name, token=tok,
                                      account=account, yes=False, func=None))


if __name__ == "__main__":
    main()
