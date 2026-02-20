import { app } from "../../scripts/app.js";
import { injectCSS } from "./styles.js";
import { Data } from "./data.js";
import { AC } from "./autocomplete.js";
import { Browser } from "./browser.js";
import { AutoCycle } from "./autocycle.js";

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
                    if (a) AutoCycle.inject(node, a);
                }).catch(() => { });
            });

            if (!document.getElementById("anima-badge")) {
                const badge = document.createElement("div");
                badge.id = "anima-badge";
                const canvas = document.getElementById("graph-canvas");
                (canvas?.parentElement ?? document.body).appendChild(badge);
            }

            setTimeout(() => {
                node.widgets?.forEach(w => {
                    if (w.inputEl && w.inputEl.tagName === "TEXTAREA") {
                        AC.attach(w.inputEl);
                    }
                });
            }, 400);
        };
    },

    nodeCreated(node) {
        setTimeout(() => {
            node.widgets?.forEach(w => {
                if (w.inputEl && w.inputEl.tagName === "TEXTAREA") {
                    AC.attach(w.inputEl);
                }
            });
        }, 500);
    },
});
