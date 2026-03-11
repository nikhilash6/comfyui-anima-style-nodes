import json
import os
import random
import re
import time
import urllib.request
import threading
from concurrent.futures import ThreadPoolExecutor

URL = "https://thetacursed.github.io/Anima-Style-Explorer/app/data.js"
_DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "artists.json")
_IMG_DIR = os.path.join(os.path.dirname(__file__), "js", "images")
_cache = []
_download_status = {"active": False, "total": 0, "done": 0}
_download_lock = threading.Lock()


def download():
    global _cache
    try:
        url_busted = f"{URL}&t={int(time.time())}" if "?" in URL else f"{URL}?t={int(time.time())}"
        print(f" [AnimaStyleExplorer] Fetching artist data from {url_busted}...")
        with urllib.request.urlopen(url_busted) as r:
            c = r.read().decode('utf-8')
        m = re.search(r"const galleryData\s*=\s*(\[[\s\S]*?\]);", c)
        if not m:
            print(" [AnimaStyleExplorer] FAILED: Could not find galleryData in JS file.")
            return False

        items = json.loads(m.group(1))
        new_artists = [
            {
                "id": str(i.get("id", "")),
                "tag": i.get("name", ""),
                "works": i.get("post_count", 0),
                "p": i.get("p", 1),
                "uniqueness_score": i.get("uniqueness_score", 0),
            }
            for i in items
        ]

        os.makedirs(os.path.dirname(_DATA_PATH), exist_ok=True)
        with open(_DATA_PATH, "w", encoding="utf-8") as f:
            json.dump(new_artists, f, indent=2, ensure_ascii=False)

        print(f" [AnimaStyleExplorer] SUCCESS: Saved {len(new_artists)} artists to {_DATA_PATH}.")
        _cache = []
        return True
    except Exception as e:
        print(f" [AnimaStyleExplorer] DOWNLOAD ERROR: {e}")
        return False


def _image_target(item):
    pid = item.get("p", 1)
    artist_id = str(item.get("id", "") or "")
    if not artist_id:
        return "", "", ""

    url = f"https://thetacursed.github.io/Anima-Style-Explorer/images/{pid}/{artist_id}.webp"
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
    artist_id, _, path = _image_target(item)
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


_cache_mtime = 0


def load():
    global _cache, _cache_mtime
    if not os.path.exists(_DATA_PATH):
        return []

    mtime = os.path.getmtime(_DATA_PATH)
    if _cache and _cache_mtime == mtime:
        return _cache

    try:
        with open(_DATA_PATH, "r", encoding="utf-8") as f:
            _cache = json.load(f)
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

    return _cache


def all_tags():
    return sorted(a["tag"] for a in load() if "tag" in a)


def pick_random():
    artists = load()
    return random.choice(artists) if artists else None


def inject(prompt, tag):
    space_tag = tag.replace("_", " ")
    cleaned = re.sub(r"^@[^,]+,?\s*", "", prompt).strip()
    return f"@{space_tag}, {cleaned}" if cleaned else f"@{space_tag}"
