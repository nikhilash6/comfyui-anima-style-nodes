import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { Data } from "./data.js";
import { Browser } from "./browser.js";
import { applyStyle } from "./utils.js";

export const AutoCycle = (() => {
    let _running = false, _handler = null, _node = null, _count = 0, _manualNext = null;

    async function _next() {
        if (!_running || !_node) return;

        if (!app.graph || !app.graph._nodes.includes(_node)) {
            stop();
            return;
        }

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
