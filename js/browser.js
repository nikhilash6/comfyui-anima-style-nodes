import { api } from "../../scripts/api.js";
import { SITE_BASE } from "./config.js";
import { Data } from "./data.js";
import { thumbUrl } from "./utils.js";

let CUSTOM_STYLES = [];
api.fetchApi("/anima/custom_styles")
    .then(r => r.json())
    .then(d => { CUSTOM_STYLES = d; })
    .catch(() => { console.warn("Could not load custom styles from backend"); });

export const Browser = (() => {
    let el, grid, countEl, onPick;
    let filter = "", sort = "works", category = "all", _renderId = 0, _observer;

    function _build() {
        if (document.getElementById("anima-browser")) return;
        el = document.createElement("div");
        el.id = "anima-browser";
        el.className = "hidden";
        el.innerHTML = `
            <div class="backdrop"></div>
            <div class="window">
                <div class="hdr">
                    <span class="hdr-title" style="margin-right:4px">Anima Style Explorer</span>
                    <button class="hdr-btn-txt" id="anima-cat-all" style="margin-left:8px; opacity:1;">All Styles</button>
                    <button class="hdr-btn-txt" id="anima-cat-custom" style="opacity:0.5;">Custom Styles</button>
                    <select class="hdr-select" style="margin-left:8px">
                        <option value="works">Popularity</option>
                        <option value="name">A – Z</option>
                    </select>
                    <div class="hdr-gap"></div>
                    <div class="hdr-data-btns">
                        <button class="hdr-btn-txt" id="anima-update-styles">Update Styles</button>
                        <div class="hdr-toggle-wrap" title="Toggle between local images and original web images">
                            <span class="hdr-toggle-label">view imagenes</span>
                            <label class="hdr-switch">
                                <input type="checkbox" id="anima-online-toggle"/>
                                <span class="hdr-slider"></span>
                            </label>
                            <span class="hdr-toggle-hint" style="color: #8080ff; opacity: 0.9; font-weight: 500;">(with internet)</span>
                        </div>
                        <button class="hdr-btn-txt" id="anima-dl-images">Download Previews</button>
                        <button class="hdr-btn" id="anima-refresh" title="Refresh Styles">&#8635;</button>
                    </div>
                    <button class="hdr-close" title="Close" style="margin-left:8px">&#10005;</button>
                </div>
                <div class="cycle-bar">
                    <span class="cycle-label">Auto Cycle</span>
                    <button class="anima-play-btn" id="anima-cycle-btn">
                        <span class="btn-icon">&#9654;</span>
                        <span class="btn-lbl">Play</span>
                    </button>
                    <span class="anima-cycle-status" id="anima-cycle-status">stopped</span>
                    <div class="cycle-search">
                        <i>@</i>
                        <input type="text" placeholder="Search artists..." autocomplete="off" spellcheck="false"/>
                    </div>
                    <div class="cycle-gap"></div>
                    <span class="cycle-hint">Automatically queues prompts to test styles in a continuous loop</span>
                </div>
                <div class="body">
                    <div class="anima-grid" id="anima-grid">
                        <div class="anima-empty"><div class="anima-spinner"></div><span>Loading styles...</span></div>
                    </div>
                </div>
                <div class="ftr">
                    <span class="ftr-count" id="anima-count"></span>
                    <span class="ftr-count"> | </span>
                    <span class="ftr-count">Node created by <a href="https://github.com/fulletLab" target="_blank" style="color:#d0d0e0;text-decoration:none;font-weight:600">fulletLab</a></span>
                    <div class="ftr-gap"></div>
                    <a class="ftr-link" href="${SITE_BASE}" target="_blank" rel="noopener">thetacursed.github.io/Anima-Style-Explorer ↗</a>
                </div>
            </div>
        `;
        document.body.appendChild(el);
        grid = el.querySelector("#anima-grid");
        countEl = el.querySelector("#anima-count");

        const onlineToggle = el.querySelector("#anima-online-toggle");
        onlineToggle.checked = localStorage.getItem("anima_online") === "true";
        onlineToggle.addEventListener("change", e => {
            localStorage.setItem("anima_online", e.target.checked);
            _render();
        });

        const dlBtn = el.querySelector("#anima-dl-images");
        dlBtn.addEventListener("click", async () => {
            if (dlBtn.classList.contains("disabled")) return;
            try {
                const r = await api.fetchApi("/anima/download_images", { method: "POST" });
                const res = await r.json();
                if (res.success) _pollDownload();
                else alert("Download already in progress or failed to start.");
            } catch (err) { }
        });

        async function _pollDownload() {
            dlBtn.classList.add("disabled");
            const r = await api.fetchApi("/anima/download_status");
            const s = await r.json();
            if (s.active) {
                dlBtn.textContent = `Downloading ${s.done}/${s.total}...`;
                setTimeout(_pollDownload, 1000);
            } else {
                dlBtn.textContent = "Download Complete!";
                dlBtn.classList.remove("disabled");
                setTimeout(() => { dlBtn.textContent = "Download Previews (~25MB)"; }, 3000);
                _render();
            }
        }

        el.querySelector(".backdrop").addEventListener("click", close);
        el.querySelector(".hdr-close").addEventListener("click", close);
        document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });

        el.querySelector("#anima-refresh").addEventListener("click", async (e) => {
            const btn = e.currentTarget;
            const oldHtml = btn.innerHTML;
            btn.innerHTML = `<div class="anima-spinner" style="width:14px;height:14px;border-width:2px"></div>`;
            btn.style.pointerEvents = "none";
            try {
                const resp = await api.fetchApi("/anima/update", { method: "POST" });
                const res = await resp.json();
                if (res.success) {
                    Data.reset();
                    _render();
                }
            } catch (err) { }
            btn.innerHTML = oldHtml;
            btn.style.pointerEvents = "auto";
        });
        let searchTo;
        el.querySelector(".cycle-search input").addEventListener("input", e => {
            clearTimeout(searchTo);
            searchTo = setTimeout(() => {
                filter = e.target.value.replace(/^@/, "");
                _render();
            }, 150);
        });

        const updateBtn = el.querySelector("#anima-update-styles");
        updateBtn.addEventListener("click", async () => {
            if (updateBtn.classList.contains("disabled")) return;
            const oldHtml = updateBtn.innerHTML;
            updateBtn.innerHTML = `Updating...`;
            updateBtn.classList.add("disabled");
            try {
                const resp = await api.fetchApi("/anima/update", { method: "POST" });
                const res = await resp.json();
                if (res.success) {
                    Data.reset();
                    _render();
                    updateBtn.innerHTML = "Success!";
                } else {
                    updateBtn.innerHTML = "Failed!";
                }
            } catch (err) { updateBtn.innerHTML = "Error!"; }
            setTimeout(() => {
                updateBtn.innerHTML = "Update Styles";
                updateBtn.classList.remove("disabled");
            }, 2000);
        });
        el.querySelector(".hdr-select").addEventListener("change", e => { sort = e.target.value; _render(); });

        el.querySelector("#anima-cat-all").addEventListener("click", e => {
            category = "all";
            e.target.style.opacity = "1";
            el.querySelector("#anima-cat-custom").style.opacity = "0.5";
            _render();
        });

        el.querySelector("#anima-cat-custom").addEventListener("click", e => {
            category = "custom";
            e.target.style.opacity = "1";
            el.querySelector("#anima-cat-all").style.opacity = "0.5";
            _render();
        });

        _observer = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) e.target._mount?.();
                else e.target._unmount?.();
            });
        }, { root: el.querySelector(".body"), rootMargin: "400px" });
    }

    async function _render() {
        const id = ++_renderId;
        grid.innerHTML = `<div class="anima-empty"><div class="anima-spinner"></div><span>Loading styles...</span></div>`;
        let list = await Data.search(filter);
        if (id !== _renderId) return;

        if (category === "custom") {
            list = list.filter(a => CUSTOM_STYLES.includes(a.tag));
        }

        if (sort === "name") list = [...list].sort((a, b) => a.tag.localeCompare(b.tag));
        else list = [...list].sort((a, b) => (b.works || 0) - (a.works || 0));

        countEl.textContent = `${list.length} styles`;

        if (_observer) _observer.disconnect();
        grid.innerHTML = "";
        el.querySelector(".body").scrollTop = 0;

        const CHUNK_SIZE = 100;
        for (let i = 0; i < list.length; i += CHUNK_SIZE) {
            const chunkItems = list.slice(i, i + CHUNK_SIZE);
            const chunk = document.createElement("div");
            chunk.className = "anima-chunk";
            chunk.style.minHeight = "400px";
            chunk._mount = () => {
                if (chunk.children.length) return;
                const frag = document.createDocumentFragment();
                chunkItems.forEach(item => frag.appendChild(_card(item)));
                chunk.appendChild(frag);
                chunk.style.minHeight = "";
            };
            chunk._unmount = () => {
                if (!chunk.children.length) return;
                chunk.style.minHeight = chunk.offsetHeight + "px";
                chunk.innerHTML = "";
            };
            grid.appendChild(chunk);
            _observer.observe(chunk);
        }
    }

    function _card(a) {
        const card = document.createElement("div");
        card.className = "anima-card";
        card.dataset.tag = a.tag;
        const useCustom = category === "custom";
        const url = thumbUrl(a, useCustom);
        card.innerHTML = `
            <div class="anima-card-img" data-init="${(a.tag[0] || "?").toUpperCase()}">
                <img loading="lazy" src="${url}" alt="${a.tag}"
                     onerror="this.style.display='none';this.parentElement.classList.add('no-img')"/>
                <div class="anima-card-overlay">
                    <button class="anima-card-pick">Apply</button>
                </div>
            </div>
            <div class="anima-card-meta">
                <span class="anima-card-tag" title="@${a.tag.replace(/_/g, " ")}">@${a.tag.replace(/_/g, " ")}</span>
                ${a.works ? `<span class="anima-card-works">${Number(a.works).toLocaleString()} works</span>` : ""}
            </div>
        `;

        card.addEventListener("mouseenter", () => {
            const img = card.querySelector("img");
            if (img && (!img.complete || img.naturalWidth === 0)) {
                img.src = url + "?t=" + Date.now();
            }
        }, { once: true });

        const pick = () => { onPick?.(a); highlight(a.tag); };
        card.querySelector(".anima-card-pick").addEventListener("click", e => { e.stopPropagation(); pick(); });
        card.addEventListener("click", pick);
        return card;
    }

    function highlight(tag) {
        grid.querySelectorAll(".anima-card.selected").forEach(c => c.classList.remove("selected"));
        const escaped = CSS.escape(tag);
        grid.querySelector(`.anima-card[data-tag="${escaped}"]`)?.classList.add("selected");
    }

    function open(cb) {
        _build();
        onPick = cb;
        el.classList.remove("hidden");
        el.querySelector(".cycle-search input").focus();
        _render();
    }

    function close() { el?.classList.add("hidden"); }
    function cycleBtn() { return document.getElementById("anima-cycle-btn"); }
    function cycleStatus() { return document.getElementById("anima-cycle-status"); }

    return { open, close, cycleBtn, cycleStatus, highlight };
})();
