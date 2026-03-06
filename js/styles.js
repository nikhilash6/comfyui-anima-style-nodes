export function injectCSS() {
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
.anima-swipe-btn { display:flex; align-items:center; gap:6px; padding:5px 12px; border-radius:6px; cursor:pointer; font-family:'Inter',sans-serif; font-size:11px; font-weight:600; border:1px solid #203040; background:#101820; color:#80a0c0; transition:all .15s; white-space:nowrap; }
.anima-swipe-btn:hover { background:#142030; border-color:#2a405a; color:#b0d0f0; }
.anima-cycle-status { font-size:10.5px; color:#a0a0bc; font-family:'JetBrains Mono',monospace; }
.anima-cycle-status.active { color:#a0c0a0; }
#anima-browser .cycle-gap { flex:1; }
#anima-browser .cycle-search { position:relative; width:220px; margin-left:12px; }
#anima-browser .cycle-search i { position:absolute; left:8px; top:50%; transform:translateY(-50%); color:#2e2e42; font-size:10px; font-family:'JetBrains Mono',monospace; font-style:normal; pointer-events:none; }
#anima-browser .cycle-search input { width:100%; padding:5px 8px 5px 22px; background:#0a0a0f; border:1px solid #1a1a24; border-radius:6px; color:#a0a0bc; font-size:11px; font-family:'JetBrains Mono',monospace; outline:none; transition:border-color .15s; }
#anima-browser .cycle-search input:focus { border-color:#343450; }
#anima-browser .cycle-hint { font-size:10px; color:#8080a0; font-family:'Inter',sans-serif; opacity:0.9; font-style:italic; }

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
.anima-uniqueness-rank { position:absolute; top:8px; left:8px; min-width:44px; height:28px; padding:0 10px; border-radius:999px; background:rgba(0,0,0,.55); border:1px solid #2e2e48; color:#e0e0f0; font-family:'JetBrains Mono',monospace; font-size:10px; font-weight:700; display:flex; align-items:center; justify-content:center; box-shadow:0 10px 30px #0009; z-index:2; }
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

#anima-swipe { position:fixed; inset:0; z-index:100000; display:flex; align-items:center; justify-content:center; font-family:'Inter',sans-serif; }
#anima-swipe.hidden { display:none; }
#anima-swipe .backdrop { position:absolute; inset:0; background:rgba(0,0,0,.82); backdrop-filter:blur(12px); }
#anima-swipe .swipe-header { position:absolute; top:18px; left:0; width:100%; display:flex; align-items:center; justify-content:space-between; padding:0 20px; color:#e0e0f0; z-index:2; }
#anima-swipe .swipe-title { position:absolute; left:50%; transform:translateX(-50%); text-align:center; font-size:24px; font-weight:700; text-shadow:0 2px 8px rgba(0,0,0,.5); }
#anima-swipe .swipe-counter { font-size:12px; font-family:'JetBrains Mono',monospace; background:rgba(0,0,0,.4); padding:6px 12px; border-radius:999px; border:1px solid #2a2a40; color:#c0c0d0; user-select:none; }
#anima-swipe .swipe-close { width:38px; height:38px; border-radius:10px; background:rgba(0,0,0,.25); border:1px solid #2a2a40; color:#c0c0d0; cursor:pointer; font-size:16px; line-height:1; display:flex; align-items:center; justify-content:center; transition:background .15s,color .15s,transform .15s; }
#anima-swipe .swipe-close:hover { background:rgba(0,0,0,.45); color:#fff; transform:scale(1.05); }
#anima-swipe .swipe-container { position:relative; width:100%; height:100%; display:flex; align-items:center; justify-content:center; z-index:1; overflow:hidden; }
#anima-swipe .swipe-container.swipe-transition .swipe-image { transition:transform .3s ease, opacity .3s ease, filter .3s ease; }
#anima-swipe .swipe-image { max-height:85vh; max-width:85vw; object-fit:contain; border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.35); }
#anima-swipe .swipe-image--current { transform:scale(1); opacity:1; z-index:3; cursor:pointer; }
#anima-swipe .swipe-image--prev, #anima-swipe .swipe-image--next { position:absolute; opacity:.5; filter:blur(8px); z-index:2; cursor:pointer; }
#anima-swipe .swipe-image--prev { transform:scale(.8) translateX(-50vw); }
#anima-swipe .swipe-image--next { transform:scale(.8) translateX(50vw); }
#anima-swipe .swipe-hint { position:absolute; bottom:18px; z-index:2; font-size:12px; color:#9090b0; background:rgba(0,0,0,.35); padding:6px 12px; border-radius:999px; border:1px solid #1a1a24; font-family:'JetBrains Mono',monospace; user-select:none; }
`;
    document.head.appendChild(s);
}
