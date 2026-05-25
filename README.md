# Anima Style Explorer (Anima-2b)
![Anima Style Explorer](assets/banner.jpg)
A quality-of-life node for ComfyUI that adds artist and style browsing, visual selection, and prompt autocomplete directly inside the workflow.

> This is an independent community tool.
> It does **not** connect to or make requests to the original website.

---

## Installation

1. Download or clone this repository
2. Place the folder inside:

```
ComfyUI/custom_nodes/
```

3. Restart ComfyUI

The node will appear as:

```
Anima Style Explorer
```

---

## What it does

This node replaces the usual "type and guess" prompt workflow with an interactive style selector.

It works similarly to **CLIP Text Encode**:

* connect a CLIP model
* write your prompt
* send conditioning directly to KSampler

The node automatically injects the selected `@artist` tag into the prompt and encodes everything in a single step.

---

## Basic Workflow

```
CheckpointLoader
      |
   (clip) ──► Anima Style Explorer ──► (conditioning) ──► KSampler (positive)
                    |
                 prompt
```

No extra nodes required.

---

## Features

### Visual Style Browser

Open a gallery of 5000+ artists with thumbnails and preview references.
Click any artist to instantly apply it to the prompt.

### Prompt Autocomplete

Type `@` in the prompt box and a live suggestion list appears with previews.

### Random Style

Instantly injects a random artist into your prompt — useful for exploration and inspiration.

### Auto Cycle

Automatically queues generations while cycling artists one by one.
Great for discovering new styles hands-free.

### Update Styles

The node includes a built-in database of 20,000+ legacy artists plus dedicated **Animadex Styles** and **Characters** browser tabs. Enable **Show Animadex in All Styles** in the Browser tools menu only when you also want those entries mixed into the main All Styles tab, then click **Update Styles** to refresh the active source with local rate limiting.

### Publish Style Collages to Fullet

Connect a Fullet Personal API Key, open **Publish Collage**, and choose one or more recent local generations that include an `@artist` tag.

* one selected image publishes as a normal Anima post
* multiple selected images publish as one collage-style post
* collage posts include per-image prompt metadata plus a small style comparison based on the selected `@artist` tags and the bundled Anima dataset metrics

---

## Credits

Style explorer and dataset concept by @ThetaCursed
https://thetacursed.github.io/Anima-Style-Explorer

Legacy preview assets are loaded from:
https://github.com/ThetaCursed/Anima-Assets

Optional Animadex artist/character index:
https://animadex.net

All credit for the organization, tagging, and visual references belongs to its original creator.
If the original author requests any modification or removal of dataset content, it will be respected.

---

## Compatibility

* ComfyUI (latest)
* Anima 2B

---

## License

Code: MIT License

Dataset: Provided only for offline autocomplete and browsing functionality with attribution to the original project.
