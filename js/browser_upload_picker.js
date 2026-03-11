import { escapeHtml } from "./browser_helpers.js";
import { showToast } from "./toast.js";

const MAX_UPLOAD_ITEMS = 36;
const MIN_VALID_TIMESTAMP = Date.UTC(2024, 0, 1);

function loadBool(key, fallback = false) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return raw === "true";
    } catch {
        return fallback;
    }
}

function saveBool(key, value) {
    try {
        localStorage.setItem(key, value ? "true" : "false");
    } catch { }
}

function normalizeTimestamp(value) {
    let ts = 0;

    if (typeof value === "number" && Number.isFinite(value) && value > 1000000000) {
        ts = value < 1000000000000 ? value * 1000 : value;
    } else {
        const raw = String(value ?? "").trim();
        if (!raw) return 0;

        const asNumber = Number(raw);
        if (Number.isFinite(asNumber) && asNumber > 1000000000) {
            ts = asNumber < 1000000000000 ? asNumber * 1000 : asNumber;
        } else {
            const parsed = Date.parse(raw);
            ts = Number.isFinite(parsed) ? parsed : 0;
        }
    }

    const maxAllowed = Date.now() + 86400000;
    if (!ts || ts < MIN_VALID_TIMESTAMP || ts > maxAllowed) return 0;
    return ts;
}

function extractArtistTag(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    const match = value.match(/@([^\n,]+?)(?=(?:,|\n|$))/);
    return match ? match[1].trim() : "";
}

function stripLeadingArtist(text) {
    const value = String(text || "").trim();
    if (!value) return "";
    return value.replace(/^@([^\n,]+?)\s*(?:,|\n)\s*/u, "").trim();
}

function isPromptGraph(candidate) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    return Object.values(candidate).some((value) => {
        return value
            && typeof value === "object"
            && !Array.isArray(value)
            && (typeof value.class_type === "string" || typeof value.inputs === "object");
    });
}

function findPromptGraph(entry) {
    const candidates = [
        entry?.prompt,
        entry?.workflow,
        entry?.graph,
        entry?.extra_data?.prompt,
        entry?.extra_data?.workflow,
        entry?.prompt?.prompt,
        entry?.prompt?.workflow,
    ];

    for (const candidate of candidates) {
        if (isPromptGraph(candidate)) return candidate;

        if (Array.isArray(candidate)) {
            for (const part of candidate) {
                if (isPromptGraph(part)) return part;
                if (part && typeof part === "object") {
                    if (isPromptGraph(part.prompt)) return part.prompt;
                    if (isPromptGraph(part.workflow)) return part.workflow;
                    if (isPromptGraph(part.extra_data?.prompt)) return part.extra_data.prompt;
                }
            }
        }

        if (candidate && typeof candidate === "object") {
            for (const nested of Object.values(candidate)) {
                if (isPromptGraph(nested)) return nested;
            }
        }
    }

    return null;
}

function collectImagesFromSource(source, bucket) {
    if (!source || typeof source !== "object") return;

    if (Array.isArray(source)) {
        for (const item of source) collectImagesFromSource(item, bucket);
        return;
    }

    if (Array.isArray(source.images)) {
        for (const image of source.images) {
            if (!image || typeof image !== "object") continue;
            const filename = String(image.filename || "").trim();
            if (!filename) continue;
            bucket.push({
                filename,
                subfolder: String(image.subfolder || "").trim(),
                type: String(image.type || "output").trim() || "output",
            });
        }
    }

    for (const nested of Object.values(source)) {
        if (nested && typeof nested === "object") collectImagesFromSource(nested, bucket);
    }
}

function extractImages(entry) {
    const bucket = [];
    const sources = [entry?.outputs, entry?.output];

    if (Array.isArray(entry?.prompt)) {
        for (const part of entry.prompt) {
            if (part && typeof part === "object") {
                if (part.outputs) sources.push(part.outputs);
                if (part.output) sources.push(part.output);
            }
        }
    }

    for (const source of sources) collectImagesFromSource(source, bucket);

    const seen = new Set();
    return bucket.filter((image) => {
        const key = `${image.type}|${image.subfolder}|${image.filename}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getNodeId(value) {
    if (Array.isArray(value) && value.length > 0) return String(value[0] ?? "").trim();
    if (typeof value === "string" && value.trim()) return value.trim();
    return "";
}

function traceTextFromNode(graph, startRef, visited = new Set()) {
    const nodeId = getNodeId(startRef);
    if (!nodeId || visited.has(nodeId)) return "";
    visited.add(nodeId);

    const node = graph?.[nodeId];
    if (!node || typeof node !== "object") return "";
    const inputs = node.inputs && typeof node.inputs === "object" ? node.inputs : {};

    if (typeof inputs.text === "string" && inputs.text.trim()) return inputs.text.trim();
    if (typeof inputs.prompt === "string" && inputs.prompt.trim()) return inputs.prompt.trim();
    if (typeof inputs.string === "string" && inputs.string.trim()) return inputs.string.trim();

    const preferredLinks = [inputs.positive, inputs.negative, inputs.conditioning, inputs.text, inputs.clip, inputs.prompt, inputs.string];
    for (const link of preferredLinks) {
        const nested = traceTextFromNode(graph, link, visited);
        if (nested) return nested;
    }

    for (const value of Object.values(inputs)) {
        const nested = traceTextFromNode(graph, value, visited);
        if (nested) return nested;
    }

    return "";
}

function findFirstNodeByClass(graph, matcher) {
    if (!graph || typeof graph !== "object") return null;
    for (const [id, node] of Object.entries(graph)) {
        const classType = String(node?.class_type || "");
        if (matcher.test(classType)) return { id, node };
    }
    return null;
}

function collectTextCandidates(graph) {
    const positives = [];
    const negatives = [];
    const artistHints = [];

    if (!graph || typeof graph !== "object") return { positives, negatives, artistHints };

    for (const [id, node] of Object.entries(graph)) {
        const classType = String(node?.class_type || "").toLowerCase();
        const inputs = node?.inputs && typeof node.inputs === "object" ? node.inputs : {};
        for (const [key, rawValue] of Object.entries(inputs)) {
            if (typeof rawValue !== "string") continue;
            const value = rawValue.trim();
            if (!value) continue;

            const keyLower = String(key || "").toLowerCase();
            const scoreBase = value.length;
            if (/@/.test(value)) {
                artistHints.push({ value, score: scoreBase + (keyLower.includes("tag") ? 2000 : 0) + (classType.includes("anima") ? 1500 : 0) + Number(id || 0) });
            }

            if (/negative|neg/.test(keyLower) || classType.includes("negative")) {
                negatives.push({ value, score: scoreBase + (keyLower.includes("text") ? 500 : 0) });
                continue;
            }

            if (/^(text|prompt|positive|positive_prompt|string|style_prompt)$/i.test(keyLower) || classType.includes("cliptextencode") || classType.includes("anima")) {
                positives.push({ value, score: scoreBase + (/@/.test(value) ? 1000 : 0) + (/prompt/i.test(keyLower) ? 400 : 0) + (classType.includes("cliptextencode") ? 500 : 0) + (classType.includes("anima") ? 700 : 0) });
            }
        }
    }

    positives.sort((a, b) => b.score - a.score);
    negatives.sort((a, b) => b.score - a.score);
    artistHints.sort((a, b) => b.score - a.score);
    return { positives, negatives, artistHints };
}

function buildComfyMetadata(graph, entry, artist, fullPrompt, negativePrompt) {
    const metadata = {
        artist: artist || "",
        prompt: fullPrompt || "",
        negativePrompt: negativePrompt || "",
        historyId: String(entry?._historyId || ""),
        sourceType: String(entry?._historyIndex ?? ""),
    };

    const kSampler = findFirstNodeByClass(graph, /ksampler/i);
    if (kSampler?.node?.inputs) {
        const inputs = kSampler.node.inputs;
        if (inputs.steps != null) metadata.steps = inputs.steps;
        if (inputs.cfg != null) metadata.cfg = inputs.cfg;
        if (inputs.seed != null) metadata.seed = inputs.seed;
        if (inputs.sampler_name) metadata.sampler = inputs.sampler_name;
        if (inputs.scheduler) metadata.scheduler = inputs.scheduler;
    }

    const latent = findFirstNodeByClass(graph, /emptylatentimage/i);
    if (latent?.node?.inputs?.width && latent?.node?.inputs?.height) {
        metadata.size = `${latent.node.inputs.width}x${latent.node.inputs.height}`;
    }

    const checkpoint = findFirstNodeByClass(graph, /checkpointloader/i);
    if (checkpoint?.node?.inputs?.ckpt_name) {
        metadata.checkpoint = checkpoint.node.inputs.ckpt_name;
    }

    return metadata;
}

function extractPromptMeta(promptGraph, entry) {
    const graph = promptGraph && typeof promptGraph === "object" ? promptGraph : null;
    const textCandidates = collectTextCandidates(graph);
    const kSampler = findFirstNodeByClass(graph, /ksampler/i);

    let positivePrompt = "";
    let negativePrompt = "";

    if (kSampler?.node?.inputs) {
        positivePrompt = traceTextFromNode(graph, kSampler.node.inputs.positive);
        negativePrompt = traceTextFromNode(graph, kSampler.node.inputs.negative);
    }

    if (!positivePrompt) {
        positivePrompt = textCandidates.positives[0]?.value || "";
    }
    if (!negativePrompt) {
        negativePrompt = textCandidates.negatives[0]?.value || "";
    }

    const rawPrompt = typeof entry?.prompt_text === "string"
        ? entry.prompt_text.trim()
        : typeof entry?.promptText === "string"
            ? entry.promptText.trim()
            : typeof entry?.text === "string"
                ? entry.text.trim()
                : "";

    if (!positivePrompt && rawPrompt) {
        positivePrompt = rawPrompt;
    }

    const artistFromPrompt = extractArtistTag(positivePrompt);
    const artistFromHint = extractArtistTag(textCandidates.artistHints[0]?.value || "");
    const artist = artistFromPrompt || artistFromHint;

    const promptBody = stripLeadingArtist(positivePrompt);
    const fallbackBody = stripLeadingArtist(textCandidates.positives.find((candidate) => !/^@[^,\n]+$/u.test(candidate.value.trim()))?.value || "");
    let fullPrompt = positivePrompt;

    if (artist) {
        const tagPrompt = `@${artist}`;
        if (!fullPrompt || /^@[^,\n]+$/u.test(fullPrompt.trim())) {
            const body = promptBody || fallbackBody;
            fullPrompt = body ? `${tagPrompt}, ${body}` : tagPrompt;
        } else if (!/@/.test(fullPrompt)) {
            const body = stripLeadingArtist(fullPrompt);
            fullPrompt = body ? `${tagPrompt}, ${body}` : tagPrompt;
        }
    }

    const promptPreview = stripLeadingArtist(fullPrompt) || stripLeadingArtist(positivePrompt) || fallbackBody || fullPrompt;
    const isAnima = !!artist && !!(fullPrompt || promptPreview);
    const metadata = buildComfyMetadata(graph, entry, artist, fullPrompt, negativePrompt);

    return {
        isAnima,
        artist,
        prompt: fullPrompt,
        promptPreview,
        negativePrompt,
        metadata,
    };
}

function buildViewUrl(image) {
    const params = new URLSearchParams();
    params.set("filename", String(image.filename || ""));
    params.set("type", String(image.type || "output"));
    if (image.subfolder) params.set("subfolder", String(image.subfolder));
    return `/view?${params.toString()}`;
}

function formatTimeLabel(timestamp) {
    if (!timestamp) return "Recent";

    const diff = Date.now() - timestamp;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return `${Math.max(1, Math.round(diff / 60000))}m ago`;
    if (diff < 86400000) return `${Math.max(1, Math.round(diff / 3600000))}h ago`;
    if (diff < 86400000 * 365) return `${Math.max(1, Math.round(diff / 86400000))}d ago`;
    return "Recent";
}

function normalizeHistoryEntries(payload) {
    if (Array.isArray(payload)) {
        return payload.map((entry, index) => ({
            ...(entry || {}),
            _historyId: String(entry?.id || entry?.prompt_id || index),
            _historyIndex: index,
        }));
    }

    if (!payload || typeof payload !== "object") return [];

    return Object.entries(payload).map(([id, entry], index) => ({
        ...(entry || {}),
        _historyId: String(id),
        _historyIndex: index,
    }));
}

function buildUploadItems(historyPayload) {
    const entries = normalizeHistoryEntries(historyPayload);
    const items = [];

    entries.forEach((entry, index) => {
        const promptGraph = findPromptGraph(entry);
        const meta = extractPromptMeta(promptGraph, entry);
        if (!meta.isAnima) return;

        const images = extractImages(entry);
        if (!images.length) return;

        const timestamp = [
            entry?.status?.completed_at,
            entry?.completed_at,
            entry?.created_at,
            entry?.time,
        ].map(normalizeTimestamp).find((value) => value > 0) || 0;

        images.forEach((image, imageIndex) => {
            items.push({
                id: `${entry._historyId}:${image.type}:${image.subfolder}:${image.filename}:${imageIndex}`,
                historyId: entry._historyId,
                artist: meta.artist,
                prompt: meta.prompt,
                promptPreview: meta.promptPreview,
                negativePrompt: meta.negativePrompt,
                metadata: {
                    ...meta.metadata,
                    filename: image.filename,
                    subfolder: image.subfolder,
                    fileType: image.type,
                },
                filename: image.filename,
                subfolder: image.subfolder,
                type: image.type,
                viewUrl: buildViewUrl(image),
                timestamp,
                sortIndex: index,
                imageIndex,
            });
        });
    });

    const seen = new Set();
    return items
        .sort((a, b) => {
            if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
            if (a.sortIndex !== b.sortIndex) return b.sortIndex - a.sortIndex;
            return a.imageIndex - b.imageIndex;
        })
        .filter((item) => {
            const key = `${item.type}|${item.subfolder}|${item.filename}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, MAX_UPLOAD_ITEMS);
}

function renderCard(item, onUpload) {
    const card = document.createElement("div");
    card.className = "anima-upload-card";
    card.innerHTML = `
        <div class="anima-upload-thumb" data-init="${escapeHtml((item.artist[0] || "?").toUpperCase())}">
            <img loading="lazy" src="${escapeHtml(item.viewUrl)}" alt="${escapeHtml(item.artist)}" onerror="this.style.display='none';this.parentElement.classList.add('no-img')" />
            <span class="anima-upload-badge">@${escapeHtml(item.artist)}</span>
        </div>
        <div class="anima-upload-meta">
            <div class="anima-upload-row">
                <span class="anima-upload-artist">@${escapeHtml(item.artist)}</span>
                <span class="anima-upload-time">${escapeHtml(formatTimeLabel(item.timestamp))}</span>
            </div>
            <p class="anima-upload-prompt">${escapeHtml(item.promptPreview || item.prompt || "Generated image")}</p>
            <button class="anima-upload-action">Upload to Fullet</button>
        </div>
    `;

    const thumb = card.querySelector(".anima-upload-thumb");
    const actionBtn = card.querySelector(".anima-upload-action");
    actionBtn?.addEventListener("click", async (event) => {
        event.stopPropagation();
        await onUpload(item, thumb || card, actionBtn);
    });
    return card;
}

export function createUploadPicker({
    root,
    api,
    localHeaders,
    ensureLocalToken,
    refreshAuthStatus,
}) {
    const modal = root.querySelector("#anima-upload-modal");
    const panel = root.querySelector("#anima-upload-panel");
    const closeBtn = root.querySelector("#anima-upload-close");
    const refreshBtn = root.querySelector("#anima-upload-refresh");
    const grid = root.querySelector("#anima-upload-grid");
    const nsfwToggle = root.querySelector("#anima-upload-nsfw");
    const preserveToggle = root.querySelector("#anima-upload-preserve");

    const state = {
        items: [],
        loading: false,
        uploadingId: "",
        manualNsfw: loadBool("anima_upload_nsfw", false),
        preserveMetadata: loadBool("anima_upload_preserve_metadata", true),
    };

    if (nsfwToggle) nsfwToggle.checked = state.manualNsfw;
    if (preserveToggle) preserveToggle.checked = state.preserveMetadata;

    nsfwToggle?.addEventListener("change", (event) => {
        state.manualNsfw = !!event.target.checked;
        saveBool("anima_upload_nsfw", state.manualNsfw);
    });

    preserveToggle?.addEventListener("change", (event) => {
        state.preserveMetadata = !!event.target.checked;
        saveBool("anima_upload_preserve_metadata", state.preserveMetadata);
    });

    function isOpen() {
        return !!modal && !modal.classList.contains("hidden");
    }

    function close() {
        modal?.classList.add("hidden");
    }

    function setLoading(message = "Loading recent generations...") {
        if (!grid) return;
        grid.innerHTML = `
            <div class="anima-upload-empty anima-upload-empty-loading">
                <div class="anima-spinner"></div>
                <span>${escapeHtml(message)}</span>
            </div>
        `;
    }

    function setEmpty(message) {
        if (!grid) return;
        grid.innerHTML = `
            <div class="anima-upload-empty">
                <strong>No recent Anima generations found.</strong>
                <span>${escapeHtml(message)}</span>
            </div>
        `;
    }

    function renderItems() {
        if (!grid) return;
        if (!state.items.length) {
            setEmpty("Generate an image with an @artist in the prompt, then come back here to publish it.");
            return;
        }

        grid.innerHTML = "";
        const frag = document.createDocumentFragment();
        state.items.forEach((item) => {
            frag.appendChild(renderCard(item, uploadItem));
        });
        grid.appendChild(frag);
    }

    async function loadHistory() {
        if (state.loading) return;
        state.loading = true;
        setLoading();

        try {
            let response = await api.fetchApi("/history?max_items=80");
            if (!response.ok) {
                response = await api.fetchApi("/history");
            }

            if (!response.ok) {
                throw new Error(`History request failed (${response.status})`);
            }

            const payload = await response.json().catch(() => ({}));
            state.items = buildUploadItems(payload);
            renderItems();
        } catch (error) {
            setEmpty(error?.message || "Could not load local generation history.");
        } finally {
            state.loading = false;
        }
    }

    async function uploadItem(item, anchorEl, buttonEl) {
        if (!item || state.uploadingId) return;
        state.uploadingId = item.id;

        const prevLabel = buttonEl?.textContent || "Upload to Fullet";
        if (buttonEl) {
            buttonEl.textContent = "Uploading...";
            buttonEl.disabled = true;
        }

        try {
            const ok = await ensureLocalToken();
            if (!ok) {
                throw new Error("Local security token not available. Reopen the browser and try again.");
            }

            const viewResponse = await api.fetchApi(item.viewUrl);
            if (!viewResponse.ok) {
                throw new Error(`Could not open local image (${viewResponse.status})`);
            }

            const blob = await viewResponse.blob();
            const form = new FormData();
            form.append("file", blob, item.filename || "generation.png");
            form.append("prompt", String(item.prompt || item.promptPreview || "").trim());
            form.append("negativePrompt", String(item.negativePrompt || "").trim());
            form.append("model", "anima");
            form.append("manualNsfw", state.manualNsfw ? "true" : "false");
            form.append("preserveMetadata", state.preserveMetadata ? "true" : "false");
            if (state.preserveMetadata && item.metadata && Object.keys(item.metadata).length) {
                form.append("settings", JSON.stringify(item.metadata));
            }

            const response = await api.fetchApi("/anima/fullet_upload", {
                method: "POST",
                headers: localHeaders(),
                body: form,
            });
            const data = await response.json().catch(() => ({}));

            if (!response.ok || data?.ok === false) {
                if (response.status === 401 || response.status === 403) {
                    await refreshAuthStatus({ syncPending: false });
                }
                throw new Error(data?.error || `Upload failed (${response.status})`);
            }

            showToast("Uploaded to Fullet", "success", 1800, { anchor: anchorEl });
            close();
            await refreshAuthStatus({ syncPending: false });

            if (data?.postUrl) {
                window.open(data.postUrl, "_blank", "noopener");
            }
        } catch (error) {
            showToast(error?.message || "Upload failed", "error", 2200, { anchor: anchorEl });
        } finally {
            state.uploadingId = "";
            if (buttonEl) {
                buttonEl.textContent = prevLabel;
                buttonEl.disabled = false;
            }
        }
    }

    async function open() {
        if (!modal) return;
        modal.classList.remove("hidden");
        await loadHistory();
    }

    closeBtn?.addEventListener("click", close);
    refreshBtn?.addEventListener("click", async () => {
        await loadHistory();
    });
    modal?.addEventListener("click", (event) => {
        if (event.target === modal) close();
    });
    panel?.addEventListener("click", (event) => {
        event.stopPropagation();
    });

    return {
        open,
        close,
        isOpen,
        refresh: loadHistory,
    };
}
