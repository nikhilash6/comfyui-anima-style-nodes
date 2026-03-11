export function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function normalizeTag(value) {
    return String(value || "").trim().replace(/\s+/g, "_").toLowerCase();
}

export function favoriteKeyFromItem(item) {
    if (!item || typeof item !== "object") return "";
    const kind = String(item.kind || item._kind || "").toLowerCase();
    if (kind === "style") {
        const tag = normalizeTag(item.tag);
        return tag ? `style:${tag}` : "";
    }
    if (kind === "fullet") {
        const id = String(item.id || item.postId || "").trim();
        return id ? `fullet:${id}` : "";
    }

    const maybeTag = normalizeTag(item.tag);
    if (maybeTag) return `style:${maybeTag}`;

    const maybePost = String(item.id || item.postId || "").trim();
    if (maybePost && item.prompt && item.artist) return `fullet:${maybePost}`;

    return "";
}

export function isFulletLike(item) {
    if (!item || typeof item !== "object") return false;
    const kind = String(item.kind || item._kind || "").toLowerCase();
    if (kind === "fullet") return true;
    return !!(item.id && item.prompt && item.artist);
}

export function localFavoriteFromStyle(artist) {
    const tag = normalizeTag(artist?.tag || "");
    if (!tag) return null;

    const id = String(artist?.id ?? "").trim();
    const page = Number(artist?.p ?? 1) || 1;
    const works = Number(artist?.works ?? 0) || 0;
    const uniqueness = Number(artist?.uniqueness_score ?? 0) || 0;

    return {
        key: `style:${tag}`,
        kind: "style",
        tag,
        id,
        p: page,
        works,
        uniqueness_score: uniqueness,
        name: String(artist?.name || "").trim(),
        addedAt: new Date().toISOString(),
        localPreviewCached: !!artist?.localPreviewCached,
    };
}

export function localFavoriteFromFullet(post) {
    const id = String(post?.id || post?.postId || "").trim();
    const artist = String(post?.artist || "").trim().replace(/^@+/, "");
    const prompt = String(post?.prompt || "").trim();
    if (!id || !artist || !prompt) return null;

    return {
        key: `fullet:${id}`,
        kind: "fullet",
        id,
        username: String(post?.username || "").trim(),
        prompt,
        artist,
        imageUrl: String(post?.imageUrl || "").trim(),
        createdAt: String(post?.createdAt || "").trim(),
        postUrl: String(post?.postUrl || "").trim(),
        addedAt: new Date().toISOString(),
    };
}

export function sortByDateDesc(list) {
    return [...list].sort((a, b) => {
        const aTs = Date.parse(String(a?.addedAt || a?.createdAt || 0)) || 0;
        const bTs = Date.parse(String(b?.addedAt || b?.createdAt || 0)) || 0;
        return bTs - aTs;
    });
}
