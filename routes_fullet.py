import base64
import hashlib
import hmac
import json
import os
import threading
import time
from datetime import datetime, timezone
from html import escape
import re
from urllib.parse import urlencode

from aiohttp import ClientSession, ClientTimeout, FormData, web

from .routes_favorites import normalize_fullet_post


MAX_AUTH_PENDING = 10
ALLOWED_UPLOAD_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
ALLOWED_UPLOAD_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
_IMAGE_MAGIC = {
    b"\x89PNG": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"RIFF": "image/webp",
    b"GIF8": "image/gif",
}
_POST_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")


BASE_DIR = os.path.dirname(__file__)
FULLET_BASE_URL = os.getenv("ANIMA_FULLET_BASE_URL", "https://fullet.lat").rstrip("/")
FULLET_PROMPTS_CACHE_TTL = int(os.getenv("ANIMA_FULLET_PROMPTS_CACHE_TTL", "120"))
FULLET_FAVORITES_CACHE_TTL = int(os.getenv("ANIMA_FULLET_FAVORITES_CACHE_TTL", "90"))
FULLET_AUTH_STATE_TTL = int(os.getenv("ANIMA_FULLET_AUTH_STATE_TTL", "300"))
FULLET_TOKEN_FILE = os.path.join(BASE_DIR, "data", "fullet_integration_token.json")
FULLET_LOCAL_TOKEN_HEADER = "x-anima-local-token"

_fullet_lock = threading.Lock()
_fullet_auth = {
    "token": "",
    "username": "",
    "expires_at": "",
    "updated_at": 0,
    "persistent": False,
}
_fullet_prompts_cache = {
    "key": "",
    "expires_at": 0,
    "payload": {"posts": [], "source": "fullet"},
}
_fullet_favorites_cache = {
    "key": "",
    "expires_at": 0,
    "payload": {"posts": [], "source": "fullet", "connected": False},
}
_fullet_auth_pending = {}
_local_api_token = base64.urlsafe_b64encode(os.urandom(24)).decode("utf-8").rstrip("=")


def _safe_json_load(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _safe_json_save(path, data):
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f" [AnimaStyleExplorer] Failed to persist integration token: {e}")


def _safe_json_delete(path):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f" [AnimaStyleExplorer] Failed to clear integration token: {e}")


def _decode_jwt_payload(token):
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8")).decode("utf-8")
        return json.loads(decoded)
    except Exception:
        return {}


def _token_expired(expires_at):
    if not expires_at:
        return False
    try:
        normalized = expires_at.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt <= datetime.now(timezone.utc)
    except Exception:
        return True


def _normalize_expires_at(token, expires_at=""):
    if expires_at:
        return str(expires_at)
    payload = _decode_jwt_payload(token)
    exp = payload.get("exp")
    if not exp:
        return ""
    try:
        return datetime.fromtimestamp(int(exp), tz=timezone.utc).isoformat()
    except Exception:
        return ""


def _b64url(data):
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _is_private_ipv4(host):
    try:
        parts = [int(x) for x in str(host or "").split(".")]
    except Exception:
        return False
    if len(parts) != 4 or any(p < 0 or p > 255 for p in parts):
        return False
    if parts[0] == 10:
        return True
    if parts[0] == 192 and parts[1] == 168:
        return True
    if parts[0] == 172 and 16 <= parts[1] <= 31:
        return True
    return False


def _normalize_origin_hint(value):
    raw = str(value or "").strip()
    if not raw:
        return ""

    try:
        from urllib.parse import urlparse

        parsed = urlparse(raw)
        if parsed.scheme not in ("http", "https"):
            return ""
        if parsed.path not in ("", "/"):
            return ""
        if parsed.params or parsed.query or parsed.fragment:
            return ""

        host = str(parsed.hostname or "").strip().lower()
        if not host:
            return ""

        loopback = host in ("localhost", "127.0.0.1", "::1")
        if not loopback and not _is_private_ipv4(host):
            return ""

        port = parsed.port
        if port is None:
            return ""
        if not (1 <= int(port) <= 65535):
            return ""

        return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return ""


def _resolve_request_origin(request):
    origin_hint = _normalize_origin_hint(request.query.get("origin"))
    if origin_hint:
        return origin_hint

    forwarded_host = str(request.headers.get("x-forwarded-host") or "").split(",")[0].strip()
    forwarded_proto = str(request.headers.get("x-forwarded-proto") or "").split(",")[0].strip()
    if forwarded_host:
        scheme = forwarded_proto or request.scheme or "http"
        return f"{scheme}://{forwarded_host}"
    return f"{request.scheme}://{request.host}"


def _new_pkce_pair():
    verifier = _b64url(os.urandom(48))
    challenge = _b64url(hashlib.sha256(verifier.encode("utf-8")).digest())
    return verifier, challenge


def _cleanup_auth_pending_locked(now=None):
    now_ts = int(now or time.time())
    stale = [key for key, item in _fullet_auth_pending.items() if int(item.get("expires_at") or 0) <= now_ts]
    for key in stale:
        _fullet_auth_pending.pop(key, None)


def _create_auth_start_payload(request):
    origin = _resolve_request_origin(request)
    redirect_uri = f"{origin}/anima/auth_callback"
    state = _b64url(os.urandom(24))
    verifier, challenge = _new_pkce_pair()

    ttl = max(90, min(FULLET_AUTH_STATE_TTL, 900))
    expires_at = int(time.time()) + ttl

    with _fullet_lock:
        _cleanup_auth_pending_locked()
        if len(_fullet_auth_pending) >= MAX_AUTH_PENDING:
            oldest = min(_fullet_auth_pending, key=lambda k: int(_fullet_auth_pending[k].get("created_at") or 0))
            _fullet_auth_pending.pop(oldest, None)
        _fullet_auth_pending[state] = {
            "verifier": verifier,
            "redirect_uri": redirect_uri,
            "expires_at": expires_at,
            "created_at": int(time.time()),
        }

    query = urlencode({
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })

    return {
        "url": f"{FULLET_BASE_URL}/connect/anima?{query}",
        "redirectUri": redirect_uri,
        "expiresAt": datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
    }


def _consume_pending_auth_state(state):
    key = str(state or "").strip()
    if not key:
        return None

    with _fullet_lock:
        _cleanup_auth_pending_locked()
        return _fullet_auth_pending.pop(key, None)


def _has_valid_local_token(request):
    provided = str(request.headers.get(FULLET_LOCAL_TOKEN_HEADER) or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(provided, _local_api_token)


def require_local_token(request):
    if _has_valid_local_token(request):
        return None
    return web.json_response({"error": "Invalid local request token"}, status=403)


async def _exchange_fullet_auth_code(code, state, pending):
    payload = {
        "code": str(code or "").strip(),
        "state": str(state or "").strip(),
        "codeVerifier": str(pending.get("verifier") or "").strip(),
        "redirectUri": str(pending.get("redirect_uri") or "").strip(),
    }

    if not payload["code"] or not payload["state"] or not payload["codeVerifier"] or not payload["redirectUri"]:
        return {
            "ok": False,
            "error": "Missing exchange payload values",
        }

    url = f"{FULLET_BASE_URL}/api/integrations/anima/token/exchange"
    timeout = ClientTimeout(total=18)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                text = await resp.text()
                try:
                    data = json.loads(text) if text else {}
                except Exception:
                    data = {}

                if resp.status >= 400:
                    return {
                        "ok": False,
                        "error": str(data.get("error") or f"Upstream exchange failed ({resp.status})"),
                    }

                token = str(data.get("token") or "").strip()
                if not token:
                    return {
                        "ok": False,
                        "error": "Exchange succeeded but token missing",
                    }

                return {
                    "ok": True,
                    "token": token,
                    "username": str(data.get("username") or "").strip(),
                    "expiresAt": str(data.get("expiresAt") or "").strip(),
                }
    except Exception:
        return {
            "ok": False,
            "error": "Exchange request failed",
        }


def _serialize_fullet_auth(state=None):
    source = state if isinstance(state, dict) else _fullet_auth
    return {
        "token": str(source.get("token") or ""),
        "username": str(source.get("username") or ""),
        "expires_at": str(source.get("expires_at") or ""),
        "updated_at": int(source.get("updated_at") or 0),
        "persistent": bool(source.get("persistent")),
    }


def _persist_fullet_auth_locked():
    state = _serialize_fullet_auth()
    if state.get("persistent"):
        _safe_json_save(FULLET_TOKEN_FILE, state)
    else:
        _safe_json_delete(FULLET_TOKEN_FILE)


def _set_fullet_token(token, username="", expires_at="", persistent=None):
    if not token:
        return
    expires = _normalize_expires_at(token, expires_at)
    with _fullet_lock:
        keep = bool(_fullet_auth.get("persistent")) if persistent is None else bool(persistent)
        _fullet_auth.update({
            "token": token,
            "username": str(username or ""),
            "expires_at": expires,
            "updated_at": int(time.time()),
            "persistent": keep,
        })
        _persist_fullet_auth_locked()


def _set_fullet_session_persistent(enabled):
    with _fullet_lock:
        _fullet_auth["persistent"] = bool(enabled)
        _persist_fullet_auth_locked()
    return _serialize_fullet_auth()


def _clear_fullet_token():
    with _fullet_lock:
        persistent = bool(_fullet_auth.get("persistent"))
        _fullet_auth.update({
            "token": "",
            "username": "",
            "expires_at": "",
            "updated_at": int(time.time()),
            "persistent": persistent,
        })
        _persist_fullet_auth_locked()


def load_fullet_token():
    data = _safe_json_load(FULLET_TOKEN_FILE)
    persistent = bool(data.get("persistent"))

    with _fullet_lock:
        _fullet_auth["persistent"] = persistent

    token = str(data.get("token") or "").strip()
    if not persistent:
        if data:
            _safe_json_delete(FULLET_TOKEN_FILE)
        return
    if not token:
        return

    _set_fullet_token(
        token=token,
        username=str(data.get("username") or ""),
        expires_at=str(data.get("expires_at") or ""),
        persistent=True,
    )


def _get_fullet_auth_status(include_local_token=False):
    with _fullet_lock:
        state = dict(_fullet_auth)

    if state.get("token") and _token_expired(state.get("expires_at", "")):
        _clear_fullet_token()
        result = {
            "connected": False,
            "username": "",
            "expiresAt": "",
            "updatedAt": int(time.time()),
            "persistent": bool(state.get("persistent")),
        }
        if include_local_token:
            result["localToken"] = _local_api_token
        return result

    result = {
        "connected": bool(state.get("token")),
        "username": state.get("username", ""),
        "expiresAt": state.get("expires_at", ""),
        "updatedAt": int(state.get("updated_at") or 0),
        "persistent": bool(state.get("persistent")),
    }
    if include_local_token:
        result["localToken"] = _local_api_token
    return result


async def _fetch_fullet_prompts(limit, offset):
    query = urlencode({"limit": limit, "offset": offset})
    url = f"{FULLET_BASE_URL}/api/integrations/anima-prompts?{query}"
    timeout = ClientTimeout(total=12)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                text = await resp.text()
                payload = {}
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {}

                if resp.status >= 400:
                    return {
                        "posts": [],
                        "error": f"Upstream error ({resp.status})",
                        "source": "fullet",
                    }

                raw_posts = payload.get("posts") if isinstance(payload, dict) else []
                posts = []
                if isinstance(raw_posts, list):
                    for item in raw_posts:
                        normalized = normalize_fullet_post(item)
                        if normalized:
                            posts.append(normalized)

                return {
                    "posts": posts,
                    "source": "fullet",
                }
    except Exception:
        return {
            "posts": [],
            "error": "Unable to fetch prompts",
            "source": "fullet",
        }


async def _fetch_fullet_favorites(limit, offset):
    with _fullet_lock:
        token = str(_fullet_auth.get("token") or "").strip()

    if not token:
        return {
            "posts": [],
            "source": "fullet",
            "connected": False,
        }

    query = urlencode({"limit": limit, "offset": offset})
    url = f"{FULLET_BASE_URL}/api/integrations/anima/favorites?{query}"
    timeout = ClientTimeout(total=12)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url, headers={"Authorization": f"Bearer {token}"}) as resp:
                text = await resp.text()
                payload = {}
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {}

                if resp.status in (401, 403):
                    _clear_fullet_token()

                if resp.status >= 400:
                    return {
                        "posts": [],
                        "error": str(payload.get("error") or f"Upstream error ({resp.status})"),
                        "source": "fullet",
                        "connected": False,
                    }

                raw_posts = payload.get("posts") if isinstance(payload, dict) else []
                posts = []
                if isinstance(raw_posts, list):
                    for item in raw_posts:
                        normalized = normalize_fullet_post(item)
                        if normalized:
                            posts.append(normalized)

                return {
                    "posts": posts,
                    "source": "fullet",
                    "connected": True,
                }
    except Exception:
        return {
            "posts": [],
            "error": "Unable to fetch favorites",
            "source": "fullet",
            "connected": bool(token),
        }


async def _set_fullet_favorite(post_id, favorited=None):
    with _fullet_lock:
        token = str(_fullet_auth.get("token") or "").strip()

    if not token:
        return {
            "status": 401,
            "payload": {"error": "Not connected to Fullet"},
        }

    target_id = str(post_id or "").strip()
    if not target_id:
        return {
            "status": 400,
            "payload": {"error": "Missing postId"},
        }

    if not _POST_ID_RE.match(target_id):
        return {
            "status": 400,
            "payload": {"error": "Invalid postId format"},
        }

    body = {"postId": target_id}
    if isinstance(favorited, bool):
        body["favorited"] = favorited

    url = f"{FULLET_BASE_URL}/api/integrations/anima/favorites"
    timeout = ClientTimeout(total=18)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=body, headers={"Authorization": f"Bearer {token}"}) as resp:
                text = await resp.text()
                payload = {}
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {"error": text or "Unknown upstream response"}

                if resp.status in (401, 403):
                    _clear_fullet_token()

                return {
                    "status": resp.status,
                    "payload": payload,
                }
    except Exception:
        return {
            "status": 502,
            "payload": {"error": "Unable to update favorite"},
        }


def register_fullet_routes(server):
    @server.instance.routes.get("/anima/fullet_prompts")
    async def get_fullet_prompts(request):
        try:
            limit = int(request.query.get("limit", "24"))
        except Exception:
            limit = 24
        try:
            offset = int(request.query.get("offset", "0"))
        except Exception:
            offset = 0

        limit = max(1, min(limit, 48))
        offset = max(0, min(offset, 5000))
        force_refresh = str(request.query.get("force", "")).strip().lower() in ("1", "true", "yes", "on")
        key = f"{limit}:{offset}"

        now = int(time.time())
        if not force_refresh:
            with _fullet_lock:
                if (
                    _fullet_prompts_cache.get("key") == key
                    and int(_fullet_prompts_cache.get("expires_at") or 0) > now
                ):
                    return web.json_response(_fullet_prompts_cache.get("payload") or {"posts": [], "source": "fullet"})

        payload = await _fetch_fullet_prompts(limit, offset)

        with _fullet_lock:
            _fullet_prompts_cache.update({
                "key": key,
                "expires_at": now + max(10, FULLET_PROMPTS_CACHE_TTL),
                "payload": payload,
            })

        return web.json_response(payload)


    @server.instance.routes.get("/anima/fullet_favorites")
    async def get_fullet_favorites(request):
        try:
            limit = int(request.query.get("limit", "48"))
        except Exception:
            limit = 48
        try:
            offset = int(request.query.get("offset", "0"))
        except Exception:
            offset = 0

        limit = max(1, min(limit, 96))
        offset = max(0, min(offset, 5000))

        auth = _get_fullet_auth_status()
        if not auth.get("connected"):
            return web.json_response({"posts": [], "source": "fullet", "connected": False})

        key = f"{auth.get('username', '')}:{limit}:{offset}"
        now = int(time.time())
        with _fullet_lock:
            if (
                _fullet_favorites_cache.get("key") == key
                and int(_fullet_favorites_cache.get("expires_at") or 0) > now
            ):
                return web.json_response(_fullet_favorites_cache.get("payload") or {"posts": [], "source": "fullet", "connected": True})

        payload = await _fetch_fullet_favorites(limit, offset)

        with _fullet_lock:
            _fullet_favorites_cache.update({
                "key": key,
                "expires_at": now + max(10, FULLET_FAVORITES_CACHE_TTL),
                "payload": payload,
            })

        return web.json_response(payload)

    @server.instance.routes.post("/anima/fullet_favorite")
    async def set_fullet_favorite(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        try:
            body = await request.json()
        except Exception:
            body = {}

        if not isinstance(body, dict):
            body = {}

        post_id = str(body.get("postId") or "").strip()
        if not post_id:
            return web.json_response({"error": "Missing postId"}, status=400)

        favorited = body.get("favorited")
        if not isinstance(favorited, bool):
            favorited = None

        result = await _set_fullet_favorite(post_id, favorited)
        status = int(result.get("status") or 500)
        payload = result.get("payload") if isinstance(result.get("payload"), dict) else {}

        if status < 400:
            with _fullet_lock:
                _fullet_favorites_cache.update({
                    "key": "",
                    "expires_at": 0,
                    "payload": {"posts": [], "source": "fullet", "connected": True},
                })

        return web.json_response(payload, status=status)

    @server.instance.routes.get("/anima/fullet_auth_start")
    async def fullet_auth_start(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        try:
            payload = _create_auth_start_payload(request)
            return web.json_response(payload)
        except Exception as e:
            print(f" [AnimaStyleExplorer] Auth start error: {e}")
            return web.json_response({"error": "Unable to start auth flow"}, status=500)

    @server.instance.routes.get("/anima/fullet_auth_status")
    async def fullet_auth_status(request):
        has_token = _has_valid_local_token(request)
        return web.json_response(_get_fullet_auth_status(include_local_token=has_token))

    @server.instance.routes.get("/anima/fullet_local_token")
    async def fullet_local_token(request):
        return web.json_response({"localToken": _local_api_token})
    @server.instance.routes.post("/anima/fullet_session_mode")
    async def fullet_session_mode(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        try:
            body = await request.json()
        except Exception:
            body = {}

        if not isinstance(body, dict):
            body = {}

        persistent = bool(body.get("persistent"))
        _set_fullet_session_persistent(persistent)
        return web.json_response(_get_fullet_auth_status())

    @server.instance.routes.post("/anima/fullet_disconnect")
    async def fullet_disconnect(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        _clear_fullet_token()
        return web.json_response({"success": True})

    @server.instance.routes.get("/anima/auth_callback")
    async def fullet_auth_callback(request):
        title = "Connection failed"
        body = "Missing auth code. Please retry from the node."

        code = str(request.query.get("code") or "").strip()
        state = str(request.query.get("state") or "").strip()

        pending = _consume_pending_auth_state(state)
        if not code or not state:
            title = "Connection failed"
            body = "Missing auth parameters. Start the connect flow again from the node."
        elif not pending:
            title = "Connection expired"
            body = "The auth request is no longer valid. Please reconnect from the node and try again."
        else:
            result = await _exchange_fullet_auth_code(code=code, state=state, pending=pending)
            if result.get("ok"):
                _set_fullet_token(
                    token=result.get("token", ""),
                    username=result.get("username", ""),
                    expires_at=result.get("expiresAt", ""),
                )
                title = "Connected"
                body = "Fullet account connected successfully. You can close this tab and go back to ComfyUI."
            else:
                title = "Connection failed"
                body = str(result.get("error") or "Could not complete secure token exchange.")

        html = f"""
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>{escape(title)}</title>
  <style>
    body {{ font-family: Arial, sans-serif; background:#0f1424; color:#e8edff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }}
    .card {{ width:min(560px,92vw); border:1px solid #2e3a66; border-radius:14px; background:#10182e; padding:22px; box-shadow:0 20px 60px rgba(0,0,0,.35); }}
    h1 {{ margin:0 0 8px; font-size:22px; }}
    p {{ margin:0; color:#b9c7ff; line-height:1.45; }}
    .hint {{ margin-top:12px; color:#90a4ff; font-size:13px; }}
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>{escape(title)}</h1>
    <p>{escape(body)}</p>
    <p class=\"hint\">This window can be closed safely.</p>
  </div>
  <script>
    setTimeout(function() {{ try {{ window.close(); }} catch (e) {{}} }}, 1500);
  </script>
</body>
</html>
"""
        return web.Response(text=html, content_type="text/html")

    @server.instance.routes.post("/anima/fullet_upload")
    async def fullet_upload(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        auth = _get_fullet_auth_status()
        if not auth.get("connected"):
            return web.json_response({"error": "Not connected to Fullet"}, status=401)

        with _fullet_lock:
            token = _fullet_auth.get("token")

        reader = await request.multipart()
        file_bytes = None
        filename = "upload.png"
        content_type = "image/png"
        prompt = ""
        negative_prompt = ""
        model = "anima"
        manual_nsfw = ""
        preserve_metadata = ""
        settings_json = ""

        async for part in reader:
            if part.name == "file":
                file_bytes = await part.read(decode=False)
                filename = part.filename or filename
                content_type = part.headers.get("Content-Type", content_type)
            elif part.name == "prompt":
                prompt = (await part.text()).strip()
            elif part.name == "negativePrompt":
                negative_prompt = (await part.text()).strip()
            elif part.name == "model":
                model = (await part.text()).strip() or "anima"
            elif part.name == "manualNsfw":
                manual_nsfw = (await part.text()).strip()
            elif part.name == "preserveMetadata":
                preserve_metadata = (await part.text()).strip()
            elif part.name == "settings":
                settings_json = (await part.text()).strip()

        if not file_bytes:
            return web.json_response({"error": "No file provided"}, status=400)
        if not prompt:
            return web.json_response({"error": "Prompt is required"}, status=400)
        if len(file_bytes) > (12 * 1024 * 1024):
            return web.json_response({"error": "Image too large"}, status=400)

        # Validate file type by content-type whitelist
        if content_type not in ALLOWED_UPLOAD_TYPES:
            return web.json_response({"error": f"Unsupported file type: {content_type}"}, status=400)

        # Validate file extension
        ext = os.path.splitext(filename)[1].lower() if filename else ""
        if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
            return web.json_response({"error": f"Unsupported file extension: {ext}"}, status=400)

        # Validate magic bytes
        detected = None
        for magic, mime in _IMAGE_MAGIC.items():
            if file_bytes[:len(magic)] == magic:
                detected = mime
                break
        if not detected:
            return web.json_response({"error": "File does not appear to be a valid image"}, status=400)

        form = FormData()
        form.add_field("file", file_bytes, filename=filename, content_type=content_type)
        form.add_field("prompt", prompt)
        form.add_field("negativePrompt", negative_prompt)
        form.add_field("model", model)
        if manual_nsfw:
            form.add_field("manualNsfw", manual_nsfw)
        if preserve_metadata:
            form.add_field("preserveMetadata", preserve_metadata)
        if settings_json:
            form.add_field("settings", settings_json)

        url = f"{FULLET_BASE_URL}/api/integrations/anima/upload"
        timeout = ClientTimeout(total=45)

        try:
            async with ClientSession(timeout=timeout) as session:
                async with session.post(url, data=form, headers={"Authorization": f"Bearer {token}"}) as resp:
                    text = await resp.text()
                    try:
                        payload = json.loads(text) if text else {}
                    except Exception:
                        payload = {"error": text or "Unknown upstream response"}

                    if resp.status in (401, 403):
                        _clear_fullet_token()

                    return web.json_response(payload, status=resp.status)
        except Exception as e:
            print(f" [AnimaStyleExplorer] Upload proxy error: {e}")
            return web.json_response({"error": "Upload failed"}, status=500)







