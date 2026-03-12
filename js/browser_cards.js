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
    const imageUrl = String(post?.displayImageUrl || post?.imageUrl || "").trim();
    const postUrl = String(post?.postUrl || "").trim();

    card.innerHTML = `
        <div class="anima-fullet-img" data-init="${escapeHtml((artist[0] || "?").toUpperCase())}">
            ${imageUrl ? `<img loading="lazy" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(artist)}" onerror="this.style.display='none';this.parentElement.classList.add('no-img')"/>` : ""}
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

    card.innerHTML = `
        <div class="anima-card-img" data-init="${escapeHtml((artist.tag?.[0] || "?").toUpperCase())}">
            <img loading="lazy" src="${escapeHtml(imageUrl)}" alt="${escapeHtml(artist.tag || "")}" onerror="this.style.display='none';this.parentElement.classList.add('no-img')"/>
            ${rankHtml}
            <div class="anima-card-overlay">
                <button class="anima-card-pick">Apply</button>
                <button class="anima-card-fav">${isFav ? "Unfavorite" : "Favorite"}</button>
            </div>
        </div>
        <div class="anima-card-meta">
            <span class="anima-card-tag" title="@${escapeHtml(String(artist.tag || "").replace(/_/g, " "))}">@${escapeHtml(String(artist.tag || "").replace(/_/g, " "))}</span>
            ${(!isUniq && artist.works) ? `<span class="anima-card-works">${Number(artist.works).toLocaleString()} works</span>` : ""}
        </div>
    `;

    const mediaEl = card.querySelector(".anima-card-img");

    card.addEventListener("mouseenter", () => {
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

    const pick = () => onApply?.(artist, mediaEl || card);
    card.querySelector(".anima-card-pick").addEventListener("click", (e) => {
        e.stopPropagation();
        pick();
    });

    const favBtn = card.querySelector(".anima-card-fav");
    favBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const res = await onToggleFavorite?.(artist, favBtn, mediaEl || favBtn);
        if (res?.ok && typeof res.favorited === "boolean") {
            favBtn.textContent = res.favorited ? "Unfavorite" : "Favorite";
        }
    });

    card.addEventListener("click", pick);
    return card;
}
