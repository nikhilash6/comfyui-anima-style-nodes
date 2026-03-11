import { createUploadPicker } from "./browser_upload_picker.js";

export function attachBrowserEvents({
    el,
    api,
    localHeaders,
    ensureLocalToken,
    refreshAuthStatus,
    getAuthPollTimer,
    setAuthPollTimer,
    setRemoteFavoritesLoaded,
    clearRemoteFavorites,
    rebuildFavoriteMap,
    getCategory,
    renderFavorites,
    getActiveNode,
    getPromptWidget,
    render,
    setFulletLoaded,
    close,
    dataReset,
    setFilter,
    setSort,
    setCategory,
    setCategoryTabs,
    setObserver,
    openSwipeFromHighlighted,
    loadLocalFavorites,
}) {
    const onlineToggle = el.querySelector("#anima-online-toggle");
    if (localStorage.getItem("anima_online") === null) {
        localStorage.setItem("anima_online", "true");
    }
    onlineToggle.checked = localStorage.getItem("anima_online") === "true";
    onlineToggle.addEventListener("change", (e) => {
        localStorage.setItem("anima_online", e.target.checked);
        render();
    });

    const keepSessionToggle = el.querySelector("#anima-keep-session");
    if (localStorage.getItem("anima_keep_session") === null) {
        localStorage.setItem("anima_keep_session", "false");
    }
    keepSessionToggle.checked = localStorage.getItem("anima_keep_session") === "true";

    const ensureHeadersReady = async () => {
        const ok = await ensureLocalToken();
        if (!ok) {
            throw new Error("Local security token not available. Reopen the browser and try again.");
        }
        return localHeaders();
    };

    const syncSessionMode = async (persistent) => {
        const headers = await ensureHeadersReady();
        await api.fetchApi("/anima/fullet_session_mode", {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ persistent: !!persistent }),
        });
    };

    const disconnectLocalSession = async () => {
        const headers = await ensureHeadersReady();
        await api.fetchApi("/anima/fullet_disconnect", { method: "POST", headers });
        clearRemoteFavorites();
        setRemoteFavoritesLoaded(false);
        rebuildFavoriteMap();
    };

    const uploadPicker = createUploadPicker({
        root: el,
        api,
        localHeaders,
        ensureLocalToken,
        refreshAuthStatus,
    });

    const closeBrowser = () => {
        uploadPicker.close();
        close();
    };

    keepSessionToggle.addEventListener("change", async (e) => {
        const enabled = !!e.target.checked;
        localStorage.setItem("anima_keep_session", enabled ? "true" : "false");
        try {
            await syncSessionMode(enabled);
        } catch (err) {
            alert(err?.message || "Could not update session mode.");
        }
        await refreshAuthStatus({ syncPending: false });
        if (getCategory() === "favorites") await renderFavorites();
    });

    el.querySelector("#anima-fullet-connect").addEventListener("click", async () => {
        let connectUrl = "";
        try {
            await syncSessionMode(keepSessionToggle.checked);
            const origin = encodeURIComponent(window.location.origin || "");
            const r = await api.fetchApi(`/anima/fullet_auth_start?origin=${origin}`, { headers: await ensureHeadersReady() });
            const payload = await r.json().catch(() => ({}));
            if (!r.ok || !payload?.url) {
                const message = payload?.error || `Could not start auth flow (${r.status})`;
                alert(message);
                return;
            }
            connectUrl = payload.url;
        } catch (err) {
            alert(`Could not start auth flow: ${err?.message || "unknown error"}`);
            return;
        }

        window.open(connectUrl, "anima-fullet-auth", "width=620,height=760,resizable=yes,scrollbars=yes");
        await refreshAuthStatus();
        setRemoteFavoritesLoaded(false);
        let ticks = 0;

        const prevTimer = getAuthPollTimer();
        if (prevTimer) clearInterval(prevTimer);

        const timer = setInterval(async () => {
            ticks += 1;
            await refreshAuthStatus();
            if (ticks > 120) {
                clearInterval(timer);
                setAuthPollTimer(null);
            }
        }, 1000);
        setAuthPollTimer(timer);
    });

    el.querySelector("#anima-fullet-disconnect").addEventListener("click", async () => {
        uploadPicker.close();
        try {
            await disconnectLocalSession();
        } catch (err) {
            alert(err?.message || "Could not disconnect.");
        }
        await refreshAuthStatus({ syncPending: false });
        if (getCategory() === "favorites") await renderFavorites();
    });

    const uploadBtn = el.querySelector("#anima-fullet-upload");
    uploadBtn.addEventListener("click", async () => {
        if (uploadBtn.classList.contains("disabled")) {
            alert("Connect your Fullet account first.");
            return;
        }

        try {
            await ensureHeadersReady();
            await uploadPicker.open();
        } catch (err) {
            alert(err?.message || "Could not open upload picker.");
        }
    });

    const dlBtn = el.querySelector("#anima-dl-images");
    dlBtn.addEventListener("click", async () => {
        if (dlBtn.classList.contains("disabled")) return;
        const ok = confirm(
            "This will download preview images for up to 20,000 styles.\n\n"
            + "It can take a long time and may use hundreds of MB.\n\n"
            + "Continue?"
        );
        if (!ok) return;

        try {
            const r = await api.fetchApi("/anima/download_images", { method: "POST", headers: localHeaders() });
            const res = await r.json();
            if (res.success) {
                const pollDownload = async () => {
                    dlBtn.classList.add("disabled");
                    const statusResponse = await api.fetchApi("/anima/download_status");
                    const s = await statusResponse.json();
                    if (s.active) {
                        dlBtn.textContent = `Downloading ${s.done}/${s.total}...`;
                        setTimeout(pollDownload, 1000);
                    } else {
                        dlBtn.textContent = "Download Complete!";
                        dlBtn.classList.remove("disabled");
                        setTimeout(() => { dlBtn.textContent = "Download Previews"; }, 3000);
                        render();
                    }
                };
                pollDownload();
            } else {
                alert("Download already in progress or failed to start.");
            }
        } catch { }
    });

    el.querySelector(".backdrop").addEventListener("click", closeBrowser);
    el.querySelector(".hdr-close").addEventListener("click", closeBrowser);
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        if (uploadPicker.isOpen()) {
            uploadPicker.close();
            return;
        }
        closeBrowser();
    });

    el.querySelector("#anima-refresh").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        const oldHtml = btn.innerHTML;
        btn.innerHTML = `<div class="anima-spinner" style="width:14px;height:14px;border-width:2px"></div>`;
        btn.style.pointerEvents = "none";
        try {
            if (getCategory() === "fullet") {
                setFulletLoaded(false);
                await api.fetchApi("/anima/fullet_prompts?limit=1&offset=0&force=1");
                await render();
            } else {
                const resp = await api.fetchApi("/anima/update", { method: "POST", headers: localHeaders() });
                const res = await resp.json();
                if (res.success) {
                    dataReset();
                    setFulletLoaded(false);
                    await render();
                }
            }
        } catch { }
        btn.innerHTML = oldHtml;
        btn.style.pointerEvents = "auto";
    });

    let searchTo;
    el.querySelector(".cycle-search input").addEventListener("input", (e) => {
        clearTimeout(searchTo);
        searchTo = setTimeout(() => {
            setFilter(e.target.value.replace(/^@/, ""));
            render();
        }, 150);
    });

    const updateBtn = el.querySelector("#anima-update-styles");
    updateBtn.addEventListener("click", async () => {
        if (updateBtn.classList.contains("disabled")) return;
        updateBtn.innerHTML = "Updating...";
        updateBtn.classList.add("disabled");
        try {
            const resp = await api.fetchApi("/anima/update", { method: "POST", headers: localHeaders() });
            const res = await resp.json();
            if (res.success) {
                dataReset();
                render();
                updateBtn.innerHTML = "Success!";
            } else {
                updateBtn.innerHTML = "Failed!";
            }
        } catch {
            updateBtn.innerHTML = "Error!";
        }
        setTimeout(() => {
            updateBtn.innerHTML = "Update Styles";
            updateBtn.classList.remove("disabled");
        }, 2000);
    });

    el.querySelector(".hdr-select").addEventListener("change", (e) => {
        setSort(e.target.value);
        render();
    });

    const swipeBtn = el.querySelector("#anima-swipe-btn");
    swipeBtn?.addEventListener("click", async () => {
        await openSwipeFromHighlighted();
    });

    el.querySelector("#anima-cat-all").addEventListener("click", () => {
        setCategory("all");
        setCategoryTabs();
        render();
    });

    el.querySelector("#anima-cat-fullet").addEventListener("click", async () => {
        setCategory("fullet");
        setCategoryTabs();
        await render();
    });

    el.querySelector("#anima-cat-favorites").addEventListener("click", async () => {
        setCategory("favorites");
        setCategoryTabs();
        await render();
    });

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) entry.target._mount?.();
            else entry.target._unmount?.();
        });
    }, { root: el.querySelector(".body"), rootMargin: "400px" });
    setObserver(observer);

    setCategoryTabs();
    (async () => {
        await loadLocalFavorites();
    })();
}
