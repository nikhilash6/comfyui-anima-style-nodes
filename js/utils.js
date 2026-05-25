import { app } from "../../scripts/app.js";
import { CDN_BASE } from "./config.js";

export function remoteImagesEnabled() {
    try {
        return localStorage.getItem("anima_online") === "true";
    } catch {
        return false;
    }
}

export function thumbUrl(artist, useCustom = false) {
    if (!artist) return "";
    const id = artist.id ?? "";
    const isOnline = remoteImagesEnabled();

    const direct = String(
        artist.thumb_url
        || artist.thumbnailUrl
        || artist.imageUrl
        || artist.image
        || ""
    ).trim();
    if (direct) {
        if (/^https?:\/\//i.test(direct) && !isOnline) return "";
        return direct;
    }

    if (!id) return "";

    if (useCustom) {
        return `/anima/images/custom/${id}.webp`;
    }

    const page = artist.p ?? 1;
    const preferLocal = !!(artist?._preferLocalThumb || artist?.localPreviewCached);
    if (preferLocal) {
        return `/anima/images/${page}/${id}.webp`;
    }

    if (!isOnline) {
        return `/anima/images/${page}/${id}.webp`;
    }

    return `${CDN_BASE}/images/${page}/${id}.webp`;
}

export function getPromptWidget(node) {
    return node.widgets?.find(w =>
        w.name === "text" ||
        w.name === "prompt" ||
        w.type === "customtext" ||
        (w.type === "STRING" && w.inputEl)
    ) ?? null;
}

function setPromptValue(node, w, value, tag = "", kind = "") {
    w.value = value;
    if (w.inputEl) {
        w.inputEl.value = value;
        w.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        w.inputEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    if (w.callback) w.callback(value);

    if (tag) {
        node._currentTag = tag;
        if (kind) node._currentTagKind = kind;
    }

    const badge = document.getElementById("anima-badge");
    if (badge && tag) {
        const displayTag = tag.replace(/_/g, " ");
        const displayKind = String(kind || node?._currentTagKind || "style").toUpperCase();
        badge.textContent = `${displayKind} @${displayTag}`;
        badge.style.display = "block";
    }

    node.setDirtyCanvas?.(true, true);
    app.graph.setDirtyCanvas?.(true, true);
}

function normalizeArtist(value = "") {
    const display = String(value || "")
        .replace(/^@+/, "")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return {
        display,
        tag: display ? display.replace(/\s+/g, "_") : "",
        token: display ? `@${display}` : "",
    };
}

function getFirstArtistToken(text = "") {
    const match = String(text || "").match(/@[^,\n]+/);
    return match ? match[0].trim() : "";
}

function artistTokenToTag(token = "") {
    return String(token || "")
        .replace(/^@+/, "")
        .replace(/\s+/g, "_")
        .trim();
}

function composeArtistAndPrompt(artistToken = "", promptText = "") {
    const a = String(artistToken || "").trim().replace(/[\s,]+$/g, "");
    const p = String(promptText || "").trim().replace(/^[,\s]+/g, "");
    if (a && p) return `${a}, ${p}`;
    return a || p;
}

function resolvePreservedArtist(current = "", fallbackTag = "") {
    const existingArtistToken = getFirstArtistToken(current);
    if (existingArtistToken) {
        return {
            token: existingArtistToken,
            tag: artistTokenToTag(existingArtistToken),
        };
    }

    const fallback = normalizeArtist(fallbackTag);
    return {
        token: fallback.token,
        tag: fallback.tag,
    };
}

const ARTIST_LINE_RE = /(^|\n)(\s*(?:artist|artista|author|autor)\s*:\s*)([^\n]*)/i;
const PROMPT_LINE_RE = /(^|\n)(\s*(?:prompt|positive\s*prompt|prompt\s*positivo)\s*:\s*)([^\n]*)/i;

function replaceLabeledLine(text, lineRegex, value) {
    let changed = false;
    const next = String(text || "").replace(lineRegex, (_m, prefix, label) => {
        changed = true;
        return `${prefix}${label}${value}`;
    });
    return { text: next, changed };
}

function applyStructuredFields(current, { artistToken = "", promptText = "", updateArtist = false, updatePrompt = false } = {}) {
    let next = String(current || "");
    let changed = false;

    if (updateArtist) {
        const result = replaceLabeledLine(next, ARTIST_LINE_RE, artistToken);
        next = result.text;
        changed = changed || result.changed;
    }

    if (updatePrompt) {
        const result = replaceLabeledLine(next, PROMPT_LINE_RE, promptText);
        next = result.text;
        changed = changed || result.changed;
    }

    return changed ? next : null;
}

function looksStructuredPrompt(text = "") {
    const raw = String(text || "");
    if (!raw) return false;
    if (/\n/.test(raw)) return true;
    return /(^|\s)[a-zA-Z][a-zA-Z0-9 _-]{1,28}:\s/.test(raw);
}

export function injectTag(current, tag) {
    const text = String(current || "");
    const spaceTag = tag ? tag.replace(/_/g, " ") : "";

    if (!spaceTag) {
        return text.replace(/(^|,\s*)@[^,\n]+(,\s*|$)/g, (_match, p1, p2) => p1 && p2 ? ", " : "").trim();
    }

    if (/@[^,\n]+/.test(text)) {
        return text.replace(/@[^,\n]+(,\s*)?/, `@${spaceTag}, `);
    }

    const cleaned = text.trim().replace(/[\s,]+$/g, "");
    return cleaned ? `${cleaned}, @${spaceTag}, ` : `@${spaceTag}, `;
}

function sourceKindFromArtist(artist) {
    const kind = String(artist?.source_kind || "").toLowerCase();
    return kind === "character" ? "character" : "style";
}

function appendPromptTags(current = "", tags = []) {
    const text = String(current || "");
    const existing = new Set(
        text
            .split(",")
            .map((part) => part.replace(/^@+/, "").replace(/\s+/g, " ").trim().toLowerCase())
            .filter(Boolean)
    );
    const cleanedTags = [];

    for (const tag of tags) {
        const display = String(tag || "")
            .replace(/^@+/, "")
            .replace(/_/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        const key = display.toLowerCase();
        if (!display || existing.has(key)) continue;
        existing.add(key);
        cleanedTags.push(display);
    }

    if (!cleanedTags.length) return text;

    const cleaned = text.trim().replace(/[\s,]+$/g, "");
    const suffix = cleanedTags.join(", ");
    return cleaned ? `${cleaned}, ${suffix}, ` : `${suffix}, `;
}

function characterTriggerParts(artist, mode = "trigger") {
    const trigger = String(artist?.trigger || artist?.tag || "")
        .replace(/^@+/, "")
        .replace(/_/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const tags = Array.isArray(artist?.tags)
        ? artist.tags.map((tag) => String(tag || "").trim()).filter(Boolean)
        : [];
    if (mode === "trigger-tags") return [trigger, ...tags].filter(Boolean);
    return trigger ? [trigger] : [];
}

export function applyStyle(node, artist, options = {}) {
    const w = getPromptWidget(node);
    if (!w) return { ok: false, error: "Prompt widget not found." };

    const tag = String(artist?.tag || "").trim();
    if (!tag) return { ok: false, error: "Selected item has no tag." };

    const kind = sourceKindFromArtist(artist);
    const current = String(w.value || "");

    if (kind === "character") {
        const mode = options?.mode === "trigger-tags" ? "trigger-tags" : "trigger";
        const parts = characterTriggerParts(artist, mode);
        const newVal = appendPromptTags(current, parts);
        const keepTag = String(node?._currentTag || "");
        const keepKind = String(node?._currentTagKind || "style");
        setPromptValue(node, w, newVal, keepTag, keepTag ? keepKind : "");
        return { ok: true, action: mode, kind, tag, prompt: newVal, inserted: parts };
    }

    const newVal = injectTag(current, tag);
    setPromptValue(node, w, newVal, tag, kind);
    return { ok: true, action: "apply-style", kind, tag, prompt: newVal };
}

export function stripLeadingArtist(prompt = "") {
    return String(prompt || "").replace(/^\s*@[^,\n]+\s*,?\s*/i, "").trim();
}

export function buildFulletCopyText(post, mode = "both") {
    const artist = normalizeArtist(post?.artist || "");
    const promptOnly = stripLeadingArtist(post?.prompt || "");

    if (mode === "prompt") return promptOnly;
    if (mode === "artist") return artist.token;
    return composeArtistAndPrompt(artist.token, promptOnly);
}

export function applyTemplateStyle(node, post) {
    const w = getPromptWidget(node);
    if (!w) {
        return { ok: false, error: "Prompt widget not found in node." };
    }

    const template = String(w.value || "");
    const hasPromptToken = /\{\{\s*prompt\s*\}\}/i.test(template);
    const hasArtistToken = /\{\{\s*artist\s*\}\}/i.test(template);

    if (!hasPromptToken || !hasArtistToken) {
        return {
            ok: false,
            error: "Template must include both {{prompt}} and {{artist}}.",
        };
    }

    const artist = normalizeArtist(post?.artist || "");
    const rawPrompt = String(post?.prompt || "").trim();

    if (!artist.display || !rawPrompt) {
        return { ok: false, error: "Selected post is missing prompt or artist." };
    }

    const cleanedPrompt = stripLeadingArtist(rawPrompt);

    const rendered = template
        .replace(/\{\{\s*prompt\s*\}\}/gi, cleanedPrompt)
        .replace(/\{\{\s*artist\s*\}\}/gi, artist.token);

    setPromptValue(node, w, rendered, artist.tag, "style");

    return {
        ok: true,
        prompt: rendered,
        artist: artist.display,
    };
}

export function applyFulletSelection(node, post, mode = "both") {
    const w = getPromptWidget(node);
    if (!w) {
        return { ok: false, error: "Prompt widget not found in node." };
    }

    const artist = normalizeArtist(post?.artist || "");
    const rawPrompt = String(post?.prompt || "").trim();
    if (!artist.display || !rawPrompt) {
        return { ok: false, error: "Selected post is missing prompt or artist." };
    }

    const promptOnly = stripLeadingArtist(rawPrompt);
    const current = String(w.value || "");

    if (mode === "artist") {
        const structured = applyStructuredFields(current, {
            artistToken: artist.token,
            updateArtist: true,
            updatePrompt: false,
        });
        if (structured !== null) {
            setPromptValue(node, w, structured, artist.tag, "style");
            return { ok: true, mode, prompt: structured, artist: artist.display };
        }

        const next = injectTag(current, artist.tag);
        setPromptValue(node, w, next, artist.tag, "style");
        return { ok: true, mode, prompt: next, artist: artist.display };
    }

    if (mode === "prompt") {
        const hasPromptToken = /\{\{\s*prompt\s*\}\}/i.test(current);
        if (hasPromptToken) {
            const rendered = current.replace(/\{\{\s*prompt\s*\}\}/gi, promptOnly);
            const keepTag = String(node?._currentTag || "");
            const keepKind = String(node?._currentTagKind || "style");
            setPromptValue(node, w, rendered, keepTag, keepTag ? keepKind : "");
            return { ok: true, mode, prompt: rendered, artist: keepTag ? keepTag.replace(/_/g, " ") : "" };
        }

        const structured = applyStructuredFields(current, {
            promptText: promptOnly,
            updateArtist: false,
            updatePrompt: true,
        });
        if (structured !== null) {
            const keepTag = String(node?._currentTag || "");
            const keepKind = String(node?._currentTagKind || "style");
            setPromptValue(node, w, structured, keepTag, keepTag ? keepKind : "");
            return { ok: true, mode, prompt: structured, artist: keepTag ? keepTag.replace(/_/g, " ") : "" };
        }

        const preservedArtist = resolvePreservedArtist(current, String(node?._currentTag || ""));
        const next = composeArtistAndPrompt(preservedArtist.token, promptOnly);
        setPromptValue(node, w, next, preservedArtist.tag, "style");
        return {
            ok: true,
            mode,
            prompt: next,
            artist: preservedArtist.tag ? preservedArtist.tag.replace(/_/g, " ") : "",
        };
    }

    const hasPromptToken = /\{\{\s*prompt\s*\}\}/i.test(current);
    const hasArtistToken = /\{\{\s*artist\s*\}\}/i.test(current);

    if (hasPromptToken && hasArtistToken) {
        return applyTemplateStyle(node, post);
    }

    if (hasPromptToken || hasArtistToken) {
        const rendered = current
            .replace(/\{\{\s*prompt\s*\}\}/gi, promptOnly)
            .replace(/\{\{\s*artist\s*\}\}/gi, artist.token);
        const next = hasArtistToken ? rendered : injectTag(rendered, artist.tag);
        setPromptValue(node, w, next, artist.tag, "style");
        return { ok: true, mode: "both", prompt: next, artist: artist.display };
    }

    const structured = applyStructuredFields(current, {
        artistToken: artist.token,
        promptText: promptOnly,
        updateArtist: true,
        updatePrompt: true,
    });
    if (structured !== null) {
        setPromptValue(node, w, structured, artist.tag, "style");
        return { ok: true, mode: "both", prompt: structured, artist: artist.display };
    }

    const next = composeArtistAndPrompt(artist.token, promptOnly);
    setPromptValue(node, w, next, artist.tag, "style");
    return { ok: true, mode: "both", prompt: next, artist: artist.display };
}




