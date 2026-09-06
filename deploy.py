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
    """Apply migrations. Tries single-statement posts (the stable shape);
    falls back to a joined exec if the API accepts it."""
    statements = [s.strip() for s in sql.split(";") if s.strip()]
    for s in statements:
        try:
            cf_request("POST", f"/accounts/{account}/d1/database/{db_id}/query",
                       token, {"sql": s})
        except CfError as e:
            msg = str(e)
            if "already exists" in msg.lower() or "duplicate" in msg.lower():
                continue
            print(f"  migration note ({str(e)[:90]})")
    return True


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


def set_first_password(base_url, secure_path, password):
    """Set the user-chosen password with NO bootstrap gate.
    setup() stamps bootstrap; an immediate same-password change() clears it.
    Returns True on success."""
    setup_url = f"{base_url}/{secure_path}/api/auth/setup"
    parsed, status, _ = post_json(setup_url, {"newPassword": password})
    if not parsed.get("ok"):
        code = (parsed.get("error") or {}).get("code")
        if code == "ALREADY_SET":
            return True
        if code == "SETUP_WINDOW_EXPIRED":
            return False
        raise CfError(status, [{"message": str(parsed.get("error", parsed))}])
    # clear bootstrap by changing to the same password (requires a session)
    login_url = f"{base_url}/{secure_path}/api/auth/login"
    _, _, set_cookie = post_json(login_url, {"password": password})
    cookie = ""
    if set_cookie:
        try:
            from http.cookies import SimpleCookie
            jar = SimpleCookie()
            jar.load(set_cookie)
            cookie = "; ".join(f"{k}={m.value}" for k, m in jar.items())
        except Exception:
            cookie = ""
    if not cookie:
        return True  # bootstrap set; user can change once (rare path)
    change_url = f"{base_url}/{secure_path}/api/auth/password"
    changed, _, _ = post_json(change_url, {"currentPassword": password, "newPassword": password}, cookie=cookie)
    return bool(changed.get("ok"))


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
# Interactive helpers
# --------------------------------------------------------------------------- #
def ask(prompt, default=None):
    if default is not None:
        prompt = f"{prompt} [{default}]: "
    else:
        prompt += ": "
    v = input(prompt).strip()
    return v or (default or "")


def ask_password():
    import getpass
    while True:
        pw = getpass.getpass("  Panel password (>=8 chars, letter+digit): ")
        if len(pw) >= 8 and re.search(r"[A-Za-z]", pw) and re.search(r"\d", pw):
            return pw
        print("  Password must be >=8 chars with at least one letter and one digit.")


# --------------------------------------------------------------------------- #
# Commands
# --------------------------------------------------------------------------- #
def cmd_token(args):
    print("\nOpen this URL in your browser to create a Cloudflare API token with the\n"
          "exact permissions Q Proxy needs (they are pre-filled):\n")
    print("  " + build_token_url(args.account or "*") + "\n")
    webbrowser.open(build_token_url(args.account or "*"))


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


def acquire_token(args):
    tok = os.environ.get("CLOUDFLARE_API_TOKEN")
    interactive = is_tty()
    if not tok:
        if interactive:
            tok = ask("Paste your Cloudflare API token (create at the URL above)", "")
        elif args.token:
            tok = args.token
    if not tok:
        raise SystemExit("No token provided. Set CLOUDFLARE_API_TOKEN, pass --token, or run interactively.")
    try:
        verify_token(tok)
    except CfError as e:
        if e.status in (401, 403):
            raise SystemExit(f"Token rejected: {e}")
    return tok.strip()


def resolve_account(tok, hint=None):
    """Return account id (str). Hint = --account flag or env var."""
    if hint:
        return hint
    try:
        accounts = cf_request("GET", "/accounts", tok)
        if accounts:
            if len(accounts) == 1:
                return accounts[0]["id"]
            if is_tty():
                print("Multiple accounts found:")
                for i, a in enumerate(accounts):
                    print(f"  {i + 1}. {a.get('name')} ({a['id']})")
                return accounts[int(input("  Account number [1]: ") or "1") - 1]["id"]
            raise CfError(0, [{"message": "Multiple accounts; pass --account <id>."}])
    except CfError:
        pass
    raise CfError(0, [{"message": "Could not resolve account. Provide --account <32-hex id>."}])


def do_deploy(args):
    print("\n=== Q Proxy deploy ===\n")
    interactive = is_tty()

    # 1. token
    print("Step 1/5 — Cloudflare access")
    tok = acquire_token(args)
    acct_id = resolve_account(tok, args.account or env_account())
    print(f"  Account: {acct_id}")

    # 2. target + naming (flag-driven: apply all args; interactive: prompt)
    print("\nStep 2/5 — Deployment target")
    if args.target:
        target = args.target
    elif interactive:
        target = ask("Deploy to (workers/pages)", "workers").lower()
        while target not in ("workers", "pages"):
            target = ask("Choose workers or pages", "workers").lower()
    else:
        raise SystemExit("No --target (workers|pages) given and not interactive.")

    if args.name:
        panel_name = args.name
    elif interactive:
        panel_name = ask("Panel name (used for worker/project name)", "q-proxy")
    else:
        raise SystemExit("No --name given and not interactive.")
    panel_name = slugify(panel_name)

    kv_title = prompt_or(args.kv, "KV namespace name", f"{panel_name}-QPROXY_KV", interactive)
    d1_name = prompt_or(args.d1, "D1 database name", f"{panel_name}", interactive)

    # 3. password (never silently default)
    print("\nStep 3/5 — Panel password (you choose it; no default gating)")
    password = args.password or (ask_password() if interactive else None)
    if not password:
        raise SystemExit("No --password given and not interactive. Password is required (>=8, letter+digit).")

    # 4. load artifact + create resources
    print("\nStep 4/5 — Provisioning resources on Cloudflare")
    kv = create_kv(acct_id, tok, kv_title)
    print(f"  KV: {kv['id']} ({kv_title})")
    d1 = create_d1(acct_id, tok, d1_name)
    print(f"  D1: {d1['uuid']} ({d1_name})")
    sql_path = Path(__file__).resolve().parent / "migrations" / "0001_init.sql"
    if sql_path.exists():
        apply_d1_migrations(acct_id, tok, d1["uuid"], sql_path.read_text())
        print("  D1 migrations applied")

    # 5. deploy
    print("\nStep 5/5 — Deploying")
    base_url = None
    if target == "workers":
        script, src = load_artifact("worker")
        print(f"  Using {src} ({len(script)} bytes)")
        upload_worker_real(acct_id, tok, panel_name, script, kv["id"], d1["uuid"])
        sub = enable_site_subdomain(acct_id, tok) or env_subdomain()
        enable_worker_route(acct_id, tok, panel_name)
        if not sub:
            if interactive:
                sub = ask("Workers subdomain (from dashboard, e.g. qhorror13194)", "")
            else:
                raise SystemExit("Could not determine workers subdomain. Pass --subdomain or re-run interactively.")
        base_url = f"https://{panel_name}.{sub}.workers.dev"
        print(f"  Worker uploaded: {base_url}")
    else:
        script, src = load_artifact("pages")
        print(f"  Using {src} ({len(script)} bytes)")
        create_pages_project(acct_id, tok, panel_name, kv["id"], d1["uuid"])
        deploy_pages(acct_id, tok, panel_name, script)
        # find project URL
        proj = None
        for p in list_pages_projects(acct_id, tok) or []:
            if p["name"] == panel_name:
                proj = p; break
        base_url = proj.get("url", f"https://{panel_name}.pages.dev") if proj else f"https://{panel_name}.pages.dev"
        print(f"  Pages project deployed: {base_url}")

    # 6. wait for seed, then set password
    print("\nWaiting for the panel to seed (KV eventual consistency)...")
    secure_path = wait_for_seed(acct_id, tok, kv["id"], base_url)
    print(f"  securePath: {secure_path}")
    if secure_path:
        ok = set_first_password(base_url, secure_path, password)
        if not ok:
            print("  ! Setup window expired / could not set password automatically;")
            print("    open the login page and use the first-visit setup card instead.")
        else:
            print("  Password set to your choice.")

    print("\n" + "=" * 60)
    print("  Q Proxy is live")
    print("=" * 60)
    print(f"  Worker/Page:  {base_url}")
    print(f"  Login:        {base_url}/{secure_path}/login")
    print(f"  Subscription: {base_url}/{secure_path}/sub")
    print(f"  Panel:        {base_url}/{secure_path}/panel")
    print(f"  securePath:   {secure_path}")
    print(f"  Password:     {password}")
    print("=" * 60)
    print("  Save the login URL + password — they are shown only here.\n")


def wait_for_seed(account, token, kv_id, base_url, timeout=240):
    """Poll KV for the seeded settings blob (KV propagation can take minutes).
    Also nudges the worker root to trigger a seed on first hit."""
    kv_path = f"/accounts/{account}/storage/kv/namespaces/{kv_id}/values/qproxy:settings"
    deadline = time.time() + timeout
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


def cmd_delete(args):
    tok = acquire_token(args)
    account = args.account or env_account()
    if not account:
        raise SystemExit("Provide --account <32-hex id>")
    if args.kind == "worker":
        cf_request("DELETE", f"/accounts/{account}/workers/scripts/{args.name}", tok)
        print(f"Deleted worker {args.name}")
    elif args.kind == "page":
        cf_request("DELETE", f"/accounts/{account}/pages/projects/{args.name}", tok)
        print(f"Deleted Pages project {args.name}")
    elif args.kind == "kv":
        # find id by title
        for ns in cf_request("GET", f"/accounts/{account}/storage/kv/namespaces", tok) or []:
            if ns["title"] == args.name or ns["id"] == args.name:
                cf_request("DELETE", f"/accounts/{account}/storage/kv/namespaces/{ns['id']}", tok)
                print(f"Deleted KV {ns['title']}")
                return
        print("KV not found")
    elif args.kind == "d1":
        for db in cf_request("GET", f"/accounts/{account}/d1/database", tok) or []:
            if db["name"] == args.name or db["uuid"] == args.name:
                cf_request("DELETE", f"/accounts/{account}/d1/database/{db['uuid']}", tok)
                print(f"Deleted D1 {db['name']}")
                return
        print("D1 not found")
    else:
        raise SystemExit("--kind must be worker|page|kv|d1")


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
    rm.add_argument("--kind", required=True, choices=["worker", "page", "kv", "d1"])
    rm.add_argument("--name", required=True, help="name or id to delete")
    rm.add_argument("--token", help="Cloudflare API token")
    rm.add_argument("--account", help="32-hex account id")
    rm.set_defaults(func=cmd_delete)

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
    # Bare `deploy.py` (no subcommand) = interactive deploy.
    if not args.cmd:
        ns = argparse.Namespace(target=None, name=None, kv=None, d1=None, password=None,
                               token=None, account=None, subdomain=None, func=do_deploy)
        ns.func(ns)
        return
    args.func(args)


if __name__ == "__main__":
    main()
