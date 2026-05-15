import base64
import hmac
import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from html import escape
from urllib.parse import urlencode

from aiohttp import ClientSession, ClientTimeout, FormData, web

from .routes_favorites import normalize_fullet_post

ALLOWED_UPLOAD_TYPES = {"image/png", "image/jpeg", "image/webp"}
ALLOWED_UPLOAD_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}
MAX_FULLET_UPLOAD_ITEMS = 20
_IMAGE_MAGIC = {
    b"\x89PNG": "image/png",
    b"\xff\xd8\xff": "image/jpeg",
    b"RIFF": "image/webp",
}
_POST_ID_RE = re.compile(r"^[a-zA-Z0-9_\-]{1,128}$")

BASE_DIR = os.path.dirname(__file__)
FULLET_BASE_URL = os.getenv("ANIMA_FULLET_BASE_URL", "https://fullet.lat").rstrip("/")
FULLET_PROMPTS_CACHE_TTL = int(os.getenv("ANIMA_FULLET_PROMPTS_CACHE_TTL", "120"))
FULLET_FAVORITES_CACHE_TTL = int(os.getenv("ANIMA_FULLET_FAVORITES_CACHE_TTL", "90"))
FULLET_TOKEN_FILE = os.path.join(BASE_DIR, "data", "fullet_integration_token.json")
FULLET_LOCAL_TOKEN_HEADER = "x-anima-local-token"
FULLET_CLIENT_HEADERS = {
    "Accept": "application/json",
    "User-Agent": "ComfyUI-AnimaStyleExplorer/1.0 (+https://fullet.lat)",
}
FULLET_CLOUDFLARE_ERROR = (
    "Cloudflare is challenging the Fullet API. Add a Skip/Allow rule for "
    "/api/integrations/anima* and /api/media* so ComfyUI can load prompts."
)

_fullet_lock = threading.Lock()
_fullet_auth = {
    "api_key": "",
    "username": "",
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
_local_api_token = base64.urlsafe_b64encode(os.urandom(24)).decode("utf-8").rstrip("=")


def _fullet_headers(extra=None):
    headers = dict(FULLET_CLIENT_HEADERS)
    if isinstance(extra, dict):
        headers.update(extra)
    return headers


def _is_cloudflare_challenge(resp, text=""):
    mitigated = str(resp.headers.get("cf-mitigated") or "").lower()
    if mitigated == "challenge":
        return True

    lower_text = str(text or "").lower()
    return (
        resp.status in (403, 503)
        and (
            "just a moment" in lower_text
            or "enable javascript and cookies" in lower_text
            or "/cdn-cgi/challenge-platform/" in lower_text
        )
    )


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
        print(f" [AnimaStyleExplorer] Failed to persist API key: {e}")


def _safe_json_delete(path):
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception as e:
        print(f" [AnimaStyleExplorer] Failed to clear API key: {e}")


def _serialize_fullet_auth(state=None):
    source = state if isinstance(state, dict) else _fullet_auth
    return {
        "api_key": str(source.get("api_key") or ""),
        "username": str(source.get("username") or ""),
        "updated_at": int(source.get("updated_at") or 0),
        "persistent": bool(source.get("persistent")),
    }


def _persist_fullet_auth_locked():
    state = _serialize_fullet_auth()
    if state.get("persistent") and state.get("api_key"):
        _safe_json_save(FULLET_TOKEN_FILE, state)
    else:
        _safe_json_delete(FULLET_TOKEN_FILE)


def _set_fullet_api_key(api_key, username="", persistent=None):
    raw = str(api_key or "").strip()
    if not raw:
        return
    with _fullet_lock:
        keep = bool(_fullet_auth.get("persistent")) if persistent is None else bool(persistent)
        _fullet_auth.update({
            "api_key": raw,
            "username": str(username or "").strip(),
            "updated_at": int(time.time()),
            "persistent": keep,
        })
        _persist_fullet_auth_locked()


def _set_fullet_session_persistent(enabled):
    with _fullet_lock:
        _fullet_auth["persistent"] = bool(enabled)
        _persist_fullet_auth_locked()
    return _serialize_fullet_auth()


def _clear_fullet_api_key():
    with _fullet_lock:
        persistent = bool(_fullet_auth.get("persistent"))
        _fullet_auth.update({
            "api_key": "",
            "username": "",
            "updated_at": int(time.time()),
            "persistent": persistent,
        })
        _persist_fullet_auth_locked()


def load_fullet_token():
    data = _safe_json_load(FULLET_TOKEN_FILE)
    persistent = bool(data.get("persistent"))
    api_key = str(data.get("api_key") or "").strip()

    with _fullet_lock:
        _fullet_auth["persistent"] = persistent

    if not persistent:
        if data:
            _safe_json_delete(FULLET_TOKEN_FILE)
        return
    if not api_key:
        return

    _set_fullet_api_key(
        api_key=api_key,
        username=str(data.get("username") or ""),
        persistent=True,
    )


def _get_fullet_auth_status(include_local_token=False):
    with _fullet_lock:
        state = dict(_fullet_auth)

    result = {
        "connected": bool(state.get("api_key")),
        "username": state.get("username", ""),
        "updatedAt": int(state.get("updated_at") or 0),
        "persistent": bool(state.get("persistent")),
    }
    if include_local_token:
        result["localToken"] = _local_api_token
    return result


def _auth_headers():
    with _fullet_lock:
        api_key = str(_fullet_auth.get("api_key") or "").strip()
    return {"Authorization": f"Bearer {api_key}"} if api_key else {}


def _has_valid_local_token(request):
    provided = str(request.headers.get(FULLET_LOCAL_TOKEN_HEADER) or "").strip()
    if not provided:
        return False
    return hmac.compare_digest(provided, _local_api_token)


def require_local_token(request):
    if _has_valid_local_token(request):
        return None
    return web.json_response({"error": "Invalid local request token"}, status=403)


async def _fetch_fullet_me(api_key):
    raw = str(api_key or "").strip()
    if not raw:
        return {"ok": False, "error": "Missing API key"}

    url = f"{FULLET_BASE_URL}/api/integrations/anima/me"
    timeout = ClientTimeout(total=12)
    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=_fullet_headers({"Authorization": f"Bearer {raw}"})) as resp:
                text = await resp.text()
                try:
                    data = json.loads(text) if text else {}
                except Exception:
                    data = {}

                if _is_cloudflare_challenge(resp, text):
                    return {"ok": False, "error": FULLET_CLOUDFLARE_ERROR}

                if resp.status >= 400:
                    return {"ok": False, "error": str(data.get("error") or f"Validation failed ({resp.status})")}

                username = str(data.get("username") or "").strip()
                if not username:
                    return {"ok": False, "error": "API key validation did not return a username"}
                return {"ok": True, "username": username, "authType": str(data.get("authType") or "")}
    except Exception:
        return {"ok": False, "error": "Could not validate API key"}


async def _fetch_fullet_prompts(limit, offset):
    query = urlencode({"limit": limit, "offset": offset})
    url = f"{FULLET_BASE_URL}/api/integrations/anima-prompts?{query}"
    timeout = ClientTimeout(total=12)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=_fullet_headers()) as resp:
                text = await resp.text()
                payload = {}
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {}

                if _is_cloudflare_challenge(resp, text):
                    return {
                        "posts": [],
                        "error": FULLET_CLOUDFLARE_ERROR,
                        "source": "fullet",
                        "blockedByCloudflare": True,
                    }

                if resp.status >= 400:
                    return {"posts": [], "error": f"Upstream error ({resp.status})", "source": "fullet"}

                raw_posts = payload.get("posts") if isinstance(payload, dict) else []
                posts = []
                if isinstance(raw_posts, list):
                    for item in raw_posts:
                        normalized = normalize_fullet_post(item)
                        if normalized:
                            posts.append(normalized)

                return {"posts": posts, "source": "fullet"}
    except Exception:
        return {"posts": [], "error": "Unable to fetch prompts", "source": "fullet"}


async def _fetch_fullet_favorites(limit, offset):
    headers = _auth_headers()
    if not headers:
        return {"posts": [], "source": "fullet", "connected": False}

    query = urlencode({"limit": limit, "offset": offset})
    url = f"{FULLET_BASE_URL}/api/integrations/anima/favorites?{query}"
    timeout = ClientTimeout(total=12)

    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.get(url, headers=_fullet_headers(headers)) as resp:
                text = await resp.text()
                payload = {}
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {}

                if _is_cloudflare_challenge(resp, text):
                    return {
                        "posts": [],
                        "error": FULLET_CLOUDFLARE_ERROR,
                        "source": "fullet",
                        "connected": True,
                        "blockedByCloudflare": True,
                    }

                if resp.status in (401, 403):
                    _clear_fullet_api_key()

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

                return {"posts": posts, "source": "fullet", "connected": True}
    except Exception:
        return {"posts": [], "error": "Unable to fetch favorites", "source": "fullet", "connected": True}


async def _set_fullet_favorite(post_id, favorited=None):
    headers = _auth_headers()
    if not headers:
        return {"status": 401, "payload": {"error": "Not connected to Fullet"}}

    target_id = str(post_id or "").strip()
    if not target_id:
        return {"status": 400, "payload": {"error": "Missing postId"}}
    if not _POST_ID_RE.match(target_id):
        return {"status": 400, "payload": {"error": "Invalid postId format"}}

    body = {"postId": target_id}
    if isinstance(favorited, bool):
        body["favorited"] = favorited

    url = f"{FULLET_BASE_URL}/api/integrations/anima/favorites"
    timeout = ClientTimeout(total=18)
    try:
        async with ClientSession(timeout=timeout) as session:
            async with session.post(url, json=body, headers=_fullet_headers(headers)) as resp:
                text = await resp.text()
                try:
                    payload = json.loads(text) if text else {}
                except Exception:
                    payload = {"error": text or "Unknown upstream response"}

                if _is_cloudflare_challenge(resp, text):
                    return {
                        "status": 403,
                        "payload": {
                            "error": FULLET_CLOUDFLARE_ERROR,
                            "blockedByCloudflare": True,
                        },
                    }

                if resp.status in (401, 403):
                    _clear_fullet_api_key()

                return {"status": resp.status, "payload": payload}
    except Exception:
        return {"status": 502, "payload": {"error": "Unable to update favorite"}}


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
                if _fullet_prompts_cache.get("key") == key and int(_fullet_prompts_cache.get("expires_at") or 0) > now:
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

        limit = max(1, min(limit, 48))
        offset = max(0, min(offset, 5000))

        auth = _get_fullet_auth_status()
        if not auth.get("connected"):
            return web.json_response({"posts": [], "source": "fullet", "connected": False})

        key = f"{auth.get('username', '')}:{limit}:{offset}"
        now = int(time.time())
        with _fullet_lock:
            if _fullet_favorites_cache.get("key") == key and int(_fullet_favorites_cache.get("expires_at") or 0) > now:
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
                _fullet_favorites_cache.update({"key": "", "expires_at": 0, "payload": {"posts": [], "source": "fullet", "connected": True}})
        return web.json_response(payload, status=status)

    @server.instance.routes.get("/anima/fullet_auth_status")
    async def fullet_auth_status(request):
        has_token = _has_valid_local_token(request)
        return web.json_response(_get_fullet_auth_status(include_local_token=has_token))

    @server.instance.routes.get("/anima/fullet_local_token")
    async def fullet_local_token(request):
        return web.json_response({"localToken": _local_api_token})

    @server.instance.routes.post("/anima/fullet_api_key")
    async def fullet_api_key(request):
        denied = require_local_token(request)
        if denied is not None:
            return denied

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        api_key = str(body.get("apiKey") or "").strip()
        persistent = bool(body.get("persistent"))
        if not api_key:
            return web.json_response({"error": "API key is required"}, status=400)

        validation = await _fetch_fullet_me(api_key)
        if not validation.get("ok"):
            return web.json_response({"error": str(validation.get("error") or "Invalid API key")}, status=401)

        _set_fullet_api_key(api_key, username=validation.get("username", ""), persistent=persistent)
        with _fullet_lock:
            _fullet_favorites_cache.update({"key": "", "expires_at": 0, "payload": {"posts": [], "source": "fullet", "connected": True}})
        return web.json_response(_get_fullet_auth_status())

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
        _clear_fullet_api_key()
        return web.json_response({"success": True})

    @server.instance.routes.get("/anima/fullet_auth_start")
    async def fullet_auth_start(request):
        return web.json_response({"error": "This flow has been retired. Use a Personal API Key from Fullet settings."}, status=410)

    @server.instance.routes.get("/anima/auth_callback")
    async def fullet_auth_callback(request):
        html = f"""
<!doctype html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <title>API Key Required</title>
  <style>
    body {{ font-family: Arial, sans-serif; background:#0f1424; color:#e8edff; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }}
    .card {{ width:min(560px,92vw); border:1px solid #2e3a66; border-radius:14px; background:#10182e; padding:22px; box-shadow:0 20px 60px rgba(0,0,0,.35); }}
    h1 {{ margin:0 0 8px; font-size:22px; }}
    p {{ margin:0 0 12px; color:#b9c7ff; line-height:1.45; }}
    a {{ color:#9fc1ff; }}
  </style>
</head>
<body>
  <div class=\"card\">
    <h1>API Key Required</h1>
    <p>The old login redirect flow for Anima has been retired.</p>
    <p>Generate a Personal API Key in your Fullet account and paste it into the node locally.</p>
    <p><a href=\"{escape(FULLET_BASE_URL)}/ajustes/anima-key\" target=\"_blank\" rel=\"noopener\">Open Fullet API key settings</a></p>
  </div>
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

        headers = _auth_headers()
        if not headers:
            return web.json_response({"error": "Not connected to Fullet"}, status=401)

        reader = await request.multipart()
        upload_files = []
        prompt = ""
        negative_prompt = ""
        model = "anima"
        category = ""
        description = ""
        manual_nsfw = ""
        preserve_metadata = ""
        settings_json = ""
        images_data_json = ""
        tags_json = ""
        style_research_json = ""

        async for part in reader:
            if part.name in ("file", "files"):
                file_bytes = await part.read(decode=False)
                upload_files.append({
                    "bytes": file_bytes,
                    "filename": part.filename or f"upload-{len(upload_files) + 1}.png",
                    "content_type": part.headers.get("Content-Type", "image/png"),
                })
            elif part.name == "prompt":
                prompt = (await part.text()).strip()
            elif part.name == "negativePrompt":
                negative_prompt = (await part.text()).strip()
            elif part.name == "model":
                model = (await part.text()).strip() or "anima"
            elif part.name == "category":
                category = (await part.text()).strip()
            elif part.name == "description":
                description = (await part.text()).strip()
            elif part.name == "manualNsfw":
                manual_nsfw = (await part.text()).strip()
            elif part.name == "preserveMetadata":
                preserve_metadata = (await part.text()).strip()
            elif part.name == "settings":
                settings_json = (await part.text()).strip()
            elif part.name == "imagesData":
                images_data_json = (await part.text()).strip()
            elif part.name == "tags":
                tags_json = (await part.text()).strip()
            elif part.name == "styleResearch":
                style_research_json = (await part.text()).strip()

        if not upload_files:
            return web.json_response({"error": "No file provided"}, status=400)
        if len(upload_files) > MAX_FULLET_UPLOAD_ITEMS:
            return web.json_response({"error": f"Too many images selected (max {MAX_FULLET_UPLOAD_ITEMS})"}, status=400)
        if not prompt:
            return web.json_response({"error": "Prompt is required"}, status=400)

        for index, item in enumerate(upload_files, start=1):
            file_bytes = item.get("bytes") or b""
            filename = item.get("filename") or f"upload-{index}.png"
            content_type = item.get("content_type") or "image/png"

            if len(file_bytes) > (12 * 1024 * 1024):
                return web.json_response({"error": f"Image {index} is too large"}, status=400)
            if content_type not in ALLOWED_UPLOAD_TYPES:
                return web.json_response({"error": f"Unsupported file type on image {index}: {content_type}"}, status=400)

            ext = os.path.splitext(filename)[1].lower() if filename else ""
            if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
                return web.json_response({"error": f"Unsupported file extension on image {index}: {ext}"}, status=400)

            detected = None
            for magic, mime in _IMAGE_MAGIC.items():
                if file_bytes[:len(magic)] == magic:
                    detected = mime
                    break
            if not detected:
                return web.json_response({"error": f"Image {index} does not appear to be valid"}, status=400)

        form = FormData()
        for item in upload_files:
            form.add_field(
                "file",
                item["bytes"],
                filename=item.get("filename") or "generation.png",
                content_type=item.get("content_type") or "image/png",
            )
        form.add_field("prompt", prompt)
        form.add_field("negativePrompt", negative_prompt)
        form.add_field("model", model)
        if category:
            form.add_field("category", category)
        if description:
            form.add_field("description", description)
        if manual_nsfw:
            form.add_field("manualNsfw", manual_nsfw)
        if preserve_metadata:
            form.add_field("preserveMetadata", preserve_metadata)
        if settings_json:
            form.add_field("settings", settings_json)
        if images_data_json:
            form.add_field("imagesData", images_data_json)
        if tags_json:
            form.add_field("tags", tags_json)
        if style_research_json:
            form.add_field("styleResearch", style_research_json)

        url = f"{FULLET_BASE_URL}/api/integrations/anima/upload"
        timeout = ClientTimeout(total=120)
        try:
            async with ClientSession(timeout=timeout) as session:
                async with session.post(url, data=form, headers=_fullet_headers(headers)) as resp:
                    text = await resp.text()
                    try:
                        payload = json.loads(text) if text else {}
                    except Exception:
                        payload = {"error": text or "Unknown upstream response"}

                    if _is_cloudflare_challenge(resp, text):
                        return web.json_response(
                            {"error": FULLET_CLOUDFLARE_ERROR, "blockedByCloudflare": True},
                            status=403,
                        )

                    if resp.status in (401, 403):
                        _clear_fullet_api_key()

                    return web.json_response(payload, status=resp.status)
        except Exception as e:
            print(f" [AnimaStyleExplorer] Upload proxy error: {e}")
            return web.json_response({"error": "Upload failed"}, status=500)


