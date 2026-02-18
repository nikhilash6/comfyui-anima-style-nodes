import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const SITE_BASE = "https://thetacursed.github.io/Anima-Style-Explorer";
const CACHE_KEY = "anima_v3";
const CACHE_TTL = 86_400_000;
const EXT_BASE = import.meta.url.substring(0, import.meta.url.lastIndexOf("/") + 1);

function thumbUrl(artist) {
    const isOnline = localStorage.getItem("anima_online") === "true";
    if (!isOnline) {
        return `/anima/images/${artist.p}/${artist.id}.webp`;
    }
    return `${SITE_BASE}/images/${artist.p}/${artist.id}.webp`;
}

const Data = (() => {
    let _promise = null;

    async function _load() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                const { ts, list } = JSON.parse(raw);
                if (Date.now() - ts < CACHE_TTL) return list;
            }
        } catch (_) { }

        try {
            const r = await fetch("/anima/artists");
            if (r.ok) {
                const list = await r.json();
                _persist(list);
                return list;
            }
        } catch (_) { }

        return [];
    }

    function _persist(list) {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), list })); } catch (_) { }
    }

    function all() { return _promise || (_promise = _load()); }
    function reset() { _promise = null; localStorage.removeItem(CACHE_KEY); }

    async function search(q, max = 5000) {
        const list = await all();
        if (!q) return list.slice(0, max);
        const lq = q.toLowerCase();
        return list.filter(a =>
            a.tag.toLowerCase().includes(lq) ||
            a.name?.toLowerCase().includes(lq)
        ).slice(0, max);
    }

    async function random() {
        const list = await all();
        return list.length ? list[Math.floor(Math.random() * list.length)] : null;
    }

    return { all, reset, search, random };
})();

function getPromptWidget(node) {
    return node.widgets?.find(w =>
        w.name === "text" ||
        w.name === "prompt" ||
        w.type === "customtext" ||
        (w.type === "STRING" && w.inputEl)
    ) ?? null;
}

function injectTag(current, tag) {
    const spaceTag = tag ? tag.replace(/_/g, " ") : "";
    const cleaned = current.replace(/^\s*@[^,]+,?\s?/, "").trim();
    return spaceTag ? (cleaned ? `@${spaceTag}, ${cleaned}` : `@${spaceTag}`) : (cleaned || "");
}

function applyStyle(node, artist) {
    const w = getPromptWidget(node);
    if (!w) return;
    const tag = artist.tag;
    const newVal = injectTag(String(w.value || ""), tag);

    w.value = newVal;
    if (w.inputEl) {
        w.inputEl.value = newVal;
        w.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        w.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (w.callback) w.callback(newVal);

    node._currentTag = tag;
    const badge = document.getElementById("anima-badge");
    if (badge) {
        const displayTag = tag.replace(/_/g, " ");
        badge.textContent = `@${displayTag}`;
        badge.style.display = "block";
    }
    node.setDirtyCanvas?.(true, true);
    app.graph.setDirtyCanvas?.(true, true);
}

function injectCSS() {
    if (document.getElementById("anima-css")) return;
    const s = document.createElement("style");
    s.id = "anima-css";
    s.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');

#anima-browser { position:fixed; inset:0; z-index:99998; display:flex; align-items:center; justify-content:center; font-family:'Inter',sans-serif; }
#anima-browser.hidden { display:none; }
#anima-browser .backdrop { position:absolute; inset:0; background:rgba(0,0,0,.8); backdrop-filter:blur(10px); }
#anima-browser .window { position:relative; z-index:1; width:min(96vw,1160px); height:min(93vh,880px); background:#0b0b0f; border:1px solid #1e1e28; border-radius:14px; display:flex; flex-direction:column; overflow:hidden; box-shadow:0 40px 100px #000c; animation:anima-in .2s cubic-bezier(.22,1,.36,1); }
@keyframes anima-in { from{opacity:0;transform:translateY(16px) scale(.97)} to{opacity:1;transform:none} }

#anima-browser .hdr { display:flex; align-items:center; gap:8px; padding:11px 14px; border-bottom:1px solid #16161e; flex-shrink:0; }
#anima-browser .hdr-title { font-size:13px; font-weight:600; color:#c0c0d0; letter-spacing:.02em; white-space:nowrap; }
#anima-browser .hdr-pill { background:#141420; border:1px solid #1e1e30; color:#707090; font-size:9.5px; font-family:'JetBrains Mono',monospace; padding:2px 7px; border-radius:20px; }
#anima-browser .hdr-gap { flex:1; }
#anima-browser .search-wrap { position:relative; flex:1; max-width:300px; }
#anima-browser .search-icon { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:#2e2e42; font-size:11px; pointer-events:none; font-style:normal; font-family:'JetBrains Mono',monospace; }
#anima-browser .search-input { width:100%; padding:7px 10px 7px 27px; background:#0f0f16; border:1px solid #1e1e2c; border-radius:7px; color:#a0a0bc; font-family:'JetBrains Mono',monospace; font-size:12px; outline:none; transition:border-color .15s; box-sizing:border-box; }
#anima-browser .search-input::placeholder { color:#26263a; }
#anima-browser .search-input:focus { border-color:#343450; }
#anima-browser .hdr-select { padding:6px 8px; background:#0f0f16; border:1px solid #1e1e2c; border-radius:7px; color:#606080; font-size:11px; cursor:pointer; outline:none; }
#anima-browser .hdr-btn { width:29px; height:29px; display:flex; align-items:center; justify-content:center; background:#0f0f16; border:1px solid #1e1e2c; border-radius:7px; color:#404058; cursor:pointer; font-size:13px; transition:all .12s; flex-shrink:0; }
#anima-browser .hdr-btn:hover { background:#161624; color:#9090b0; }
#anima-browser .hdr-close { width:29px; height:29px; display:flex; align-items:center; justify-content:center; background:transparent; border:1px solid #28181a; border-radius:7px; color:#583040; cursor:pointer; font-size:13px; transition:all .12s; flex-shrink:0; }
#anima-browser .hdr-close:hover { background:#241010; border-color:#4a2020; color:#c05060; }

#anima-browser .cycle-bar { display:flex; align-items:center; gap:8px; padding:7px 14px; border-bottom:1px solid #13131a; background:#0d0d12; flex-shrink:0; }
#anima-browser .cycle-label { font-size:10.5px; color:#c0c0d0; font-family:'JetBrains Mono',monospace; white-space:nowrap; }
.anima-play-btn { display:flex; align-items:center; gap:5px; padding:5px 14px; border-radius:6px; cursor:pointer; font-family:'Inter',sans-serif; font-size:11px; font-weight:600; border:1px solid #1e3020; background:#121a12; color:#70a070; transition:all .15s; white-space:nowrap; }
.anima-play-btn:hover { background:#162016; border-color:#2a4030; color:#90c090; }
.anima-play-btn.running { background:#1e1010; border-color:#4a2020; color:#a05060; }
.anima-cycle-status { font-size:10.5px; color:#a0a0bc; font-family:'JetBrains Mono',monospace; }
.anima-cycle-status.active { color:#a0c0a0; }
#anima-browser .cycle-gap { flex:1; }
#anima-browser .cycle-search { position:relative; width:220px; margin-left:12px; }
#anima-browser .cycle-search i { position:absolute; left:8px; top:50%; transform:translateY(-50%); color:#2e2e42; font-size:10px; font-family:'JetBrains Mono',monospace; font-style:normal; pointer-events:none; }
#anima-browser .cycle-search input { width:100%; padding:5px 8px 5px 22px; background:#0a0a0f; border:1px solid #1a1a24; border-radius:6px; color:#a0a0bc; font-size:11px; font-family:'JetBrains Mono',monospace; outline:none; transition:border-color .15s; }
#anima-browser .cycle-search input:focus { border-color:#343450; }
#anima-browser .cycle-hint { font-size:9.5px; color:#505070; font-family:'JetBrains Mono',monospace; opacity:0.6; }

#anima-browser .body { flex:1; overflow-y:auto; padding:12px; scrollbar-width:thin; scrollbar-color:#1c1c28 transparent; }
#anima-browser .body::-webkit-scrollbar { width:5px; }
#anima-browser .body::-webkit-scrollbar-thumb { background:#1c1c28; border-radius:3px; }

.anima-grid { }
.anima-chunk { display:grid; grid-template-columns:repeat(auto-fill,minmax(142px,1fr)); gap:7px; width:100%; contain:content; }
.anima-empty { grid-column:1/-1; display:flex; flex-direction:column; align-items:center; gap:10px; padding:60px; color:#222230; font-size:12px; }
#anima-browser .hdr-btn:hover { background:#1e1e2c; color:#fff; border-color:#4a4a6a; }
#anima-browser .hdr-btn-txt { background:#151525; border:1px solid #2a2a40; color:#8080a0; font-family:'Inter',sans-serif; font-size:10px; font-weight:600; padding:6px 12px; border-radius:6px; cursor:pointer; transition:all .15s; margin-right:4px; }
#anima-browser .hdr-btn-txt:hover { background:#1c1c30; border-color:#4a4a6a; color:#c0c0e0; }
#anima-browser .hdr-btn-txt.disabled { opacity:0.5; pointer-events:none; }

.hdr-toggle-wrap { display:flex; align-items:center; gap:8px; margin-right:8px; background: #0f0f16; padding: 4px 10px; border-radius: 8px; border: 1px solid #1a1a24; }
.hdr-toggle-label { font-size:10.5px; font-weight:600; color:#8080a0; text-transform:lowercase; letter-spacing:0.2px; background: #1a1a2c; padding: 3px 8px; border-radius: 5px; border: 1px solid #2a2a40; margin-right: 4px; }
.hdr-toggle-hint { font-size:9.5px; color:#404050; font-family:'JetBrains Mono',monospace; margin-left: 4px; }

.hdr-switch { position:relative; display:inline-block; width:30px; height:18px; transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
.hdr-switch input { opacity:0; width:0; height:0; }
.hdr-slider { position:absolute; cursor:pointer; inset:0; background-color:#141420; transition:.2s; border-radius:34px; border:1px solid #22223a; }
.hdr-slider:before { position:absolute; content:""; height:10px; width:10px; left:2px; bottom:2px; background-color:#3a3a55; transition:.2s; border-radius:50%; }
.hdr-switch:hover { transform: scale(1.15); }
input:checked + .hdr-slider { background-color:#1e1e35; border-color:#3a3a5a; }
input:checked + .hdr-slider:before { transform:translateX(12px); background-color:#8080ff; box-shadow:0 0 8px #5050ff80; }

.hdr-data-btns { display:flex; align-items:center; gap:6px; margin-left:12px; border-left:1px solid #1a1a24; padding-left:12px; }

.anima-spinner { width:24px; height:24px; border:2px solid #181824; border-top-color:#363650; border-radius:50%; animation:anima-spin .6s linear infinite; }
@keyframes anima-spin { to { transform:rotate(360deg); } }

.anima-card { border-radius:8px; overflow:hidden; background:#0e0e14; border:1px solid #191922; cursor:pointer; transition:transform .15s,border-color .15s,box-shadow .15s; }
.anima-card:hover { transform:translateY(-2px); border-color:#2e2e48; box-shadow:0 6px 20px #0009; }
.anima-card.selected { border-color:#384838; box-shadow:0 0 0 2px #202e20; }
.anima-card-img { position:relative; aspect-ratio:1; overflow:hidden; background:#0c0c12; }
.anima-card-img img { width:100%; height:100%; object-fit:cover; display:block; transition:transform .25s; }
.anima-card:hover .anima-card-img img { transform:scale(1.06); }
.anima-card-img.no-img { display:flex; align-items:center; justify-content:center; }
.anima-card-img.no-img::after { content:attr(data-init); font-family:'JetBrains Mono',monospace; font-size:26px; font-weight:700; color:#1c1c28; text-transform:uppercase; }
.anima-card-overlay { position:absolute; inset:0; background:rgba(0,0,0,.65); display:flex; align-items:center; justify-content:center; opacity:0; transition:opacity .18s; }
.anima-card:hover .anima-card-overlay { opacity:1; }
.anima-card-pick { background:#101020; border:1px solid #282840; color:#8080a8; font-family:'Inter',sans-serif; font-weight:500; font-size:11px; padding:6px 13px; border-radius:6px; cursor:pointer; transition:all .12s; }
.anima-card-pick:hover { background:#181830; border-color:#404060; color:#b0b0d0; }
.anima-card-meta { padding:6px 8px 8px; }
.anima-card-tag { display:block; font-size:10px; font-weight:500; font-family:'JetBrains Mono',monospace; color:#d0d0e0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.anima-card-works { display:block; font-size:9px; color:#8080a8; font-family:'JetBrains Mono',monospace; margin-top:2px; }

#anima-browser .ftr { display:flex; align-items:center; gap:10px; padding:8px 14px; border-top:1px solid #13131a; flex-shrink:0; }
#anima-browser .ftr-count { font-size:10px; font-family:'JetBrains Mono',monospace; color:#9090b0; }
#anima-browser .ftr-gap { flex:1; }
#anima-browser .ftr-link { font-size:10px; font-family:'JetBrains Mono',monospace; color:#c0c0d0; text-decoration:none; transition:color .12s; }
#anima-browser .ftr-link:hover { color:#606080; }

#anima-ac { position:fixed; z-index:99999; background:#0d0d14; border:1px solid #1e1e2c; border-radius:8px; overflow:hidden; max-height:260px; overflow-y:auto; box-shadow:0 12px 36px #000a; font-family:'Inter',sans-serif; min-width:240px; scrollbar-width:thin; }
#anima-ac.hidden { display:none; }
.anima-ac-row { display:flex; align-items:center; gap:8px; padding:6px 10px; cursor:pointer; border-bottom:1px solid #12121a; transition:background .1s; }
.anima-ac-row:last-child { border-bottom:none; }
.anima-ac-row:hover,.anima-ac-row.on { background:#141422; }
.anima-ac-thumb { width:30px; height:30px; border-radius:4px; object-fit:cover; background:#14141e; flex-shrink:0; }
.anima-ac-tag { flex:1; font-size:11.5px; font-family:'JetBrains Mono',monospace; color:#8080a0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.anima-ac-works { font-size:9.5px; font-family:'JetBrains Mono',monospace; color:#222230; white-space:nowrap; }

#anima-badge { position:absolute; background:#10101a; border:1px solid #22223a; color:#606080; font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:500; padding:3px 10px; border-radius:5px; pointer-events:none; white-space:nowrap; z-index:10001; display:none; }
`;
    document.head.appendChild(s);
}

const AC = (() => {
    let el, ta, atIdx = -1;

    function init() {
        if (document.getElementById("anima-ac")) return;
        el = document.createElement("div");
        el.id = "anima-ac";
        el.className = "hidden";
        document.body.appendChild(el);
        el.addEventListener("mousedown", e => e.preventDefault());
    }

    function attach(textarea) {
        init();
        textarea.addEventListener("input", () => _onInput(textarea));
        textarea.addEventListener("keydown", e => _onKey(e));
        textarea.addEventListener("blur", () => setTimeout(hide, 160));
    }

    async function _onInput(textarea) {
        ta = textarea;
        const before = textarea.value.slice(0, textarea.selectionStart);
        const m = before.match(/@([\w_()\\ ]*)$/);
        if (!m) { hide(); return; }

        atIdx = before.lastIndexOf("@");
        const results = await Data.search(m[1], 14);
        if (!results.length) { hide(); return; }

        const r = textarea.getBoundingClientRect();
        el.style.left = `${r.left + window.scrollX}px`;
        el.style.top = `${r.bottom + window.scrollY + 3}px`;
        el.style.width = `${Math.max(240, r.width * .65)}px`;
        el.innerHTML = "";
        el.classList.remove("hidden");

        results.forEach((a, i) => {
            const row = document.createElement("div");
            row.className = "anima-ac-row" + (i === 0 ? " on" : "");
            row.dataset.tag = a.tag;
            row.innerHTML = `
                <img class="anima-ac-thumb" src="${thumbUrl(a)}" alt="" onerror="this.style.display='none'"/>
                <span class="anima-ac-tag">@${a.tag}</span>
                ${a.works ? `<span class="anima-ac-works">${a.works.toLocaleString()}</span>` : ""}
            `;
            row.addEventListener("mousedown", () => _pick(a));
            el.appendChild(row);
        });
    }

    function _onKey(e) {
        if (!el || el.classList.contains("hidden")) return;
        const rows = [...el.querySelectorAll(".anima-ac-row")];
        const cur = el.querySelector(".anima-ac-row.on");
        const idx = rows.indexOf(cur);
        if (e.key === "ArrowDown") { e.preventDefault(); cur?.classList.remove("on"); rows[(idx + 1) % rows.length]?.classList.add("on"); }
        else if (e.key === "ArrowUp") { e.preventDefault(); cur?.classList.remove("on"); rows[(idx - 1 + rows.length) % rows.length]?.classList.add("on"); }
        else if (e.key === "Enter" || e.key === "Tab") { const on = el.querySelector(".anima-ac-row.on"); if (on) { e.preventDefault(); _pick({ tag: on.dataset.tag }); } }
        else if (e.key === "Escape") { hide(); }
    }

    function _pick(artist) {
        if (!ta) return;
        const val = ta.value;
        const cursor = ta.selectionStart;
        const before = val.slice(0, atIdx);
        const after = val.slice(cursor).replace(/^,?\s*/, "");
        const spaceTag = artist.tag.replace(/_/g, " ");
        ta.value = `${before}@${spaceTag}, ${after}`.trimEnd();
        const pos = before.length + spaceTag.length + 1;
        ta.setSelectionRange(pos, pos);
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        ta.dispatchEvent(new Event("change", { bubbles: true }));
        hide();
    }

    function hide() { el?.classList.add("hidden"); }
    return { attach };
})();

const Browser = (() => {
    let el, grid, countEl, onPick;
    let filter = "", sort = "works", _renderId = 0, _observer;

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
                    <span class="hdr-pill">original by <a href="https://github.com/ThetaCursed/Anima-Style-Explorer" target="_blank" style="color:#a0a0ff;text-decoration:none;font-weight:600">ThetaCursed</a></span>
                    <span class="hdr-pill">node by <a href="https://github.com/fulletLab" target="_blank" style="color:#d0d0e0;text-decoration:none;font-weight:600">fulletLab</a></span>
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
                        <input type="text" placeholder="Search 5,000+ artists..." autocomplete="off" spellcheck="false"/>
                    </div>
                    <div class="cycle-gap"></div>
                    <span class="cycle-hint">generates one image per style, loops until stopped</span>
                </div>
                <div class="body">
                    <div class="anima-grid" id="anima-grid">
                        <div class="anima-empty"><div class="anima-spinner"></div><span>Loading 5000 styles...</span></div>
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

        _observer = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) e.target._mount?.();
                else e.target._unmount?.();
            });
        }, { root: el.querySelector(".body"), rootMargin: "400px" });
    }

    async function _render() {
        const id = ++_renderId;
        grid.innerHTML = `<div class="anima-empty"><div class="anima-spinner"></div><span>Loading...</span></div>`;
        let list = await Data.search(filter);
        if (id !== _renderId) return;

        if (sort === "name") list = [...list].sort((a, b) => a.tag.localeCompare(b.tag));
        else list = [...list].sort((a, b) => (b.works || 0) - (a.works || 0));

        countEl.textContent = `${list.length} styles`;
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
        const url = thumbUrl(a);
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

const AutoCycle = (() => {
    let _running = false, _handler = null, _node = null, _count = 0, _manualNext = null;

    async function _next() {
        if (!_running || !_node) return;
        try {
            let a = _manualNext;
            _manualNext = null;
            if (!a) a = await Data.random();
            if (a && _node._currentTag === a.tag) a = await Data.random();
            if (!a) return;
            applyStyle(_node, a);
            _count++;
            const s = Browser.cycleStatus();
            if (s) {
                s.textContent = `${_count} done  ·  @${a.tag.replace(/_/g, " ")}`;
                s.classList.add("active");
            }
            app.queuePrompt(0, 1);
        } catch (err) { stop(); }
    }

    function start(node) {
        if (_running) return;
        _running = true; _node = node; _count = 0;
        if (!_handler) {
            _handler = (e) => {
                if (!_running || !_node) return;
                if (e.detail?.exec_info?.queue_remaining === 0) _next();
            };
            api.addEventListener("status", _handler);
        }
        const btn = Browser.cycleBtn();
        if (btn) { btn.classList.add("running"); btn.querySelector(".btn-icon").innerHTML = "&#9646;&#9646;"; btn.querySelector(".btn-lbl").textContent = "Stop"; }
        _next();
    }

    function stop() {
        if (!_running) return;
        _running = false;
        if (_handler) { api.removeEventListener("status", _handler); _handler = null; }
        const btn = Browser.cycleBtn();
        if (btn) { btn.classList.remove("running"); btn.querySelector(".btn-icon").innerHTML = "&#9654;"; btn.querySelector(".btn-lbl").textContent = "Play"; }
        const s = Browser.cycleStatus();
        if (s) { s.textContent = `stopped after ${_count}`; s.classList.remove("active"); }
    }

    function toggle(node) { _running ? stop() : start(node); return _running; }

    async function inject(node, a) {
        _node = node;
        if (!_running) { applyStyle(node, a); return; }
        if (node._currentTag === a.tag) a = await Data.random();
        _manualNext = a;
        applyStyle(node, a);
        if ((app.ui.lastQueueSize || 0) === 0) _next();
    }

    return { toggle, stop, inject, get running() { return _running; } };
})();

app.registerExtension({
    name: "AnimaStyleExplorer",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "AnimaStyleExplorer") return;
        injectCSS();

        const _orig = nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            _orig?.apply(this, arguments);
            const node = this;

            node.addCustomWidget({
                name: "_tag_display",
                type: "anima_tag",
                value: "",
                draw(ctx, n, width, y) {
                    const tag = n._currentTag;
                    if (!tag) return;
                    ctx.save();
                    ctx.fillStyle = "#0f0f18";
                    ctx.strokeStyle = "#1e1e30";
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.roundRect(8, y + 2, width - 16, 20, 4);
                    ctx.fill();
                    ctx.stroke();
                    ctx.fillStyle = "#606080";
                    ctx.font = "500 10px 'JetBrains Mono',monospace";
                    ctx.textAlign = "center";
                    ctx.fillText(`@${tag.replace(/_/g, " ")}`, width / 2, y + 15);
                    ctx.restore();
                },
                computeSize() { return [0, 26]; },
                serialize: false,
            });

            node.addWidget("button", "Style Browser", null, () => {
                Browser.open(artist => AutoCycle.inject(node, artist));
                const b = Browser.cycleBtn();
                if (b) b.onclick = () => AutoCycle.toggle(node);
            });

            node.addWidget("button", "Random Style", null, () => {
                Data.random().then(a => {
                    if (a) {
                        AutoCycle.inject(node, a);
                    }
                }).catch(err => { });
            });


            if (!document.getElementById("anima-badge")) {
                const badge = document.createElement("div");
                badge.id = "anima-badge";
                const canvas = document.getElementById("graph-canvas");
                (canvas?.parentElement ?? document.body).appendChild(badge);
            }

            setTimeout(() => {
                node.widgets?.forEach(w => {
                    if (w.inputEl) AC.attach(w.inputEl);
                });
            }, 400);
        };
    },

    nodeCreated(node) {
        if (node.type !== "AnimaStyleExplorer") return;
        setTimeout(() => {
            node.widgets?.forEach(w => { if (w.inputEl) AC.attach(w.inputEl); });
        }, 500);
    },
});
