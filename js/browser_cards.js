import { escapeHtml } from "./browser_helpers.js";

export function createFulletCard({
    post,
    isFav = false,
    onApply,
    onToggleFavorite,
    onOpenSwipe,
}) {
    const card = document.createElement("div");
    card.className = "anima-fullet-card";

    const artist = String(post?.artist || "").replace(/_/g, " ").trim();
    const user = String(post?.username || "").trim();
    const imageUrl = String(post?.displayImageUrl || post?.thumbnailUrl || post?.imageUrl || "").trim();
    const postUrl = String(post?.postUrl || "").trim();

    card.innerHTML = `
        <div class="anima-fullet-img" data-init="${escapeHtml((artist[0] || "?").toUpperCase())}">
            ${imageUrl ? `<img loading="lazy" decoding="async" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(artist)}" onerror="this.style.display='none';this.parentElement.classList.add('no-img')"/>` : ""}
        </div>
        <div class="anima-fullet-meta">
            <span class="anima-fullet-artist" title="@${escapeHtml(artist)}">@${escapeHtml(artist)}</span>
            <span class="anima-fullet-user">by @${escapeHtml(user)}</span>

            <div class="anima-fullet-actions anima-fullet-actions-main">
                <button class="anima-card-pick" data-apply="both">Apply</button>
            </div>

            <div class="anima-fullet-actions anima-fullet-actions-secondary">
                <button class="anima-fullet-mini" data-apply="prompt">Prompt</button>
                <button class="anima-fullet-mini" data-apply="artist">Artist</button>
                <button class="anima-fullet-mini" data-favorite="toggle">${isFav ? "Unfavorite" : "Favorite"}</button>
                ${postUrl ? `<a href="${escapeHtml(postUrl)}" target="_blank" rel="noopener" class="anima-fullet-mini anima-fullet-mini-link">Open</a>` : ""}
            </div>
        </div>
    `;

    const mediaEl = card.querySelector(".anima-fullet-img");

    card.querySelectorAll("[data-apply]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            onApply?.(post, btn.dataset.apply || "both", mediaEl || btn);
        });
    });

    const favBtn = card.querySelector("[data-favorite='toggle']");
    favBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await onToggleFavorite?.(post, favBtn, mediaEl || favBtn);
        if (res?.ok && typeof res.favorited === "boolean") {
            favBtn.textContent = res.favorited ? "Unfavorite" : "Favorite";
        }
    });

    card.addEventListener("mousedown", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onOpenSwipe?.(post);
    });

    card.addEventListener("click", () => onApply?.(post, "both", mediaEl || card));
    return card;
}

export function createStyleCard({
    artist,
    imageUrl,
    isUniq = false,
    isFav = false,
    onApply,
    onToggleFavorite,
    onOpenSwipe,
}) {
    const card = document.createElement("div");
    card.className = "anima-card";
    card.dataset.tag = artist.tag;

    const rankHtml = isUniq && artist.uniquenessRank
        ? `<div class="anima-uniqueness-rank" title="Uniqueness score: ${Number(artist.uniqueness_score || 0).toFixed(2)}">#${artist.uniquenessRank}</div>`
        : "";
    const source = String(artist?.source || "").toLowerCase();
    const sourceKind = String(artist?.source_kind || "").toLowerCase();
    const isCharacter = sourceKind === "character";
    const sourceLabel = sourceKind === "artist" ? "STYLE" : sourceKind === "character" ? "CHARACTER" : sourceKind;
    const sourceBadge = source === "animadex"
        ? `<span class="anima-card-source anima-card-source-${escapeHtml(sourceKind || "animadex")}">${escapeHtml(sourceLabel || "ANIMADEX")}</span>`
        : "";
    const worksLabel = source === "animadex" ? "images" : "works";
    const fitClass = source === "animadex" ? "anima-card-img-contain" : "";
    const displayTag = String(artist.tag || "").replace(/_/g, " ");
    const triggerText = String(artist?.trigger || displayTag).replace(/^@+/, "");
    const titlePrefix = isCharacter ? "" : "@";
    const overlayButtons = isCharacter
        ? `
                <button class="anima-card-pick" data-apply="trigger">Trigger</button>
                <button class="anima-card-fav anima-card-trigger-tags" data-apply="trigger-tags">Trigger + tags</button>
          `
        : `
                <button class="anima-card-pick" data-apply="style">Apply Style</button>
                <button class="anima-card-fav" data-favorite="toggle">${isFav ? "Unfavorite" : "Favorite"}</button>
          `;
    const tagsPreview = isCharacter && Array.isArray(artist?.tags) && artist.tags.length
        ? `<span class="anima-card-tags-preview" title="${escapeHtml(artist.tags.join(", "))}">${escapeHtml(artist.tags.slice(0, 4).join(", "))}${artist.tags.length > 4 ? "..." : ""}</span>`
        : "";

    const imageHtml = imageUrl
        ? `<img loading="lazy" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(artist.tag || "")}" onerror="this.style.display='none';this.parentElement.classList.add('no-img')"/>`
        : "";

    card.innerHTML = `
        <div class="anima-card-img ${fitClass} ${imageUrl ? "" : "no-img"}" data-init="${escapeHtml((artist.tag?.[0] || "?").toUpperCase())}">
            ${imageHtml}
            ${rankHtml}
            <div class="anima-card-overlay">
                ${overlayButtons}
            </div>
        </div>
        <div class="anima-card-meta">
            <span class="anima-card-tag" title="${escapeHtml(titlePrefix + displayTag)}">${escapeHtml(titlePrefix + displayTag)}</span>
            ${isCharacter ? `<span class="anima-card-trigger" title="${escapeHtml(triggerText)}">Trigger: ${escapeHtml(triggerText)}</span>` : ""}
            ${tagsPreview}
            ${(!isUniq && artist.works) ? `<span class="anima-card-works">${Number(artist.works).toLocaleString()} ${worksLabel}${sourceBadge}</span>` : sourceBadge}
        </div>
    `;

    const mediaEl = card.querySelector(".anima-card-img");

    card.addEventListener("mouseenter", () => {
        if (!imageUrl) return;
        const img = card.querySelector("img");
        if (img && (!img.complete || img.naturalWidth === 0)) {
            img.src = imageUrl + (imageUrl.includes("?") ? "&" : "?") + "t=" + Date.now();
        }
    }, { once: true });

    card.addEventListener("mousedown", (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onOpenSwipe?.(artist);
    });

    const pick = (mode = "style") => onApply?.(artist, mediaEl || card, mode);
    card.querySelectorAll("[data-apply]").forEach((btn) => btn.addEventListener("click", (e) => {
        e.stopPropagation();
        pick(btn.dataset.apply || "style");
    }));

    const favBtn = card.querySelector("[data-favorite='toggle']");
    favBtn?.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await onToggleFavorite?.(artist, favBtn, mediaEl || favBtn);
        if (res?.ok && typeof res.favorited === "boolean") {
            favBtn.textContent = res.favorited ? "Unfavorite" : "Favorite";
        }
    });

    card.addEventListener("click", () => pick(isCharacter ? "trigger" : "style"));
    return card;
}
