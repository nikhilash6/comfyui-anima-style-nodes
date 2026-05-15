export function getBrowserTemplate(siteBase) {
    return `
            <div class="backdrop"></div>
            <div class="window">
                <div class="hdr">
                    <span class="hdr-title" style="margin-right:4px">Anima Style Explorer</span>
                    <button class="hdr-btn-txt" id="anima-cat-all" style="margin-left:8px; opacity:1;">All Styles</button>
                    <button class="hdr-btn-txt" id="anima-cat-fullet" style="opacity:0.5;">Fullet Prompts</button>
                    <button class="hdr-btn-txt" id="anima-cat-favorites" style="opacity:0.5;">Favorites</button>
                    <select class="hdr-select" style="margin-left:8px">
                        <option value="works">Popularity</option>
                        <option value="uniqueness">Uniqueness</option>
                        <option value="name">A - Z</option>
                    </select>
                    <div class="hdr-gap"></div>
                    <span class="anima-fullet-auth" id="anima-fullet-auth">API key not set</span>
                    <button class="hdr-btn-txt" id="anima-fullet-connect">Set API Key</button>
                    <button class="hdr-btn-txt" id="anima-fullet-disconnect" style="display:none;">Remove Key</button>
                    <button class="hdr-btn-txt" id="anima-fullet-upload">Publish Collage</button>
                    <div class="hdr-data-btns">
                        <div class="hdr-toggle-wrap" title="Show remote preview images from the internet">
                            <span class="hdr-toggle-label">Remote Images</span>
                            <label class="hdr-switch">
                                <input type="checkbox" id="anima-online-toggle"/>
                                <span class="hdr-slider"></span>
                            </label>
                        </div>
                        <div class="hdr-settings-wrap" title="Tools">
                            <button class="hdr-btn" id="anima-settings-gear" aria-label="Tools">&#9881;</button>
                            <div class="hdr-settings-menu">
                                <label class="hdr-settings-option" for="anima-keep-session">
                                    <input type="checkbox" id="anima-keep-session" />
                                    <span>Keep key after restart</span>
                                </label>
                                <button class="hdr-btn-txt hdr-settings-item" id="anima-update-styles">Update Styles</button>
                                <button class="hdr-btn-txt hdr-settings-item" id="anima-dl-images">Download Previews</button>
                            </div>
                        </div>
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
                    <button class="anima-swipe-btn" id="anima-swipe-btn" title="Swipe through styles one by one">Swipe Mode</button>
                    <div class="cycle-search">
                        <i>@</i>
                        <input type="text" placeholder="Search artists or prompts..." autocomplete="off" spellcheck="false"/>
                    </div>
                    <div class="cycle-gap"></div>
                    <span class="cycle-hint">Automatically queues prompts to test styles in a continuous loop</span>
                </div>
                <div class="body">
                    <div class="anima-grid" id="anima-grid">
                        <div class="anima-empty"><div class="anima-spinner"></div><span>Loading styles...</span></div>
                    </div>
                </div>
                <div class="anima-key-modal hidden" id="anima-key-modal">
                    <div class="anima-key-panel" id="anima-key-panel">
                        <div class="anima-key-header">
                            <div class="anima-key-copy">
                                <strong>Set Fullet API Key</strong>
                                <span>Generate a Personal API Key in your Fullet account settings, then paste it here. The key stays on this machine and is only sent to Fullet.</span>
                            </div>
                            <button class="hdr-close" id="anima-key-close" title="Close">&#10005;</button>
                        </div>
                        <div class="anima-key-body">
                            <a class="anima-key-link" href="https://fullet.lat/ajustes/anima-key" target="_blank" rel="noopener">Open Fullet API key settings</a>
                            <label class="anima-key-field">
                                <span>Personal API Key</span>
                                <textarea id="anima-key-input" rows="3" placeholder="fanm_xxxxxxxx.xxxxxxxxxxxxxxxxxxxxx"></textarea>
                            </label>
                            <p class="anima-key-hint">Tip: leave "Keep key after restart" off if you only want it for this ComfyUI session.</p>
                        </div>
                        <div class="anima-key-actions">
                            <button class="hdr-btn-txt" id="anima-key-save">Save Key</button>
                        </div>
                    </div>
                </div>
                <div class="anima-upload-modal hidden" id="anima-upload-modal">
                    <div class="anima-upload-panel" id="anima-upload-panel">
                        <div class="anima-upload-header">
                            <div class="anima-upload-copy">
                                <strong>Recent Anima Generations</strong>
                                <span>Select one image for a normal post, or select several @artist outputs to publish a style collage with comparison notes.</span>
                            </div>
                            <div class="anima-upload-tools">
                                <span class="anima-upload-selection" id="anima-upload-selection">0 selected</span>
                                <button class="hdr-btn-txt" id="anima-upload-selected" disabled>Publish Selected</button>
                                <button class="hdr-btn-txt" id="anima-upload-clear" disabled>Clear</button>
                                <button class="hdr-btn-txt" id="anima-upload-refresh">Refresh</button>
                                <button class="hdr-close" id="anima-upload-close" title="Close">&#10005;</button>
                            </div>
                        </div>
                        <div class="anima-upload-options">
                            <label class="anima-upload-option" for="anima-upload-nsfw">
                                <input type="checkbox" id="anima-upload-nsfw" />
                                <span class="anima-upload-option-title">Mark as NSFW</span>
                                <small>Publish this generation as adult content.</small>
                            </label>
                            <label class="anima-upload-option" for="anima-upload-preserve">
                                <input type="checkbox" id="anima-upload-preserve" checked />
                                <span class="anima-upload-option-title">Preserve metadata</span>
                                <small>Keep prompt, negative prompt, and extracted ComfyUI settings.</small>
                            </label>
                        </div>
                        <div class="anima-upload-body">
                            <div class="anima-upload-grid" id="anima-upload-grid"></div>
                        </div>
                    </div>
                </div>
                <div class="ftr">
                    <span class="ftr-count" id="anima-count"></span>
                    <span class="ftr-count"> | </span>
                    <span class="ftr-count">Node created by <a href="https://github.com/fulletLab" target="_blank" style="color:#d0d0e0;text-decoration:none;font-weight:600">fulletLab</a></span>
                    <div class="ftr-gap"></div>
                    <a class="ftr-link" href="${siteBase}" target="_blank" rel="noopener">thetacursed.github.io/Anima-Style-Explorer -&gt;</a>
                </div>
            </div>
    `;
}

