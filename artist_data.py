import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlencode, urlparse

URL = os.getenv(
    "ANIMA_STYLE_DATA_URL",
    "https://raw.githubusercontent.com/ThetaCursed/Anima-Style-Explorer/main/app/data.js",
)
ANIMA_ASSETS_IMAGE_BASE = os.getenv(
    "ANIMA_ASSETS_IMAGE_BASE",
    "https://raw.githubusercontent.com/ThetaCursed/Anima-Assets/main/images",
).rstrip("/")
ANIMADEX_API_BASE = os.getenv("ANIMADEX_API_BASE", "https://animadex.net/api").rstrip("/")
ANIMADEX_DELAY_SECONDS = max(1.5, float(os.getenv("ANIMADEX_DELAY_SECONDS", "3.0")))
ANIMADEX_MODES = ("artists", "characters")

_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "artists.json")
_ANIMADEX_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "animadex_index.json")
_IMG_DIR = os.path.join(os.path.dirname(__file__), "js", "images")
_cache = []
_cache_mtime = 0
_animadex_cache = []
_animadex_cache_mtime = 0
_download_status = {"active": False, "total": 0, "done": 0}
_download_lock = threading.Lock()


def _safe_int(value, default=0):
    try:
        return int(value)
    except Exception:
        return default


def _safe_float(value, default=0):
    try:
        return float(value)
    except Exception:
        return default


def _prompt_escape_parens(value):
    return str(value or "").strip().replace("(", "\\(").replace(")", "\\)")


def _safe_file_stem(value):
    stem = str(value or "").strip()
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", stem)
    return stem.strip("._") or "preview"


def _read_json_list(path):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return payload if isinstance(payload, list) else []
    except Exception:
        return []


def _write_json_list(path, items):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)


def _fetch_text(url, timeout=45):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "text/plain, application/javascript, */*",
            "User-Agent": "ComfyUI-AnimaStyleExplorer/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8-sig")


def _fetch_json(url, timeout=45):
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "ComfyUI-AnimaStyleExplorer/1.0",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _fetch_json_with_retry(url, retries=5):
    for attempt in range(max(1, retries)):
        try:
            return _fetch_json(url)
        except urllib.error.HTTPError as e:
            if e.code != 429 or attempt >= retries - 1:
                raise
            retry_after = _safe_float(e.headers.get("Retry-After"), 0)
            wait = max(12.0, retry_after, ANIMADEX_DELAY_SECONDS * (attempt + 3))
            print(f" [AnimaStyleExplorer] Animadex rate limited; waiting {wait:.1f}s before retry...")
            time.sleep(wait)


def _normalize_legacy_artist(item):
    return {
        "id": str(item.get("id", "")),
        "tag": item.get("name", ""),
        "works": _safe_int(item.get("post_count", 0)),
        "p": _safe_int(item.get("p", 1), 1) or 1,
        "uniqueness_score": _safe_float(item.get("uniqueness_score", 0)),
        "source": "theta",
    }


def _animadex_source_kind(mode):
    return "artist" if str(mode or "").strip().lower() == "artists" else "character"


def _normalize_animadex_item(item, mode):
    if not isinstance(item, dict):
        return None

    slug = str(item.get("slug") or "").strip()
    trigger = str(item.get("trigger") or item.get("name") or slug).strip()
    if not trigger:
        return None

    source_kind = _animadex_source_kind(mode)
    score = item.get("score")
    tags = item.get("tags") if isinstance(item.get("tags"), list) else []

    return {
        "id": f"animadex-{source_kind}-{slug or _safe_file_stem(trigger)}",
        "tag": _prompt_escape_parens(trigger),
        "name": str(item.get("name") or trigger).strip(),
        "works": _safe_int(item.get("count", 0)),
        "p": 1,
        "uniqueness_score": round(_safe_float(score, 0) * 100, 3) if score is not None else 0,
        "score": _safe_float(score, 0) if score is not None else None,
        "source": "animadex",
        "source_kind": source_kind,
        "slug": slug,
        "trigger": trigger,
        "thumb_url": str(item.get("thumb_url") or "").strip(),
        "img_url": str(item.get("img_url") or "").strip(),
        "has_image": bool(item.get("has_image")),
        "url": str(item.get("url") or "").strip(),
        "copyright": str(item.get("copyright") or "").strip(),
        "copyright_name": str(item.get("copyright_name") or "").strip(),
        "tags": [str(tag or "").strip() for tag in tags if str(tag or "").strip()],
    }


def _merge_items(legacy, animadex):
    merged = []
    seen = set()

    def key_for(item):
        source = str(item.get("source") or "")
        source_kind = str(item.get("source_kind") or "")
        tag = str(item.get("tag") or "").strip().lower().replace(" ", "_")
        if source == "animadex" and source_kind == "character":
            return f"animadex-character:{tag}"
        return tag

    for item in list(legacy or []) + list(animadex or []):
        if not isinstance(item, dict):
            continue
        key = key_for(item)
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
    return merged


def _download_legacy():
    global _cache

    url_busted = f"{URL}&t={int(time.time())}" if "?" in URL else f"{URL}?t={int(time.time())}"
    print(f" [AnimaStyleExplorer] Fetching artist data from {url_busted}...")
    c = _fetch_text(url_busted)
    m = re.search(r"const galleryData\s*=\s*(\[[\s\S]*?\]);", c)
    if not m:
        print(" [AnimaStyleExplorer] FAILED: Could not find galleryData in JS file.")
        return False

    items = json.loads(m.group(1))
    new_artists = [_normalize_legacy_artist(i) for i in items if isinstance(i, dict)]
    _write_json_list(_DATA_PATH, new_artists)

    print(f" [AnimaStyleExplorer] SUCCESS: Saved {len(new_artists)} artists to {_DATA_PATH}.")
    _cache = []
    return True


def _download_animadex(modes=None, max_pages=None):
    global _animadex_cache

    selected_modes = []
    for mode in modes or ANIMADEX_MODES:
        mode = str(mode or "").strip().lower()
        if mode in ANIMADEX_MODES and mode not in selected_modes:
            selected_modes.append(mode)
    if not selected_modes:
        selected_modes = list(ANIMADEX_MODES)

    page_limit = _safe_int(max_pages, 0)
    selected_kinds = set(_animadex_source_kind(mode) for mode in selected_modes)
    indexed = [
        item
        for item in _read_json_list(_ANIMADEX_DATA_PATH)
        if str(item.get("source_kind") or "").strip().lower() not in selected_kinds
    ]

    for mode in selected_modes:
        page = 1
        pages = 1
        while page <= pages:
            query = urlencode({"sort": "count", "page": page})
            url = f"{ANIMADEX_API_BASE}/{mode}/search?{query}"
            print(f" [AnimaStyleExplorer] Animadex {mode}: page {page}...")
            payload = _fetch_json_with_retry(url)
            pages = max(1, _safe_int(payload.get("pages"), 1))

            for item in payload.get("results") or []:
                normalized = _normalize_animadex_item(item, mode)
                if normalized:
                    indexed.append(normalized)

            if page_limit and page >= page_limit:
                break

            page += 1
            if page <= pages:
                time.sleep(ANIMADEX_DELAY_SECONDS)

        _write_json_list(_ANIMADEX_DATA_PATH, indexed)
        print(f" [AnimaStyleExplorer] CHECKPOINT: Saved {len(indexed)} Animadex entries after {mode}.")

    _write_json_list(_ANIMADEX_DATA_PATH, indexed)
    _animadex_cache = []
    print(f" [AnimaStyleExplorer] SUCCESS: Saved {len(indexed)} Animadex entries to {_ANIMADEX_DATA_PATH}.")
    return True


def download(include_animadex=False, animadex_modes=None, max_pages=None):
    try:
        legacy_ok = _download_legacy()
        animadex_ok = True
        if include_animadex:
            animadex_ok = _download_animadex(animadex_modes, max_pages=max_pages)
        return bool(legacy_ok and animadex_ok)
    except Exception as e:
        print(f" [AnimaStyleExplorer] DOWNLOAD ERROR: {e}")
        return False


def _image_target(item):
    item = item or {}
    source = str(item.get("source") or "").strip().lower()
    if source == "animadex":
        url = str(item.get("thumb_url") or item.get("img_url") or "").strip()
        if not url:
            return "", "", ""

        parsed = urlparse(url)
        ext = os.path.splitext(parsed.path)[1].lower() or ".webp"
        if ext not in (".webp", ".png", ".jpg", ".jpeg"):
            ext = ".webp"
        source_kind = str(item.get("source_kind") or "item").strip() or "item"
        artist_id = _safe_file_stem(item.get("id") or item.get("slug") or item.get("tag"))
        path = os.path.join(_IMG_DIR, "animadex", source_kind, f"{artist_id}{ext}")
        return artist_id, url, path

    pid = item.get("p", 1)
    artist_id = str(item.get("id", "") or "")
    if not artist_id:
        return "", "", ""

    url = f"{ANIMA_ASSETS_IMAGE_BASE}/{pid}/{artist_id}.webp"
    path = os.path.join(_IMG_DIR, str(pid), f"{artist_id}.webp")
    return artist_id, url, path


def ensure_image_cached(item, timeout=5):
    artist_id, url, path = _image_target(item or {})
    if not artist_id:
        return False

    if os.path.exists(path) and os.path.getsize(path) > 100:
        return True

    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with urllib.request.urlopen(url, timeout=timeout) as r:
            data = r.read()
        if len(data) <= 100:
            return False
        with open(path, "wb") as f:
            f.write(data)
        return True
    except Exception as e:
        print(f" [AnimaStyleExplorer] Could not cache preview {artist_id}: {e}")
        return os.path.exists(path) and os.path.getsize(path) > 100


def _download_one(item):
    global _download_status
    artist_id, _, _path = _image_target(item)
    if not artist_id:
        return

    if ensure_image_cached(item, timeout=15):
        with _download_lock:
            _download_status["done"] += 1
        return

    with _download_lock:
        _download_status["done"] += 1


def start_image_download():
    global _download_status

    with _download_lock:
        if _download_status["active"]:
            return False
        artists = load()
        if not artists:
            return False
        _download_status = {"active": True, "total": len(artists), "done": 0}

    def _run():
        try:
            with ThreadPoolExecutor(max_workers=10) as executor:
                executor.map(_download_one, artists)
        finally:
            with _download_lock:
                _download_status["active"] = False

    threading.Thread(target=_run, daemon=True).start()
    return True


def get_download_status():
    with _download_lock:
        return dict(_download_status)


def _load_legacy():
    global _cache, _cache_mtime
    if not os.path.exists(_DATA_PATH):
        return []

    mtime = os.path.getmtime(_DATA_PATH)
    if _cache and _cache_mtime == mtime:
        return _cache

    try:
        _cache = _read_json_list(_DATA_PATH)
        _cache_mtime = mtime
    except Exception:
        _cache = []

    for a in _cache:
        if not isinstance(a, dict):
            continue
        if "id" in a:
            a["id"] = str(a.get("id", ""))
        a.setdefault("tag", a.get("name", ""))
        a.setdefault("works", a.get("post_count", 0))
        a.setdefault("p", 1)
        a.setdefault("uniqueness_score", 0)
        a.setdefault("source", "theta")

    return _cache


def _load_animadex():
    global _animadex_cache, _animadex_cache_mtime
    if not os.path.exists(_ANIMADEX_DATA_PATH):
        return []

    mtime = os.path.getmtime(_ANIMADEX_DATA_PATH)
    if _animadex_cache and _animadex_cache_mtime == mtime:
        return _animadex_cache

    try:
        _animadex_cache = _read_json_list(_ANIMADEX_DATA_PATH)
        _animadex_cache_mtime = mtime
    except Exception:
        _animadex_cache = []

    for a in _animadex_cache:
        if not isinstance(a, dict):
            continue
        a["id"] = str(a.get("id", ""))
        a.setdefault("tag", a.get("trigger", a.get("name", "")))
        a.setdefault("works", a.get("count", 0))
        a.setdefault("p", 1)
        a.setdefault("uniqueness_score", 0)
        a.setdefault("source", "animadex")

    return _animadex_cache


def load(include_animadex=True):
    legacy = _load_legacy()
    animadex = _load_animadex() if include_animadex else []
    return _merge_items(legacy, animadex)


def load_animadex(source_kind=None):
    kind = str(source_kind or "").strip().lower()
    items = list(_load_animadex())
    if kind:
        items = [
            item
            for item in items
            if str(item.get("source_kind") or "").strip().lower() == kind
        ]
    return items


def stats():
    legacy = _load_legacy()
    animadex = _load_animadex()
    return {
        "legacy": len(legacy),
        "animadex": len(animadex),
        "total": len(_merge_items(legacy, animadex)),
    }


def all_tags():
    return sorted(a["tag"] for a in load() if "tag" in a)


def pick_random():
    artists = load()
    return random.choice(artists) if artists else None


def inject(prompt, tag):
    space_tag = tag.replace("_", " ")
    cleaned = re.sub(r"^@[^,]+,?\s*", "", prompt).strip()
    return f"@{space_tag}, {cleaned}" if cleaned else f"@{space_tag}"
