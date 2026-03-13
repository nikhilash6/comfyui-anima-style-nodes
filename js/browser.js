import { api } from "../../scripts/api.js";
import { FULLET_BASE, SITE_BASE } from "./config.js";
import { Data } from "./data.js";
import {
    favoriteKeyFromItem,
    isFulletLike,
    localFavoriteFromFullet,
    localFavoriteFromStyle,
} from "./browser_helpers.js";
import {
    buildFavoritesList,
    loadLocalFavorites as fetchLocalFavorites,
    loadRemoteFavorites as fetchRemoteFavorites,
    mutateLocalFavorites as sendLocalFavoriteMutation,
    rebuildFavoriteMap,
    syncRemoteFavorite as sendRemoteFavoriteMutation,
} from "./browser_favorites.js";
import { createFulletCard, createStyleCard } from "./browser_cards.js";
import {
    buildFulletList,
    buildStyleList,
    renderChunkedGrid,
    renderRemoteGate,
} from "./browser_renderers.js";
import { attachBrowserEvents } from "./browser_events.js";
import { getBrowserTemplate } from "./browser_template.js";
import { Swipe } from "./swipe.js";
import { applyFulletSelection, buildFulletCopyText, getPromptWidget, thumbUrl } from "./utils.js";
import { showToast } from "./toast.js";

export const Browser = (() => {
    let el, grid, countEl, onPick, activeNode = null;
    let filter = "", sort = "works", category = "all", _renderId = 0, _observer, _lastList = [], _lastHighlightedTag = "";
    const FULLET_PROMPTS_PAGE_SIZE = 48;
    const FULLET_PROMPTS_SCROLL_MARGIN = 960;
    let _fulletPosts = [], _fulletLoaded = false, _fulletNextOffset = 0, _fulletHasMore = true, _fulletLoading = false, _fulletLoadPromise = null, _fulletScrollHandler = null;
    let _localFavorites = [], _localFavoritesLoaded = false;
    let _remoteFavorites = [], _remoteFavoritesLoaded = false;
    let _favoriteMap = new Map();
    let _authPollTimer = null, _localApiToken = "";
    let _authConnected = false, _authUsername = "";
    let _remoteEnabled = false;
    let _remoteFavoriteSyncPromise = null;

    function _safeSessionGet(key, fallback = "") {
        try {
            const value = sessionStorage.getItem(key);
            return value == null ? fallback : value;
        } catch {
            return fallback;
        }
    }

    function _safeSessionSet(key, value) {
        try {
            sessionStorage.setItem(key, String(value));
        } catch { }
    }

    function _safeLocalGet(key, fallback = "") {
        try {
            const value = localStorage.getItem(key);
            return value == null ? fallback : value;
        } catch {
            return fallback;
        }
    }

    function _safeLocalSet(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch { }
    }

    function _isRemoteFavoriteSyncPending() {
        return _safeLocalGet("anima_remote_favorites_pending", "false") === "true";
    }

    function _setRemoteFavoriteSyncPending(value) {
        _safeLocalSet("anima_remote_favorites_pending", value ? "true" : "false");
    }

    function _localHeaders() {
        if (!_localApiToken) return {};
        return { "x-anima-local-token": _localApiToken };
    }

    async function _copyText(text) {
        const value = String(text || "").trim();
        if (!value) return false;
        try {
            await navigator.clipboard?.writeText?.(value);
            return true;
        } catch {
            return false;
        }
    }

    function _setAuthUi({ connected = false, username = "", unavailable = false } = {}) {
        if (!el) return;
        const statusEl = el.querySelector("#anima-fullet-auth");
        const connectBtn = el.querySelector("#anima-fullet-connect");
        const disconnectBtn = el.querySelector("#anima-fullet-disconnect");
        const uploadBtn = el.querySelector("#anima-fullet-upload");
        if (!statusEl || !connectBtn || !disconnectBtn || !uploadBtn) return;

        statusEl.textContent = unavailable
            ? "Auth unavailable"
            : connected
                ? `API Key @${username || "user"}`
                : "API key not set";
        statusEl.classList.toggle("connected", connected && !unavailable);
        connectBtn.style.display = connected ? "none" : "inline-flex";
        disconnectBtn.style.display = connected ? "inline-flex" : "none";
        uploadBtn.classList.toggle("disabled", !connected);
    }

    function _rebuildFavoriteMap() {
        _favoriteMap = rebuildFavoriteMap(_localFavorites, _remoteFavorites);
    }

    function _toFulletMediaUrl(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";

        try {
            const parsed = new URL(raw, FULLET_BASE);
            const pathname = String(parsed.pathname || "").toLowerCase();
            if (!pathname.startsWith("/posts/") && !pathname.startsWith("/avatars/")) {
                return raw;
            }
        } catch {
            return raw;
        }

        return `${FULLET_BASE}/api/media?src=${encodeURIComponent(raw)}`;
    }

    function _getFulletDisplayImageUrl(item) {
        return _toFulletMediaUrl(item?.thumbnailUrl || item?.imageUrl);
    }

    function _getFulletFullImageUrl(item) {
        return _toFulletMediaUrl(item?.imageUrl || item?.thumbnailUrl);
    }

    function _decorateFulletItem(item) {
        return {
            ...item,
            kind: "fullet",
            displayImageUrl: _getFulletDisplayImageUrl(item),
            fullImageUrl: _getFulletFullImageUrl(item),
        };
    }

    function _setCategoryTabs() {
        if (!el) return;
        el.querySelector("#anima-cat-all").style.opacity = category === "all" ? "1" : "0.5";
        el.querySelector("#anima-cat-fullet").style.opacity = category === "fullet" ? "1" : "0.5";
        el.querySelector("#anima-cat-favorites").style.opacity = category === "favorites" ? "1" : "0.5";
        const sortSelect = el.querySelector(".hdr-select");
        if (sortSelect) sortSelect.disabled = category !== "all";
    }

    function _detachFulletScrollHandler() {
        const bodyEl = el?.querySelector(".body");
        if (bodyEl && _fulletScrollHandler) {
            bodyEl.removeEventListener("scroll", _fulletScrollHandler);
        }
        _fulletScrollHandler = null;
    }

    function _resetFulletPromptsFeed() {
        _fulletPosts = [];
        _fulletLoaded = false;
        _fulletNextOffset = 0;
        _fulletHasMore = true;
        _fulletLoading = false;
        _fulletLoadPromise = null;
        _detachFulletScrollHandler();
    }

    function _updateFulletCount(visibleCount = 0) {
        if (!countEl) return;
        const suffix = _fulletHasMore ? "+" : "";
        const loadingSuffix = _fulletLoading ? " loading..." : "";
        countEl.textContent = `${visibleCount}${suffix} prompts${loadingSuffix}`;
    }

    function _dedupeFulletPosts(posts = []) {
        const next = [];
        const seen = new Set();
        for (const post of posts) {
            const id = String(post?.id || "").trim();
            const key = id || `${post?.postUrl || ""}:${post?.artist || ""}`;
            if (!key || seen.has(key)) continue;
            seen.add(key);
            next.push(post);
        }
        return next;
    }

    function _bindFulletInfiniteScroll(renderId) {
        _detachFulletScrollHandler();
        if (!_fulletHasMore || !el) return;

        const bodyEl = el.querySelector(".body");
        if (!bodyEl) return;

        const loadMore = async () => {
            if (category !== "fullet" || _fulletLoading || !_fulletHasMore) return;

            const distanceToBottom = bodyEl.scrollHeight - (bodyEl.scrollTop + bodyEl.clientHeight);
            if (distanceToBottom > FULLET_PROMPTS_SCROLL_MARGIN) return;

            const prevVisibleCount = _lastList.length;
            const prevScrollTop = bodyEl.scrollTop;

            await _loadFulletPrompts();

            if (category !== "fullet" || renderId !== _renderId) return;

            const nextList = buildFulletList(_fulletPosts, filter);
            const appendedItems = nextList
                .slice(prevVisibleCount)
                .map((item) => _decorateFulletItem(item));

            if (appendedItems.length) {
                renderChunkedGrid({
                    grid,
                    observer: _observer,
                    items: appendedItems,
                    chunkSize: 40,
                    minHeight: "420px",
                    append: true,
                    renderItem: (item) => _renderFulletCard(item),
                });
            }

            _lastList = nextList.map((item) => _decorateFulletItem(item));
            _updateFulletCount(nextList.length);
            bodyEl.scrollTop = prevScrollTop;

            if (!_fulletHasMore) {
                _detachFulletScrollHandler();
                return;
            }

            if (bodyEl.scrollHeight <= bodyEl.clientHeight + FULLET_PROMPTS_SCROLL_MARGIN) {
                window.requestAnimationFrame(() => {
                    loadMore().catch(() => {});
                });
            }
        };

        _fulletScrollHandler = () => {
            loadMore().catch(() => {});
        };

        bodyEl.addEventListener("scroll", _fulletScrollHandler, { passive: true });
        window.requestAnimationFrame(() => {
            loadMore().catch(() => {});
        });
    }

    async function _fetchLocalApiToken() {
        if (_localApiToken) return _localApiToken;
        try {
            const r = await api.fetchApi("/anima/fullet_local_token");
            const s = await r.json().catch(() => ({}));
            if (typeof s.localToken === "string" && s.localToken) {
                _localApiToken = s.localToken;
            }
        } catch { }
        return _localApiToken;
    }

    async function _getAuthSnapshot() {
        if (!_localApiToken) {
            await _fetchLocalApiToken();
        }

        const r = await api.fetchApi("/anima/fullet_auth_status", { headers: _localHeaders() });
        const s = await r.json().catch(() => ({}));

        if (typeof s.localToken === "string" && s.localToken) {
            _localApiToken = s.localToken;
        } else if (!_localApiToken) {
            await _fetchLocalApiToken();
        }

        return s;
    }

    async function _ensureLocalToken() {
        if (_localApiToken) return true;
        await _fetchLocalApiToken();
        if (!_localApiToken) {
            try { await _getAuthSnapshot(); } catch { }
        }
        return !!_localApiToken;
    }

    async function _syncPendingRemoteFavorites({ force = false } = {}) {
        if (_remoteFavoriteSyncPromise) return _remoteFavoriteSyncPromise;

        _remoteFavoriteSyncPromise = (async () => {
            if (!_authConnected) return { ok: false, skipped: true };
            await _loadLocalFavorites();

            const shouldSync = force || _isRemoteFavoriteSyncPending();
            if (!shouldSync) return { ok: true, skipped: true };

            const posts = [];
            const seen = new Set();
            for (const item of _localFavorites) {
                if (String(item?.kind || "") !== "fullet") continue;
                const postId = String(item?.id || item?.postId || "").trim();
                if (!postId || seen.has(postId)) continue;
                seen.add(postId);
                posts.push(item);
            }

            if (!posts.length) {
                _setRemoteFavoriteSyncPending(false);
                return { ok: true, synced: 0, failed: 0 };
            }

            let synced = 0;
            let failed = 0;
            const batchSize = 3;

            for (let i = 0; i < posts.length; i += batchSize) {
                const batch = posts.slice(i, i + batchSize);
                const results = await Promise.all(batch.map((item) => _syncRemoteFavorite(item, true)));
                for (const result of results) {
                    if (result?.ok) synced += 1;
                    else failed += 1;
                }
                if (i + batchSize < posts.length) {
                    await new Promise((resolve) => setTimeout(resolve, 180));
                }
            }

            if (failed === 0) {
                _setRemoteFavoriteSyncPending(false);
                _remoteFavoritesLoaded = false;
            } else {
                _setRemoteFavoriteSyncPending(true);
            }

            return { ok: failed === 0, synced, failed };
        })();

        try {
            return await _remoteFavoriteSyncPromise;
        } finally {
            _remoteFavoriteSyncPromise = null;
        }
    }

    async function _refreshAuthStatus({ syncPending = true } = {}) {
        if (!el) return { connected: false, unavailable: true };
        const prevConnected = _authConnected;

        try {
            const s = await _getAuthSnapshot();
            const connected = !!s.connected;
            const persistent = !!s.persistent;
            _authConnected = connected;
            _authUsername = String(s.username || "").trim();
            _safeLocalSet("anima_keep_session", persistent ? "true" : "false");
            const keepToggle = el.querySelector("#anima-keep-session");
            if (keepToggle) keepToggle.checked = persistent;
            _setAuthUi({ connected, username: _authUsername });

            if (connected && syncPending && (!prevConnected || _isRemoteFavoriteSyncPending())) {
                Promise.resolve().then(() => _syncPendingRemoteFavorites().catch(() => { }));
            }

            return {
                connected,
                username: _authUsername,
                localToken: _localApiToken,
                persistent,
            };
        } catch {
            _authConnected = false;
            _authUsername = "";
            _setAuthUi({ unavailable: true });
            return { connected: false, unavailable: true };
        }
    }

    async function _loadLocalFavorites(force = false) {
        if (_localFavoritesLoaded && !force) return _localFavorites;
        _localFavorites = await fetchLocalFavorites(api);
        _localFavoritesLoaded = true;
        _rebuildFavoriteMap();

        if (!_authConnected) {
            const hasQueuedRemoteFavorites = _localFavorites.some((item) => {
                return String(item?.kind || "") === "fullet" && String(item?.id || item?.postId || "").trim();
            });
            _setRemoteFavoriteSyncPending(hasQueuedRemoteFavorites);
        }

        return _localFavorites;
    }

    async function _mutateLocalFavorites(payload) {
        const ok = await _ensureLocalToken();
        if (!ok) {
            return { ok: false, error: "Local security token not available. Reopen the browser and try again." };
        }

        const result = await sendLocalFavoriteMutation(api, _localHeaders(), payload);
        if (!result.ok) {
            return { ok: false, error: result.error || "Favorite update failed" };
        }

        _localFavorites = Array.isArray(result.items) ? result.items : _localFavorites;
        _localFavoritesLoaded = true;
        _rebuildFavoriteMap();
        return { ok: true, data: result.data };
    }

    async function _loadRemoteFavorites(force = false) {
        if (!_authConnected) {
            _remoteFavorites = [];
            _remoteFavoritesLoaded = true;
            _rebuildFavoriteMap();
            return _remoteFavorites;
        }

        if (_remoteFavoritesLoaded && !force) return _remoteFavorites;

        _remoteFavorites = await fetchRemoteFavorites(api, { limit: 96, offset: 0 });
        _remoteFavoritesLoaded = true;
        _rebuildFavoriteMap();
        return _remoteFavorites;
    }

    async function _syncRemoteFavorite(post, favorited) {
        if (!_authConnected) return { ok: true, skipped: true };

        const ok = await _ensureLocalToken();
        if (!ok) {
            return { ok: false, error: "Local security token not available. Reopen the browser and try again." };
        }

        const result = await sendRemoteFavoriteMutation(api, _localHeaders(), {
            postId: String(post?.id || post?.postId || ""),
            favorited: !!favorited,
        });

        if (!result.ok) {
            if (result.status === 401 || result.status === 403) {
                await _refreshAuthStatus();
            }
            return { ok: false, error: result.error || "Remote favorite update failed" };
        }

        _remoteFavoritesLoaded = false;
        return { ok: true, data: result.data };
    }

    function _isFavorited(item) {
        const key = favoriteKeyFromItem(item);
        return key ? _favoriteMap.has(key) : false;
    }

    async function _toggleStyleFavorite(artist, anchorEl = null) {
        const entry = localFavoriteFromStyle(artist);
        if (!entry) {
            alert("Invalid style favorite payload.");
            return { ok: false };
        }

        const already = _favoriteMap.has(entry.key);
        const nextState = !already;
        const result = already
            ? await _mutateLocalFavorites({ action: "remove", key: entry.key })
            : await _mutateLocalFavorites({ action: "upsert", item: entry });

        if (!result.ok) {
            alert(result.error || "Could not update favorite.");
            return { ok: false };
        }

        showToast(nextState ? "Added to favorites" : "Removed from favorites", "success", 1500, { anchor: anchorEl });

        if (category === "favorites") {
            await _renderFavorites();
        }
        return { ok: true, favorited: nextState };
    }

    async function _toggleFulletFavorite(post, anchorEl = null) {
        const localEntry = localFavoriteFromFullet(post);
        if (!localEntry) {
            alert("Invalid prompt favorite payload.");
            return { ok: false };
        }

        const already = _favoriteMap.has(localEntry.key);
        const nextState = !already;

        const localResult = nextState
            ? await _mutateLocalFavorites({ action: "upsert", item: localEntry })
            : await _mutateLocalFavorites({ action: "remove", key: localEntry.key });

        if (!localResult.ok) {
            alert(localResult.error || "Could not update local favorite.");
            return { ok: false };
        }

        if (!_authConnected) {
            const hasQueuedRemoteFavorites = _localFavorites.some((item) => {
                return String(item?.kind || "") === "fullet" && String(item?.id || item?.postId || "").trim();
            });
            _setRemoteFavoriteSyncPending(hasQueuedRemoteFavorites);
        } else {
            const remoteResult = await _syncRemoteFavorite(post, nextState);
            if (!remoteResult.ok) {
                _setRemoteFavoriteSyncPending(true);
                alert(remoteResult.error || "Could not sync account favorite.");
            }
        }

        showToast(nextState ? "Added to favorites" : "Removed from favorites", "success", 1500, { anchor: anchorEl });

        if (category === "favorites") {
            _remoteFavoritesLoaded = false;
            await _renderFavorites();
        }
        return { ok: true, favorited: nextState };
    }

    async function _loadFulletPrompts(force = false) {
        if (_fulletLoadPromise) {
            return await _fulletLoadPromise;
        }
        if (_fulletLoaded && !_fulletHasMore && !force) return _fulletPosts;

        const offset = _fulletLoaded && !force ? _fulletNextOffset : 0;
        if (!_fulletLoaded || force) {
            _fulletPosts = [];
            _fulletNextOffset = 0;
            _fulletHasMore = true;
        }

        _fulletLoading = true;
        _updateFulletCount(_lastList.length || _fulletPosts.length);

        _fulletLoadPromise = (async () => {
            try {
                const params = new URLSearchParams({
                    limit: String(FULLET_PROMPTS_PAGE_SIZE),
                    offset: String(offset),
                });
                if (force && offset === 0) {
                    params.set("force", "1");
                }

                const r = await api.fetchApi(`/anima/fullet_prompts?${params.toString()}`);
                const data = await r.json().catch(() => ({}));
                const posts = Array.isArray(data.posts) ? data.posts : [];

                _fulletPosts = _dedupeFulletPosts([
                    ..._fulletPosts,
                    ...posts,
                ]);
                _fulletLoaded = true;
                _fulletNextOffset = offset + posts.length;
                _fulletHasMore = posts.length === FULLET_PROMPTS_PAGE_SIZE;
            } catch {
                if (!_fulletLoaded) {
                    _fulletPosts = [];
                    _fulletLoaded = true;
                }
                _fulletHasMore = false;
            } finally {
                _fulletLoading = false;
                _fulletLoadPromise = null;
            }

            return _fulletPosts;
        })();

        const result = await _fulletLoadPromise;
        _updateFulletCount(_lastList.length || result.length);
        return result;
    }

    async function _applyFullet(post, mode = "both", anchorEl = null) {
        if (!activeNode) {
            alert("Open this browser from an Anima Style Explorer node first.");
            return { ok: false };
        }

        const result = applyFulletSelection(activeNode, post, mode);
        if (!result.ok) {
            alert(result.error || "Could not apply prompt.");
            return { ok: false };
        }

        if (mode === "prompt") {
            await _copyText(buildFulletCopyText(post, "prompt"));
            showToast("Prompt applied", "success", 1500, { anchor: anchorEl });
        } else if (mode === "artist") {
            await _copyText(buildFulletCopyText(post, "artist"));
            showToast(`Applied @${String(post?.artist || "").replace(/_/g, " ")}`, "success", 1500, { anchor: anchorEl });
        } else {
            showToast("Prompt applied", "success", 1500, { anchor: anchorEl });
        }

        return { ok: true };
    }

    function _renderFulletCard(post) {
        const favKey = favoriteKeyFromItem({ kind: "fullet", id: post?.id || post?.postId });
        const isFav = favKey ? _favoriteMap.has(favKey) : false;

        return createFulletCard({
            post,
            isFav,
            onApply: async (item, mode = "both", anchorEl = null) => {
                await _applyFullet(item, mode, anchorEl);
            },
            onToggleFavorite: async (item, _btn, anchorEl = null) => {
                return await _toggleFulletFavorite(item, anchorEl);
            },
            onOpenSwipe: (item) => {
                const idx = _lastList.findIndex((x) => String(x?.id || "") === String(item?.id || ""));
                _openSwipe(idx >= 0 ? idx : 0);
            },
        });
    }

    function _build() {
        if (document.getElementById("anima-browser")) {
            el = document.getElementById("anima-browser");
            grid = el?.querySelector("#anima-grid") || null;
            countEl = el?.querySelector("#anima-count") || null;
            return;
        }

        el = document.createElement("div");
        el.id = "anima-browser";
        el.className = "hidden";
        el.innerHTML = getBrowserTemplate(SITE_BASE);

        document.body.appendChild(el);
        grid = el.querySelector("#anima-grid");
        countEl = el.querySelector("#anima-count");

        attachBrowserEvents({
            el,
            api,
            localHeaders: _localHeaders,
            ensureLocalToken: _ensureLocalToken,
            refreshAuthStatus: _refreshAuthStatus,
            getAuthPollTimer: () => _authPollTimer,
            setAuthPollTimer: (timer) => {
                _authPollTimer = timer;
            },
            setRemoteFavoritesLoaded: (value) => {
                _remoteFavoritesLoaded = !!value;
            },
            clearRemoteFavorites: () => {
                _remoteFavorites = [];
            },
            rebuildFavoriteMap: _rebuildFavoriteMap,
            getCategory: () => category,
            renderFavorites: _renderFavorites,
            getActiveNode: () => activeNode,
            getPromptWidget,
            render: _render,
            setFulletLoaded: (value) => {
                if (value) {
                    _fulletLoaded = true;
                    return;
                }
                _resetFulletPromptsFeed();
            },
            close,
            dataReset: () => Data.reset(),
            setFilter: (value) => {
                filter = value;
            },
            setSort: (value) => {
                sort = value;
            },
            setCategory: (value) => {
                category = value;
            },
            setCategoryTabs: _setCategoryTabs,
            setObserver: (observer) => {
                _observer = observer;
            },
            openSwipeFromHighlighted: async () => {
                if (!_lastList.length) await _render();
                if (!_lastList.length) return;

                let startIndex = 0;
                if (_lastHighlightedTag) {
                    const idx = _lastList.findIndex((a) => String(a?.tag || "") === _lastHighlightedTag);
                    if (idx >= 0) startIndex = idx;
                }
                await _openSwipe(startIndex);
            },
            loadLocalFavorites: _loadLocalFavorites,
        });
    }

    async function _openSwipe(startIndex) {
        if (!_lastList.length) await _render();
        if (!_lastList.length) return;

        const list = _lastList;
        const boundedStart = Math.max(0, Math.min(Number(startIndex) || 0, list.length - 1));

        Swipe.open({
            list,
            startIndex: boundedStart,
            onApply: (item) => {
                if (isFulletLike(item)) {
                    _applyFullet(item, "both");
                    return;
                }
                onPick?.(item);
                highlight(item?.tag || "");
            },
            getImageUrl: (item) => {
                if (isFulletLike(item)) {
                    return String(item?.fullImageUrl || _getFulletFullImageUrl(item) || "");
                }
                return thumbUrl(item, false);
            },
            getTitle: (item) => {
                if (isFulletLike(item)) {
                    return String(item?.artist || "").replace(/_/g, " ");
                }
                return String(item?.tag || "").replace(/_/g, " ");
            },
        });
    }

    async function _renderFullet() {
        const id = ++_renderId;
        _detachFulletScrollHandler();

        if (!_remoteEnabled) {
            countEl.textContent = "internet required";
            _lastList = [];
            renderRemoteGate(grid, async () => {
                _remoteEnabled = true;
                _safeSessionSet("anima_remote_enabled", "true");
                _resetFulletPromptsFeed();
                _remoteFavoritesLoaded = false;
                await _render();
            });
            return;
        }

        if (!_fulletLoaded) {
            grid.innerHTML = `<div class="anima-empty"><div class="anima-spinner"></div><span>Loading Fullet prompts...</span></div>`;
            await _loadFulletPrompts();
            if (id !== _renderId) return;
        }

        const list = buildFulletList(_fulletPosts, filter);
        _updateFulletCount(list.length);
        _lastList = list.map((item) => _decorateFulletItem(item));

        el.querySelector(".body").scrollTop = 0;

        if (!list.length) {
            if (_observer) _observer.disconnect();
            grid.innerHTML = `<div class="anima-empty"><span>No prompts found.</span></div>`;
            if (_fulletHasMore) {
                _bindFulletInfiniteScroll(id);
            }
            return;
        }

        renderChunkedGrid({
            grid,
            observer: _observer,
            items: _lastList,
            chunkSize: 40,
            minHeight: "420px",
            renderItem: (item) => _renderFulletCard(item),
        });

        _bindFulletInfiniteScroll(id);
    }

    async function _renderFavorites() {
        _detachFulletScrollHandler();
        const id = ++_renderId;
        grid.innerHTML = `<div class="anima-empty"><div class="anima-spinner"></div><span>Loading favorites...</span></div>`;

        await _loadLocalFavorites();
        if (_authConnected && _remoteEnabled) {
            await _loadRemoteFavorites();
        } else {
            _remoteFavorites = [];
            _remoteFavoritesLoaded = true;
            _rebuildFavoriteMap();
        }

        if (id !== _renderId) return;

        const artists = await Data.all();
        if (id !== _renderId) return;

        const list = buildFavoritesList({
            artists,
            localFavorites: _localFavorites,
            remoteFavorites: _remoteFavorites,
            filter,
        });

        countEl.textContent = `${list.length} favorites`;
        _lastList = list.map((item) => (isFulletLike(item)
            ? { ...item, displayImageUrl: _getFulletDisplayImageUrl(item), fullImageUrl: _getFulletFullImageUrl(item) }
            : item));

        el.querySelector(".body").scrollTop = 0;

        if (!list.length) {
            if (_observer) _observer.disconnect();
            grid.innerHTML = `<div class="anima-empty"><span>No favorites yet.</span></div>`;
            return;
        }

        renderChunkedGrid({
            grid,
            observer: _observer,
            items: _lastList,
            chunkSize: 60,
            minHeight: "420px",
            renderItem: (item) => {
                if (isFulletLike(item)) return _renderFulletCard(item);
                return _card(item);
            },
        });
    }

    async function _render() {
        _detachFulletScrollHandler();
        if (category === "fullet") return _renderFullet();
        if (category === "favorites") return _renderFavorites();

        const id = ++_renderId;
        grid.innerHTML = `<div class="anima-empty"><div class="anima-spinner"></div><span>Loading styles...</span></div>`;
        const full = await Data.all();
        if (id !== _renderId) return;

        const list = buildStyleList(full, { sort, filter });
        countEl.textContent = `${list.length} styles`;
        _lastList = list.map((item) => (isFulletLike(item)
            ? { ...item, displayImageUrl: _getFulletDisplayImageUrl(item), fullImageUrl: _getFulletFullImageUrl(item) }
            : item));

        el.querySelector(".body").scrollTop = 0;

        renderChunkedGrid({
            grid,
            observer: _observer,
            items: list,
            chunkSize: 100,
            minHeight: "400px",
            renderItem: (item) => _card(item),
        });
    }

    function _card(artist) {
        const url = thumbUrl(artist, false);
        const isUniq = sort === "uniqueness";
        const isFav = _isFavorited({ kind: "style", tag: artist.tag });

        return createStyleCard({
            artist,
            imageUrl: url,
            isUniq,
            isFav,
            onApply: (selectedArtist, anchorEl = null) => {
                onPick?.(selectedArtist);
                highlight(selectedArtist.tag);
                showToast(`Applied @${String(selectedArtist?.tag || "").replace(/_/g, " ")}`, "success", 1500, { anchor: anchorEl });
            },
            onToggleFavorite: async (selectedArtist, _btn, anchorEl = null) => {
                return await _toggleStyleFavorite(selectedArtist, anchorEl);
            },
            onOpenSwipe: (selectedArtist) => {
                const idx = _lastList.findIndex((x) => x.tag === selectedArtist.tag);
                _openSwipe(idx >= 0 ? idx : 0);
            },
        });
    }

    function highlight(tag) {
        _lastHighlightedTag = tag || "";
        grid.querySelectorAll(".anima-card.selected").forEach((card) => card.classList.remove("selected"));
        if (!tag) return;
        const escaped = CSS.escape(tag);
        grid.querySelector(`.anima-card[data-tag="${escaped}"]`)?.classList.add("selected");
    }

    async function open(cb, node = null) {
        _build();
        onPick = cb;
        activeNode = node || null;
        _remoteEnabled = _safeSessionGet("anima_remote_enabled", "false") === "true";
        _remoteFavoritesLoaded = false;
        el.classList.remove("hidden");
        el.querySelector(".cycle-search input").focus();
        await _ensureLocalToken();
        await _refreshAuthStatus();
        await _loadLocalFavorites();
        await _render();
    }

    function close() {
        Swipe.close();
        _detachFulletScrollHandler();
        el?.classList.add("hidden");
    }

    function cycleBtn() { return document.getElementById("anima-cycle-btn"); }
    function cycleStatus() { return document.getElementById("anima-cycle-status"); }

    return { open, close, cycleBtn, cycleStatus, highlight };
})();




