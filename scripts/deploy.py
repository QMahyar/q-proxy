#!/usr/bin/env python3
"""
Q Proxy — direct deploy via Cloudflare API (Python, no wrangler/node needed)
Usage:
  curl -fsSL https://raw.githubusercontent.com/QMahyar/q-proxy/main/scripts/deploy.py | python3 -
  python scripts/deploy.py --token <token> --email <email> --account-id <id>
  CLOUDFLARE_API_TOKEN=xxx python scripts/deploy.py
  CLOUDFLARE_API_KEY=cfk_xxx CLOUDFLARE_EMAIL=you@example.com CLOUDFLARE_ACCOUNT_ID=xxx python scripts/deploy.py

Requires: Python 3.8+, stdlib only (urllib, json, os)
"""

import os, sys, json, urllib.request, urllib.error, urllib.parse, time

WORKER_NAME = "q-proxy"
KV_TITLE = "q-proxy-QPROXY_KV"
KV_BINDING = "QPROXY_KV"
COMPAT_DATE = "2026-08-01"


def redact(t):
    return t[:4] + "***" + t[-4:] if len(t) > 8 else "***"


def is_global(token):
    return token.startswith("cfk_")


def headers(token, email, json_ct=True):
    h = {}
    if is_global(token):
        h["X-Auth-Email"] = email
        h["X-Auth-Key"] = token
    else:
        h["Authorization"] = f"Bearer {token}"
    if json_ct:
        h["Content-Type"] = "application/json"
    return h


def cf_api(url, token, email, method="GET", body=None, is_json=True):
    data = json.dumps(body).encode() if body and is_json else body
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers=headers(token, email, is_json=is_json and body is not None),
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            txt = r.read().decode()
            j = json.loads(txt) if txt else {}
            if not j.get("success", True):
                raise RuntimeError(j.get("errors", [{}])[0].get("message", txt[:500]))
            return j
    except urllib.error.HTTPError as e:
        txt = e.read().decode()[:800]
        try:
            j = json.loads(txt)
            raise RuntimeError(j.get("errors", [{}])[0].get("message", txt))
        except:
            raise RuntimeError(f"HTTP {e.code}: {txt}")


def get_script():
    import pathlib

    for p in ["dist/q-proxy.js", "dist/q-proxy.js", "q-proxy.js"]:
        if os.path.exists(p):
            print(f"Using local {p}")
            return open(p, encoding="utf-8").read()
    for url in [
        "https://github.com/QMahyar/q-proxy/releases/latest/download/q-proxy.js",
        "https://raw.githubusercontent.com/QMahyar/q-proxy/main/dist/q-proxy.js",
    ]:
        try:
            print(f"Trying {url} ...")
            with urllib.request.urlopen(url, timeout=10) as r:
                txt = r.read().decode()
                if len(txt) > 10000 and "export default" in txt:
                    print(f"Downloaded {len(txt)} bytes")
                    return txt
        except Exception as e:
            print(f"  failed: {e}")
    raise RuntimeError(
        "No worker script found. Run: npm run build  or download from Releases"
    )


def main():
    import argparse

    p = argparse.ArgumentParser(description="Q Proxy direct deploy (no wrangler)")
    p.add_argument(
        "--token",
        default=os.environ.get("CLOUDFLARE_API_TOKEN")
        or os.environ.get("CLOUDFLARE_API_KEY")
        or "",
    )
    p.add_argument("--email", default=os.environ.get("CLOUDFLARE_EMAIL") or "")
    p.add_argument(
        "--account-id", default=os.environ.get("CLOUDFLARE_ACCOUNT_ID") or ""
    )
    p.add_argument("--dry", action="store_true")
    args = p.parse_args()

    token = args.token.strip()
    if not token:
        print("No token in env. Create one at:")
        print(
            "  https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=%5B%7B%22key%22%3A%22workers_scripts%22%2C%22type%22%3A%22edit%22%7D%2C%7B%22key%22%3A%22workers_kv_storage%22%2C%22type%22%3A%22edit%22%7D%5D&name=Q%20Proxy"
        )
        token = input("Paste API Token or Global Key (cfk_...): ").strip()
    if not token:
        print("No token — abort")
        sys.exit(1)

    email = args.email.strip()
    if is_global(token) and not email:
        email = input("Cloudflare email (required for Global Key): ").strip()
        if not email:
            print("Email required")
            sys.exit(1)

    account_id = args.account_id.strip()
    if not account_id:
        try:
            j = cf_api("https://api.cloudflare.com/client/v4/accounts", token, email)
            accts = j.get("result", [])
            if len(accts) == 1:
                account_id = accts[0]["id"]
            elif len(accts) > 1:
                print("Multiple accounts:")
                for i, a in enumerate(accts):
                    print(f"  {i + 1}. {a['name']} — {a['id']}")
                idx = input("Pick number [1]: ").strip() or "1"
                account_id = accts[int(idx) - 1]["id"]
            print(f"Account ID: {account_id}")
        except Exception as e:
            print(f"Could not list accounts: {e}")
            account_id = input("Enter Account ID (32 hex): ").strip()

    print(f"Auth: {'Global Key' if is_global(token) else 'API Token'} {redact(token)}")
    if args.dry:
        print(f"[dry] Would create KV '{KV_TITLE}' and upload Worker '{WORKER_NAME}'")
        return

    # KV
    try:
        j = cf_api(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces",
            token,
            email,
        )
        existing = next(
            (
                ns
                for ns in j.get("result", [])
                if ns["title"] in (KV_TITLE, "QPROXY_KV", "q-proxy")
            ),
            None,
        )
        if existing:
            kv_id = existing["id"]
            print(f"KV exists: {existing['title']} → {kv_id}")
        else:
            raise KeyError
    except:
        print(f"Creating KV '{KV_TITLE}'...")
        j = cf_api(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces",
            token,
            email,
            method="POST",
            body={"title": KV_TITLE},
        )
        kv_id = j["result"]["id"]
        print(f"KV created: {kv_id}")

    script = get_script()
    print(
        f"Uploading Worker '{WORKER_NAME}' ({len(script) // 1024} KB) with KV {kv_id}..."
    )
    import io

    boundary = "----QProxyBoundary"
    meta = json.dumps(
        {
            "main_module": "q-proxy.js",
            "compatibility_date": COMPAT_DATE,
            "bindings": [
                {"type": "kv_namespace", "name": KV_BINDING, "namespace_id": kv_id}
            ],
        }
    )
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="metadata"\r\nContent-Type: application/json\r\n\r\n{meta}\r\n'
            f'--{boundary}\r\nContent-Disposition: form-data; name="q-proxy.js"; filename="q-proxy.js"\r\nContent-Type: application/javascript+module\r\n\r\n'
        ).encode()
        + script.encode()
        + f"\r\n--{boundary}--\r\n".encode()
    )
    req = urllib.request.Request(
        f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{WORKER_NAME}",
        data=body,
        method="PUT",
        headers={
            **headers(token, email, json_ct=False),
            "Content-Type": f"multipart/form-data; boundary={boundary}",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode()
        j = json.loads(txt)
        if not j.get("success"):
            raise RuntimeError(j.get("errors", [{}])[0].get("message", txt))
    print("Worker uploaded")

    # subdomain
    try:
        j = cf_api(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/subdomain",
            token,
            email,
        )
        sub = j.get("result", {}).get("subdomain")
    except:
        sub = None
    worker_url = (
        f"https://{WORKER_NAME}.{sub}.workers.dev"
        if sub
        else f"https://{WORKER_NAME}.workers.dev"
    )
    print(f"Worker URL: {worker_url}")

    print(f"Seeding {worker_url}/ ...")
    try:
        urllib.request.urlopen(worker_url + "/", timeout=8).read()
        print("Seed OK")
    except Exception as e:
        print(f"Seed warning: {e}")
    time.sleep(1.5)

    print("Reading securePath from KV...")
    try:
        req = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{kv_id}/values/qproxy:settings",
            headers=headers(token, email, json_ct=False),
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            j = json.loads(r.read().decode())
            sp = j.get("data", {}).get("securePath") or j.get("securePath") or ""
        if sp:
            print("=" * 62)
            print(
                f"  Panel: https://{WORKER_NAME}.{sub}.workers.dev/{sp}/panel"
                if sub
                else f"  Panel: {worker_url}/{sp}/panel"
            )
            print(f"  securePath: {sp}")
            print("=" * 62)
        else:
            print("Could not read securePath — check KV manually")
    except Exception as e:
        print(f"KV read failed: {e}")


if __name__ == "__main__":
    main()
