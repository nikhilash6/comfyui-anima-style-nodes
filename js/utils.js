import { app } from "../../scripts/app.js";
import { SITE_BASE } from "./config.js";

export function thumbUrl(artist, useCustom = false) {
    const ts = Date.now();
    if (useCustom) {
        return `/anima/images/custom/${artist.id}.webp?t=${ts}`;
    }
    const isOnline = localStorage.getItem("anima_online") === "true";
    if (!isOnline) {
        return `/anima/images/${artist.p}/${artist.id}.webp?t=${ts}`;
    }
    return `${SITE_BASE}/images/${artist.p}/${artist.id}.webp`;
}

export function getPromptWidget(node) {
    return node.widgets?.find(w =>
        w.name === "text" ||
        w.name === "prompt" ||
        w.type === "customtext" ||
        (w.type === "STRING" && w.inputEl)
    ) ?? null;
}

export function injectTag(current, tag) {
    const spaceTag = tag ? tag.replace(/_/g, " ") : "";

    // De-activation: remove any existing tag matching the pattern
    if (!spaceTag) {
        return current.replace(/(^|,\s*)@[^,]+(,\s*|$)/g, (match, p1, p2) => p1 && p2 ? ", " : "").trim();
    }

    // Replacement: if a tag like @artist already exists anywhere, replace it
    if (/@/.test(current)) {
        return current.replace(/@[^,]+/, `@${spaceTag}`);
    } else {
        // Appending: append the tag to the very end
        const cleaned = current.trim();
        return cleaned ? `${cleaned}, @${spaceTag}` : `@${spaceTag}`;
    }
}

export function applyStyle(node, artist) {
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
