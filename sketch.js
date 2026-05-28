window.exe = _ => eval(_);

function loadPNG(src) {
    return new Promise((resolve, reject) => {
        const img = document.createElement("img");
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = e => reject(e);
    });
}

await Canvas(window.innerWidth, window.innerHeight);
noSmooth();

// q5play copies `world`, `allSprites`, etc. onto `window`, but it does NOT
// expose `camera` as a global under plain q5 (only in its p5 fallback). The
// camera still lives on the q5 instance, so bridge it to a global here —
// otherwise every `camera.x` below throws "camera is not defined".
if (typeof camera === "undefined" || !camera) {
    window.camera = window.q5.instances[0].camera;
}

canvas.style.position = "fixed";
canvas.style.left = "0";
canvas.style.top = "0";
canvas.style.width = "100vw";
canvas.style.height = "100vh";

window.onresize = function() {
    resizeCanvas(window.innerWidth, window.innerHeight);
    camera.x = width / 2;
    camera.y = height / 2;
};
window.onresize();

allSprites.everyFrame = {};
allSprites.autoCull = false;

camera.zoom = 1;
camera.x = width / 2;
camera.y = height / 2;
world.gravity.y = 37;

// Cache-busted imports — the browser will otherwise happily serve an old
// startscreen.js / items.js / deathscreen.js that doesn't have a newly-added
// export, throwing "does not provide an export named X". Bump these when the
// exports of those modules change (the server also sends no-cache headers).
import { createProjectile, handleProjectileHit } from "./items.js?v=2";
import {
    initStartScreen,
    updateStartScreen,
    handleStartScreenClick,
    isStartScreenDone,
    drawPixelText,
    stopStartScreenMusic,
    startAlarm,
    stopAlarm,
} from "./startscreen.js?v=6";
import { GameOverScreen } from "./deathscreen.js?v=2";

// ============================================================
// Animator
// ============================================================
function createAnimator(sprite, frames, sequences) {
    const state = {
        baseName: null, baseFrame: 0, baseTimer: 0,
        oneShotName: null, oneShotFrame: 0, oneShotTimer: 0, oneShotOnComplete: null,
    };

    function primeTimer(name) { return sequences[name].blocks[0].duration; }

    function playBase(name) {
        if (state.baseName === name) return;
        if (!sequences[name]) { console.warn(`Animation "${name}" not found`); return; }
        state.baseName = name;
        state.baseFrame = 0;
        state.baseTimer = primeTimer(name);
    }

    function playOneShot(name, onComplete = null) {
        if (!sequences[name]) { console.warn(`Animation "${name}" not found`); return; }
        state.oneShotName = name;
        state.oneShotFrame = 0;
        state.oneShotTimer = primeTimer(name);
        state.oneShotOnComplete = onComplete;
    }

    function isOneShotPlaying() { return state.oneShotName !== null; }

    function advance(nameKey, frameKey, timerKey, loop, onEnd) {
        if (state[nameKey] === null) return;
        state[timerKey]--;
        if (state[timerKey] > 0) return;

        state[frameKey]++;
        const seq = sequences[state[nameKey]];

        if (state[frameKey] >= seq.blocks.length) {
            if (loop) {
                state[frameKey] = 0;
                state[timerKey] = seq.blocks[0].duration;
            } else {
                const cb = onEnd;
                state[nameKey] = null;
                state[frameKey] = 0;
                if (cb) cb();
            }
        } else {
            state[timerKey] = seq.blocks[state[frameKey]].duration;
        }
    }

    function update() {
        advance("baseName", "baseFrame", "baseTimer", true, null);
        const cb = state.oneShotOnComplete;
        advance("oneShotName", "oneShotFrame", "oneShotTimer", false, () => {
            state.oneShotOnComplete = null;
            if (cb) cb();
        });
    }

    function render() {
        const activeName = state.oneShotName || state.baseName;
        const activeFrame = state.oneShotName ? state.oneShotFrame : state.baseFrame;
        if (!activeName) { sprite.img = "\u{1f98a}"; return; }
        const list = frames[activeName];
        if (!list || list.length === 0) { sprite.img = "\u{1f98a}"; return; }
        sprite.img = list[activeFrame];
        sprite.scale.x = sprite.facingRight ? 1 : -1;
    }

    return { playBase, playOneShot, isOneShotPlaying, update, render };
}

// ============================================================
// Frame extraction
// ============================================================
async function extractFrameAsImage(sheetImage, srcX, srcY, frameWidth, frameHeight) {
    // Upscale on the canvas with imageSmoothing OFF so the soldier stays crisp
    // pixel art (bilinear blurring used to soften every edge of him).
    const scale = 20 / 3;
    const outW = Math.round(frameWidth  * scale);
    const outH = Math.round(frameHeight * scale);
    const c = document.createElement("canvas");
    c.width = outW; c.height = outH;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = false;
    try {
        ctx.drawImage(sheetImage, srcX, srcY, frameWidth, frameHeight, 0, 0, outW, outH);
    } catch (e) {
        console.warn("Failed to extract frame:", e);
        return null;
    }
    return await loadImage(c.toDataURL());
}

async function buildAnimationFrames(sheets, sequences) {
    const out = {};
    for (const [animName, seq] of Object.entries(sequences)) {
        out[animName] = [];
        for (const block of seq.blocks) {
            const sheet = sheets[block.sheet];
            if (!sheet || !sheet.image) { out[animName].push("\u{1f98a}"); continue; }
            let { x: sx, y: sy } = block.framePos;
            if (sx < 20 && sy < 20) { sx *= sheet.frameWidth; sy *= sheet.frameHeight; }
            const img = await extractFrameAsImage(sheet.image, sx, sy, sheet.frameWidth, sheet.frameHeight);
            out[animName].push(img || "\u{1f98a}");
        }
    }
    return out;
}

// ============================================================
// Asset data
// ============================================================
const spritesheets = {
    usIdle: { image: await loadPNG("./idle.png"), frameWidth: 31, frameHeight: 73 },
    usRun:  { image: await loadPNG("./run.png"),  frameWidth: 46, frameHeight: 70 },
    usFire: { image: await loadPNG("./fire.png"), frameWidth: 50, frameHeight: 73 },
};

const animationSequences = {
    "player.idle": { blocks: [
        { sheet: "usIdle", framePos: { x: 0, y: 0 }, duration: 10 },
        { sheet: "usIdle", framePos: { x: 1, y: 0 }, duration: 10 },
    ]},
    "player.run": { blocks: [
        { sheet: "usRun", framePos: { x: 2, y: 0 }, duration: 6 },
        { sheet: "usRun", framePos: { x: 1, y: 1 }, duration: 4 },
        { sheet: "usRun", framePos: { x: 2, y: 1 }, duration: 4 },
        { sheet: "usRun", framePos: { x: 0, y: 1 }, duration: 6 },
        { sheet: "usRun", framePos: { x: 0, y: 0 }, duration: 10 },
    ]},
    // Multi-frame attack animations — every attack cycles through several
    // poses (wind-up → release → recovery) so it reads as a real motion, not
    // a single jank frame. All frames come from the existing player sheets.
    "player.ground_punch.startup": { blocks: [
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 3 },   // step in
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 4 },   // jab extended
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 3 },   // pull back
    ]},
    "player.air_forward.startup": { blocks: [
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 3 },   // arm forward
        { sheet: "usRun", framePos: {x:1,y:1}, duration: 3 },   // strike
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 3 },   // recover
    ]},
    "player.air_explosion.startup": { blocks: [
        { sheet: "usFire", framePos: {x:3,y:0}, duration: 4 },   // charge
        { sheet: "usFire", framePos: {x:4,y:0}, duration: 5 },   // detonate
        { sheet: "usFire", framePos: {x:3,y:0}, duration: 4 },   // recoil
    ]},
    "player.molotov_throw.startup": { blocks: [
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 3 },   // reach for belt
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 3 },   // grab bottle
        { sheet: "usRun", framePos: {x:1,y:1}, duration: 4 },   // wind back
        { sheet: "usRun", framePos: {x:2,y:1}, duration: 4 },   // swing through
        { sheet: "usRun", framePos: {x:0,y:1}, duration: 4 },   // follow-through
    ]},
    "player.beer_throw.startup": { blocks: [
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 3 },
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 3 },
        { sheet: "usRun", framePos: {x:1,y:1}, duration: 4 },
        { sheet: "usRun", framePos: {x:2,y:1}, duration: 4 },
        { sheet: "usRun", framePos: {x:0,y:1}, duration: 4 },
    ]},
    "player.bullet.startup": { blocks: [
        { sheet: "usFire", framePos: {x:0,y:2}, duration: 2 },   // shoulder rifle
        { sheet: "usFire", framePos: {x:2,y:0}, duration: 3 },   // sight target
        { sheet: "usFire", framePos: {x:3,y:0}, duration: 3 },   // fire (muzzle)
        { sheet: "usFire", framePos: {x:4,y:0}, duration: 3 },   // recoil
        { sheet: "usFire", framePos: {x:0,y:2}, duration: 2 },   // lower rifle
    ]},
};

const animationFrames = await buildAnimationFrames(spritesheets, animationSequences);

const corridorBG = await loadImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAAoCAYAAADAOHfQAAAFCklEQVR4AexdPY4UPRD116Rf9mX7BdyAcCRyUqQl4hpcg7sQzAEgQwR7CoTQRpAiNmHxW7ZaNaZcbve6Sz3wpH7rnyq/Z5dd3b07I5gOh8MtwRjwDJzXGUgp3QLT1dVVKnFxcZGAsn9tG1yANR79gGVb0wcuoDYWNqBm7+0HF2CNQz9g2db0gQuojYUNqNl7+8EFWOPQD1i2NX3gAmpjYQNq9t5+cAHWOPQDlm1NH7iANWMxJifq3YU6gEa+4aJI091P/mAEGIHdRqBMWt02E/h4PA5djMfn2dZMosXXsvdqenyerVcH/i2+lh0cPfD4PFuPhvi2+Fp24VlaenyebSm/9hvBp5MW3NI2ExgOfwG4REbgrCIgSasnbSbw5eWl9nlw3ePzbGuEW3wte6+mx+fZenXg3+Jr2cHRA4/Ps/VoiG+Lr2UXnqWlx+fZlvJrv9F8mttMYO3AOiPACOw3AmYCP+id/dGrlDJub26SwOPzbM2wZZ0eLfBF6kVqcW2IQAWd5yR63yqzrnbLX6DhYCYwDDPuF49EWYQ88Pbb6/xzxRWphelF6kVqtdd2d5M92c88hvuWg1Be0ftW6httfCQlSWwm8PzOjslnAmxsD/KQk2vmO+n91ZhtAVpQjNSL1OLaXifvjCI+GvPe6M77+mwLOpP3sqsKM4E1E4Ki21vWI7Wwjki9SC2uDREYg+h9WzprPIXhayaw/A5w+fxjevHy5YMBoRoitTCHSL1ILa6t75wiXjVE71ttHq1+JLGZwDIQCxkF4ayVo3TAU9PQ/fAbBc1r1UfpgMfiL/vgNwold9kepQOekttqw++BSDLe4td94jei1Lwj62YCz78DDFLy+DzbGvkWX8veq+nxebZeHfi3+Fp2cPTA4/NsPRri2+Jr2YVnaenxebal/NpvNJ/mNhNYO7DOCDAC+42AmcB4ZRg5ZY/Ps62ZQ4uvZe/V9Pg8W68O/Ft8LTs4euDxebYeDfFt8bXswrO09Pg821J+7TeaT3ObCawduuv403uGfIkDZTfH0gFZB59lQkOwdOgqv0i9SC0EI1IvUusPX5uZwCfv7PfBRqKkR7++ZeXWc8DKP72f8GW7vk5sG2tBN1IvUotrc85mDs6ez2Se3urLTOCZDQmVG1h8D/KQ/itSC7OL1IvU4trML3QgLN2I3reOCV5fXyfATGD9zo7E7eA1XTVf6aBtW2tBO1IvUotrQwSWQ+9NOUrbIs5kqb+0Xf0cWF79Rn2RQ/isiYktQgv6kXqRWlxb3xc5ZG8QtxJiizqTpf6SNpIXftUnMO5CowHBEqM1hK/UkbbY+8vj/AWA4/H4W134dXk0/Eb0aQ1dH8FtcWgNqVt+I/qEvyxHcFscpQ7alt+IPnCPhpnAo0XIxwgwAttEgAm8TVzJygiERIAJHBJmijAC20SACbxNXP8wVi5nTxHAx0cyHyawRIIlI7DzCMi/woF/nVKSmAm8803j9BgBREAnL9oC/N9ICUbiwDgcGIO95gESFk9elADqeApPb66+J4Ix4BmonYH99H9KT5IG9mx6+v/XRDAGPAPneQb4OzDeRwhG4EwjMH3+8jgRjAHPwHmegendv+/TPzcfEkvGgefg/PJgevZ1Sm//+5E2KcnLuPJ8bZpfE5OXNy/evM/3IcYnMJ8Qmz4heHPY9ubAJzBf8/maf8Y3cT6Bt9o88vLJHvBw4BM4IMh8jdz2NfJvju9PAAAA//+D7uq9AAAABklEQVQDABKMPA4wFkJmAAAAAElFTkSuQmCC");

// ============================================================
// Crate / turret / key art. These are individual PNGs (with spaces in
// some filenames). We round-trip each through a canvas + data URL so we
// always end up with a real q5 image at the display size — the same
// trick extractFrameAsImage() uses for the player sprite sheets.
// ============================================================
async function loadGameImage(src, w, h) {
    // Upscale the PNG to (w,h) on a canvas with imageSmoothing OFF so the
    // resulting q5 image is crisp pixel art instead of a blurry bilinear blob.
    const dom = await loadPNG(encodeURI(src));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(dom, 0, 0, dom.naturalWidth, dom.naturalHeight, 0, 0, w, h);
    return await loadImage(c.toDataURL());
}

// Same as loadGameImage but also measures how many transparent rows sit at the
// bottom of the source PNG. Used to ground sprites whose art has empty padding
// (the sprite's collider sits on the floor, but the *visible* part of the art
// stops short of the collider bottom, making it look like it's floating).
// Returned `bottomPad` is in OUTPUT pixels (scaled to the requested h).
async function loadGameImageGrounded(src, w, h) {
    const dom = await loadPNG(encodeURI(src));
    const c = document.createElement("canvas");
    c.width = dom.naturalWidth;
    c.height = dom.naturalHeight;
    const ctx = c.getContext("2d");
    ctx.drawImage(dom, 0, 0);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let lastVisibleRow = c.height - 1;
    for (let r = c.height - 1; r >= 0; r--) {
        let any = false;
        for (let col = 0; col < c.width; col++) {
            if (data[(r * c.width + col) * 4 + 3] > 8) { any = true; break; }
        }
        if (any) { lastVisibleRow = r; break; }
    }
    const padPx = c.height - 1 - lastVisibleRow;
    const bottomPad = padPx * (h / c.height);
    const img = await loadImage(c.toDataURL());
    img.resize(w, h);
    return { img, bottomPad };
}

// q5play only renders a sprite's IMG, not a plain `.color` fill — so generated
// projectiles/debris need a real image to be visible. These build one on a
// scratch canvas and hand back a q5 image.
async function makeCircleImg(d, coreColor, edgeColor) {
    const c = document.createElement("canvas");
    c.width = d; c.height = d;
    const ctx = c.getContext("2d");
    ctx.fillStyle = edgeColor;
    ctx.beginPath(); ctx.arc(d / 2, d / 2, d / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = coreColor;
    ctx.beginPath(); ctx.arc(d / 2, d / 2, d * 0.32, 0, Math.PI * 2); ctx.fill();
    return await loadImage(c.toDataURL());
}
async function makeSquareImg(d, color, edgeColor) {
    const c = document.createElement("canvas");
    c.width = d; c.height = d;
    const ctx = c.getContext("2d");
    ctx.fillStyle = edgeColor; ctx.fillRect(0, 0, d, d);
    ctx.fillStyle = color; ctx.fillRect(2, 2, d - 4, d - 4);
    return await loadImage(c.toDataURL());
}

// ------------------------------------------------------------
// Attack & prop art — all generated on a scratch canvas with
// imageSmoothing OFF so they keep that crisp 8-bit edge.
// ------------------------------------------------------------
function freshCanvas(w, h) {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    return { c, ctx };
}

// Brass-cased rifle bullet — replaces the player's '▪️' emoji.
async function makeRifleBulletImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    ctx.strokeStyle = "#1a0c00"; ctx.lineWidth = 2;
    // brass casing body
    ctx.fillStyle = "#a8702a";
    ctx.fillRect(2, h * 0.25, w * 0.55, h * 0.5);
    ctx.fillStyle = "#f0d68a";  // top highlight
    ctx.fillRect(2, h * 0.3, w * 0.55, h * 0.12);
    ctx.strokeRect(2, h * 0.25, w * 0.55, h * 0.5);
    // lead tip (triangle pointing right)
    ctx.fillStyle = "#cfcfcf";
    ctx.beginPath();
    ctx.moveTo(w * 0.57, h * 0.18);
    ctx.lineTo(w - 2,    h / 2);
    ctx.lineTo(w * 0.57, h * 0.82);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // tip highlight
    ctx.fillStyle = "#fff";
    ctx.fillRect(w * 0.6, h * 0.35, w * 0.2, 2);
    return await loadImage(c.toDataURL());
}

// Soviet-style longneck beer bottle — green glass, red foil cap, yellow label.
async function makeBeerBottleImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    ctx.strokeStyle = "#000"; ctx.lineWidth = 2;
    // body
    const bx = w * 0.18, by = h * 0.32, bw = w * 0.64, bh = h * 0.62;
    ctx.fillStyle = "#1f5a26";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#3aa040";    // left highlight
    ctx.fillRect(bx + 2, by + 3, 5, bh - 8);
    ctx.strokeRect(bx, by, bw, bh);
    // shoulder
    ctx.fillStyle = "#1f5a26";
    ctx.beginPath();
    ctx.moveTo(bx,    by + 3);
    ctx.lineTo(bx + bw, by + 3);
    ctx.lineTo(bx + bw * 0.78, by - 8);
    ctx.lineTo(bx + bw * 0.22, by - 8);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // neck
    ctx.fillStyle = "#1f5a26";
    ctx.fillRect(w * 0.38, h * 0.14, w * 0.24, h * 0.16);
    ctx.strokeRect(w * 0.38, h * 0.14, w * 0.24, h * 0.16);
    // red foil cap
    ctx.fillStyle = "#c8242a";
    ctx.fillRect(w * 0.36, h * 0.05, w * 0.28, h * 0.11);
    ctx.strokeRect(w * 0.36, h * 0.05, w * 0.28, h * 0.11);
    ctx.fillStyle = "#ff5a60";    // cap highlight
    ctx.fillRect(w * 0.38, h * 0.06, 4, h * 0.08);
    // yellow paper label with red bar (Soviet vibe)
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(bx + 2, by + bh * 0.28, bw - 4, bh * 0.32);
    ctx.fillStyle = "#c8242a";
    ctx.fillRect(bx + 2, by + bh * 0.34, bw - 4, 4);
    ctx.strokeRect(bx + 2, by + bh * 0.28, bw - 4, bh * 0.32);
    return await loadImage(c.toDataURL());
}

// Molotov cocktail — amber fluid, burning rag wick.
async function makeMolotovImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    ctx.strokeStyle = "#1a0c00"; ctx.lineWidth = 2;
    // body with amber fluid
    const bx = w * 0.18, by = h * 0.36, bw = w * 0.64, bh = h * 0.55;
    ctx.fillStyle = "#c8852a";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#ffce62";
    ctx.fillRect(bx + 2, by + 3, 5, bh - 8);
    ctx.strokeRect(bx, by, bw, bh);
    // neck
    ctx.fillStyle = "#9a6620";
    ctx.fillRect(w * 0.38, h * 0.22, w * 0.24, h * 0.18);
    ctx.strokeRect(w * 0.38, h * 0.22, w * 0.24, h * 0.18);
    // rag wick (dirty white cloth)
    ctx.fillStyle = "#e8d8a0";
    ctx.fillRect(w * 0.42, h * 0.1, w * 0.16, h * 0.16);
    ctx.strokeRect(w * 0.42, h * 0.1, w * 0.16, h * 0.16);
    // flame above the rag
    ctx.fillStyle = "#ff5a1a";
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.08, w * 0.16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.08, w * 0.08, 0, Math.PI * 2); ctx.fill();
    return await loadImage(c.toDataURL());
}

// Molotov FIRE BURST — big radial flame with licks and a white-hot core.
async function makeMolotovBlastImg(d) {
    const { c, ctx } = freshCanvas(d, d);
    // outer dark-red glow
    ctx.fillStyle = "#7a1208";
    ctx.beginPath(); ctx.arc(d/2, d/2, d/2, 0, Math.PI*2); ctx.fill();
    // orange
    ctx.fillStyle = "#ff5a1a";
    ctx.beginPath(); ctx.arc(d/2, d/2, d * 0.42, 0, Math.PI*2); ctx.fill();
    // yellow
    ctx.fillStyle = "#ffd24a";
    ctx.beginPath(); ctx.arc(d/2, d/2, d * 0.28, 0, Math.PI*2); ctx.fill();
    // white-hot core
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.arc(d/2, d/2, d * 0.1, 0, Math.PI*2); ctx.fill();
    // flame licks around the rim
    ctx.fillStyle = "#ff9a3a";
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + 0.31;
        ctx.beginPath();
        ctx.arc(d/2 + Math.cos(a) * d * 0.43, d/2 + Math.sin(a) * d * 0.43, d * 0.1, 0, Math.PI * 2);
        ctx.fill();
    }
    return await loadImage(c.toDataURL());
}

// Cartoon "POW!" starburst for melee hits — drawn at the contact point so the
// invisible-fist swing actually reads as a punch.
async function makePunchBurstImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    const cx = w/2, cy = h/2;
    const outerR = Math.min(w, h) / 2 - 4;
    const innerR = outerR * 0.55;
    const spikes = 10;
    ctx.fillStyle = "#ffe066";
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
        const r = (i % 2 === 0) ? outerR : innerR;
        const a = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.fillStyle = "#ff9a3a";
    ctx.beginPath(); ctx.arc(cx, cy, innerR * 0.7, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = "#ffe066";
    ctx.beginPath(); ctx.arc(cx, cy, innerR * 0.4, 0, Math.PI*2); ctx.fill();
    return await loadImage(c.toDataURL());
}

// Concentric shockwave rings for the omnidirectional air-explosion attack.
async function makeAirExplosionImg(d) {
    const { c, ctx } = freshCanvas(d, d);
    const cols = ["#ffffff", "#ffe066", "#ff9a3a", "#ff5a1a", "#7a1208"];
    for (let i = 0; i < cols.length; i++) {
        ctx.strokeStyle = cols[i]; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(d/2, d/2, d/2 - 4 - i * 8, 0, Math.PI * 2); ctx.stroke();
    }
    return await loadImage(c.toDataURL());
}

// Wooden command desk for the level-5 ending scene.
async function makeDeskImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    ctx.fillStyle = "#7a4a20"; ctx.fillRect(0, 0, w, h * 0.22);            // top plank
    ctx.fillStyle = "#5a3414"; ctx.fillRect(0, h * 0.22 - 5, w, 5);        // lip shadow
    ctx.fillStyle = "#a06a30"; ctx.fillRect(0, 0, w, 4);                   // top highlight
    ctx.fillStyle = "#4a2a14";
    ctx.fillRect(8, h * 0.22, 16, h - h * 0.22);                            // left leg
    ctx.fillRect(w - 24, h * 0.22, 16, h - h * 0.22);                       // right leg
    ctx.fillStyle = "#3a1f0c"; ctx.fillRect(28, h * 0.22 + 6, w - 56, 10); // panel
    return await loadImage(c.toDataURL());
}

// Big red 8-bit launch-abort button — dome on a riveted metal base.
async function makeButtonImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);
    ctx.fillStyle = "#3a3a4a"; ctx.fillRect(w * 0.08, h * 0.55, w * 0.84, h * 0.4);
    ctx.fillStyle = "#5a5a72"; ctx.fillRect(w * 0.08, h * 0.55, w * 0.84, 4);
    ctx.fillStyle = "#1a1a26"; ctx.fillRect(w * 0.08, h * 0.55 + h * 0.4 - 4, w * 0.84, 4);
    ctx.fillStyle = "#ffe066";
    ctx.beginPath(); ctx.arc(w * 0.18, h * 0.85, 3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(w * 0.82, h * 0.85, 3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#9a0810";
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.5, w * 0.4, h * 0.32, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#d8242a";
    ctx.beginPath(); ctx.ellipse(w / 2, h * 0.48, w * 0.35, h * 0.27, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8a90";
    ctx.beginPath(); ctx.ellipse(w * 0.42, h * 0.38, w * 0.1, h * 0.06, 0, 0, Math.PI * 2); ctx.fill();
    return await loadImage(c.toDataURL());
}

// 8-bit pixel-art flame (Mario-style). Drawn block-by-block from a bitmap so
// every pixel is a chunky square — no smooth curves. The base sits on the
// image's bottom edge so a sprite placed at floor level reads as fire ON the
// ground. Palette: dark red → orange → yellow → white-hot core.
const FIRE_BMP = [
    "0001111000",
    "0012222100",
    "0123333210",
    "0123433210",
    "1234443321",
    "1234444321",
    "1234443321",
    "1233333321",
    "1122322211",
    "0112221110",
];
const FIRE_PALETTE = [null, "#7a0810", "#ff5a1a", "#ffd24a", "#ffffff"];

async function makePixelArtImg(bitmap, palette, scale) {
    const srcH = bitmap.length;
    const srcW = bitmap[0].length;
    const c = document.createElement("canvas");
    c.width = srcW * scale;
    c.height = srcH * scale;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < srcH; r++) {
        for (let col = 0; col < srcW; col++) {
            const idx = bitmap[r].charCodeAt(col) - 48;       // '0'..'9' -> 0..9
            if (idx <= 0 || idx >= palette.length) continue;
            ctx.fillStyle = palette[idx];
            ctx.fillRect(col * scale, r * scale, scale, scale);
        }
    }
    return await loadImage(c.toDataURL());
}

async function makeFireImg(_w, _h) {
    // Chunky 10×10 source pixels upscaled to 10 px each → 100×100 final image.
    return await makePixelArtImg(FIRE_BMP, FIRE_PALETTE, 10);
}

// Soviet-era bunker door — full-corridor height, deep red, gold star &
// hammer-and-sickle, gold bolts and handle. Side-view 8-bit feel.
function drawStar(ctx, cx, cy, r, color, outline) {
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const rad = (i % 2 === 0) ? r : r * 0.48;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    if (outline) { ctx.strokeStyle = outline; ctx.lineWidth = 2; ctx.stroke(); }
}
function drawHammerSickle(ctx, cx, cy, size) {
    ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 4; ctx.lineCap = "round";
    // sickle (arc)
    ctx.beginPath();
    ctx.arc(cx - size * 0.15, cy, size * 0.42, Math.PI * 0.45, Math.PI * 1.85);
    ctx.stroke();
    // hammer handle (diagonal)
    ctx.beginPath();
    ctx.moveTo(cx - size * 0.32, cy + size * 0.42);
    ctx.lineTo(cx + size * 0.36, cy - size * 0.32);
    ctx.stroke();
    // hammer head (rectangle perpendicular to handle tip)
    ctx.fillStyle = "#ffe066";
    ctx.save();
    ctx.translate(cx + size * 0.36, cy - size * 0.32);
    ctx.rotate(-Math.PI / 4 + Math.PI / 2);
    ctx.fillRect(-size * 0.22, -size * 0.1, size * 0.42, size * 0.18);
    ctx.restore();
}
async function makeDoorImg(w, h) {
    const { c, ctx } = freshCanvas(w, h);

    // outermost dark border (riveted frame)
    ctx.fillStyle = "#0a0606"; ctx.fillRect(0, 0, w, h);
    // riveted metal jamb
    ctx.fillStyle = "#3a1a14"; ctx.fillRect(6, 6, w - 12, h - 12);

    // door panel proper — deep Soviet red
    const dx = 14, dy = 14, dw = w - 28, dh = h - 28;
    ctx.fillStyle = "#a01018"; ctx.fillRect(dx, dy, dw, dh);
    // darker shadow on the right and bottom edges
    ctx.fillStyle = "#660810"; ctx.fillRect(dx + dw - 10, dy, 10, dh);
    ctx.fillStyle = "#660810"; ctx.fillRect(dx, dy + dh - 10, dw, 10);
    // top highlight
    ctx.fillStyle = "#c83040"; ctx.fillRect(dx, dy, dw, 6);
    ctx.fillStyle = "#c83040"; ctx.fillRect(dx, dy, 6, dh);

    // top band with gold trim — frames the star
    ctx.fillStyle = "#7a0810"; ctx.fillRect(dx + 8, dy + 18, dw - 16, h * 0.18);
    ctx.fillStyle = "#ffe066"; ctx.fillRect(dx + 8, dy + 18, dw - 16, 3);
    ctx.fillStyle = "#ffe066"; ctx.fillRect(dx + 8, dy + 18 + h * 0.18 - 3, dw - 16, 3);

    // central gold star
    drawStar(ctx, w / 2, dy + 18 + h * 0.09, Math.min(w * 0.16, 30), "#ffe066", "#000");

    // hammer & sickle (smaller, mid-upper section)
    drawHammerSickle(ctx, w / 2, h * 0.34, Math.min(w * 0.36, 70));

    // mid horizontal divider
    ctx.fillStyle = "#660810";
    ctx.fillRect(dx + 8, h * 0.48, dw - 16, 4);
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(dx + 8, h * 0.48 - 2, dw - 16, 2);

    // EXIT plaque (red on gold)
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(dx + dw * 0.18, h * 0.55, dw * 0.64, h * 0.07);
    ctx.fillStyle = "#0a0606";
    ctx.fillRect(dx + dw * 0.18, h * 0.55, dw * 0.64, 3);
    ctx.fillRect(dx + dw * 0.18, h * 0.55 + h * 0.07 - 3, dw * 0.64, 3);
    ctx.fillStyle = "#7a0810";
    ctx.font = `bold ${Math.floor(h * 0.045)}px sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("ВЫХОД", w / 2, h * 0.585);

    // handle (gold vertical bar)
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(w * 0.7, h * 0.68, 9, h * 0.14);
    ctx.strokeStyle = "#0a0606"; ctx.lineWidth = 2;
    ctx.strokeRect(w * 0.7, h * 0.68, 9, h * 0.14);
    // keyhole
    ctx.fillStyle = "#0a0606";
    ctx.beginPath(); ctx.arc(w * 0.8, h * 0.74, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(w * 0.8 - 3, h * 0.74, 6, 16);

    // gold bolts in the corners
    const bolt = (bx, by) => {
        ctx.fillStyle = "#ffe066"; ctx.beginPath(); ctx.arc(bx, by, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#0a0606"; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = "#a07028"; ctx.fillRect(bx - 4, by - 1, 8, 2);   // slot
    };
    bolt(dx + 14, dy + 14); bolt(dx + dw - 14, dy + 14);
    bolt(dx + 14, dy + dh - 14); bolt(dx + dw - 14, dy + dh - 14);
    bolt(dx + 14, dy + dh / 2); bolt(dx + dw - 14, dy + dh / 2);

    return await loadImage(c.toDataURL());
}

// Sized to read at roughly the player's scale so attacks (especially the
// flat bullet, which travels at ~player chest height) actually intersect them.
const CRATE_W = 150, CRATE_H = 170;
const TURRET_W = 260, TURRET_H = 240;   // big, grounded, player-tracking turrets
const KEY_W = 80, KEY_H = 46;

const crateFrames = {
    full:   await loadGameImage("./crate.png",        CRATE_W, CRATE_H),
    hit:    await loadGameImage("./crate hit 2.png",  CRATE_W, CRATE_H),
    broken: await loadGameImage("./crate broken.png", CRATE_W, CRATE_H),
};
const turretFrames = {
    idle:      await loadGameImage("./turret idle.png",      TURRET_W, TURRET_H),
    fire:      await loadGameImage("./turret fire 2.png",    TURRET_W, TURRET_H),
    destroyed: await loadGameImage("./turret destroyed.png", TURRET_W, TURRET_H),
};

// Empirical floor-nudge for the turret. The art has faint pixels in its lower
// rows (probably a soft drop shadow) so an automatic transparent-row scan only
// finds ~6 px of bottom padding — but the user-visible turret base actually
// ends ~57 px above the image bottom. This number was measured against the
// canvas after rendering (player floats 1 px, turret floated 57 px) and drops
// the turret onto the floor so its treads sit on the red surface line.
// Push the turret's visible base INTO the floor strip so it reads as planted
// (matching how the player's boots extend slightly past the red surface line)
// rather than barely-touching-the-edge, which looks like floating.
const TURRET_FLOOR_NUDGE = 95;
const keyImg = await loadGameImage("./key.png", KEY_W, KEY_H);

// Generated art for things q5play won't draw from a .color alone.
const DEBRIS_COLORS = ["#8a5a2b", "#6b4423", "#a9712f"];
const turretShotImg = await makeCircleImg(52, "#fff1a8", "#ff5a1a");  // glowing enemy shell
const debrisImgs = await Promise.all(DEBRIS_COLORS.map((col) => makeSquareImg(18, col, "#241405")));

// Attack & prop sprites.
const rifleBulletImg   = await makeRifleBulletImg(60, 26);     // player's rifle round
const beerBottleImg    = await makeBeerBottleImg(48, 84);      // Soviet beer bottle
const molotovImg       = await makeMolotovImg(48, 90);         // molotov w/ burning rag
const molotovBlastImg  = await makeMolotovBlastImg(320);       // BIG fire burst (replaces 💥)
const punchBurstImg    = await makePunchBurstImg(120, 90);     // melee POW! starburst
const airExplosionImg  = await makeAirExplosionImg(260);       // omnidirectional shockwave
// Soviet exit door — wide enough to dominate the whole right side, and full
// SCREEN height so it covers everything top to bottom (incl. the lower exit
// beneath the surface line).
const SOVIET_DOOR_W = 500;
const SOVIET_DOOR_H = height;
const doorImg = await makeDoorImg(SOVIET_DOOR_W, SOVIET_DOOR_H);
const fireSpriteImg    = await makeFireImg(96, 110);            // ground-fire patch (molotov)
const deskImg          = await makeDeskImg(320, 170);           // big command desk
const buttonImg        = await makeButtonImg(160, 130);          // big red launch-abort button

// Crate art also has invisible padding at the bottom that makes it look like
// it's floating — bumped again because they STILL look like they're floating.
const CRATE_FLOOR_NUDGE = 60;

// Expose the generated art so items.js (loaded as a module) can grab it from
// `window` rather than needing its own import.
window.rifleBulletImg  = rifleBulletImg;
window.beerBottleImg   = beerBottleImg;
window.molotovImg      = molotovImg;
window.molotovBlastImg = molotovBlastImg;
window.punchBurstImg   = punchBurstImg;
window.airExplosionImg = airExplosionImg;
window.doorImg         = doorImg;
window.fireSpriteImg   = fireSpriteImg;
// items.js uses these from `window` for its landing splash + reference data.
window.spawnDebrisGlobal = (x, y, n) => spawnDebris(x, y, n);

// Damage by attack type for turrets (100 HP, no visible bar). Shooting is
// the most lethal, thrown bottles second, melee (ground/air) the least.
// Crates ignore this table — they always break in 3 hits regardless.
const ATTACK_DAMAGE = {
    bullet: 34,
    beer_throw: 20,
    molotov_explosion: 22,
    ground_punch: 8,
    air_forward: 8,
    air_explosion: 6,
};

// ============================================================
// World setup
// ============================================================
let player;
let ground;
let walls = [];
let doors = [];
let surfaceY;

{
    window.worldAnchor = Sprite.withSensor(0, 0, 37, 37, "static");

    window.terrain = new Group();
    terrain.physics = "static";
    terrain.bounciness = 0;

    // Floor is invisible; the player visually stands on the black bar with red
    // outlines painted into the background. That bar's top red line sits at
    // row 29 of the 40px-tall background image, which is scaled to fill the
    // screen height, so the walkable surface is height * (29/40).
    surfaceY = height * (29 / 40);
    const doorHeight = 200;

    ground = new terrain.Sprite(37000, surfaceY + 37, 80000, 74);
    ground.visible = false;

    for (let i = 0; i <= 12; i++) {
        const wx = (i * 6) * height - width * 0.5;
        walls[i] = new terrain.Sprite(wx, (surfaceY - doorHeight) * 0.5, 74, surfaceY - doorHeight);
        doors[i] = new terrain.Sprite(wx, surfaceY - doorHeight * 0.5, 67, doorHeight);
        doors[i].color = "#bababa";
        if (i === 0) {
            // Back boundary at x≈-640: still SOLID (the player can't walk off
            // the back of the level) but FULLY INVISIBLE — opacity 0.
            walls[i].opacity = 0;
            doors[i].opacity = 0;
            walls[i].visible = false;
            doors[i].visible = false;
        }
    }

    player = new Sprite(0, 300, 100, 180);
    player.facingRight = true;
    player.color = "white";
    player.rotationLock = true;
    player.friction = 0;
    player.bounciness = 0;

    // Destructible crates and rising turrets. Members are created lazily in
    // spawnLevelEntities() (called on each playthrough) so a restart always
    // gets a fresh, fully-repaired layout.
    window.crates = new Group();
    window.turrets = new Group();
    window.turretShots = new Group();   // shells fired BY active turrets at the player
    window.surfaceY = surfaceY;         // expose to items.js for ground-fire placement
}

// ============================================================
// Player state + animator
// ============================================================
let pdata = {
    attackCooldown: 0,
    groundedTimer: 0,
    activeAttacks: new Group(),
    pendingAttack: null,
    inventory: [],
    airborne: false,
    hp: 100,
};

const anim = createAnimator(player, animationFrames, animationSequences);
anim.playBase("player.idle");

pdata.activeAttacks.overlaps(crates, handleHit);
pdata.activeAttacks.overlaps(turrets, handleHit);
pdata.activeAttacks.overlaps(terrain, handleHit);
player.passes(pdata.activeAttacks);

// Active turrets shoot the player (sensor shells), and the player boots crates
// around like a soccer ball just by walking into them (crates are solid bodies).
player.overlaps(turretShots, onPlayerShot);
player.collides(crates, kickCrate);

// ============================================================
// Screen state machine
// ============================================================
let gameState = "startscreen"; // "startscreen" | "playing" | "gameover"

initStartScreen();
let gameOverScreen = null;
let stashedSprites = [];

function setWorldVisible(visible) {
    console.log("setWorldVisible:", visible);
    
    if (!visible) {
        // Move everything far away so it doesn't render
        for (const s of allSprites) {
            stashedSprites.push({
                sprite: s,
                x: s.x,
                y: s.y,
                vx: s.vel ? s.vel.x : 0,
                vy: s.vel ? s.vel.y : 0,
                visible: s.visible,
            });
            s.x = -999999;
            s.y = -999999;
            if (s.vel) { s.vel.x = 0; s.vel.y = 0; }
            s.visible = false;
        }
    } else {
        // Restore everything
        for (const stash of stashedSprites) {
            stash.sprite.x = stash.x;
            stash.sprite.y = stash.y;
            if (stash.sprite.vel) {
                stash.sprite.vel.x = stash.vx;
                stash.sprite.vel.y = stash.vy;
            }
            // Restore the sprite's prior visibility rather than forcing it
            // visible, so intentionally-hidden sprites (e.g. the invisible
            // ground) stay hidden after the title screen.
            stash.sprite.visible = stash.visible;
        }
        stashedSprites = [];
        // Also clear active attacks if any
        for (const a of [...pdata.activeAttacks]) a.delete();
    }
}
setWorldVisible(false); // start hidden during the title screen

// p5/q5 dispatches mouse clicks to a global mousePressed function
window.mousePressed = function() {
    if (gameState === "startscreen") {
        handleStartScreenClick(mouseX, mouseY);
    } else if (gameState === "gameover" && gameOverScreen && gameOverScreen.onContinue) {
        // Click anywhere on the death screen to respawn (matches space/enter).
        gameOverScreen.onContinue();
    }
};

// ============================================================
// Viewport / floor sync
// ============================================================
// The world is sized to the LIVE canvas height: surfaceY = height*(29/40) and
// the corridor walls are spaced by 6*height. The background (with its painted
// red floor line at row 29/40) is redrawn to fill `height` every frame, but the
// PHYSICS floor (surfaceY, the invisible `ground` body, the walls/doors) was
// computed once at boot. Going fullscreen / resizing the window changes
// `height`, so the painted floor moves down while the physics floor stays put —
// and the player (resting on the stale physics floor) appears to float above
// the visible floor. Fix: whenever the height changes, re-derive the floor
// geometry to the new height and shift the live entities so they keep resting
// on it. (Vertical world coords == screen coords here: camera.y is height/2 and
// zoom is 1, so surfaceY in world space lands exactly on screen-y surfaceY.)
let _layoutH = -1;

function repositionFloor() {
    surfaceY = height * (29 / 40);
    window.surfaceY = surfaceY;
    const doorHeight = 200;
    if (ground) ground.y = surfaceY + 37;
    for (let i = 0; i < walls.length; i++) {
        const wx = (i * 6) * height - width * 0.5;
        if (walls[i]) {
            walls[i].x = wx;
            walls[i].y = (surfaceY - doorHeight) * 0.5;
            walls[i].h = surfaceY - doorHeight;
        }
        if (doors[i]) {
            doors[i].x = wx;
            doors[i].y = surfaceY - doorHeight * 0.5;
        }
    }
}

function shiftWorldEntities(delta) {
    if (!delta) return;
    if (player) player.y += delta;
    for (const g of [crates, turrets, turretShots, pdata.activeAttacks]) {
        if (!g) continue;
        for (const s of g) {
            s.y += delta;
            if (s.restY !== undefined) s.restY += delta;   // keep rest/hover anchor on the floor
        }
    }
    if (levelDoor) levelDoor.y += delta;
}

// Call every gameplay frame; cheap no-op unless the canvas height changed.
function syncFloorToViewport() {
    if (height === _layoutH) return;
    const prevSurfaceY = surfaceY;
    repositionFloor();
    if (_layoutH >= 0) shiftWorldEntities(surfaceY - prevSurfaceY);
    _layoutH = height;
}

function resetGameplayPositions() {
    // Make sure the floor matches the current window height before placing the
    // player (handles the case where the user resized during the title screen).
    repositionFloor();

    // Player back to spawn
    player.x = 0;
    player.y = 300;
    player.vel.x = 0;
    player.vel.y = 0;
    player.color = "white";

    // Fresh run: zero the score, back to level 1, and reset the level to its
    // pre-trip-line state (nothing spawned until the player crosses the line).
    score = 0;
    levelNum = 1;
    // Re-create any corridor wall/door barriers a prior run tore down past
    // level 2. Only re-add ones that are missing — don't duplicate existing.
    {
        const dh = 200;
        for (let i = 0; i <= 12; i++) {
            if (walls[i]) continue;
            const wx = (i * 6) * height - width * 0.5;
            walls[i] = new terrain.Sprite(wx, (surfaceY - dh) * 0.5, 74, surfaceY - dh);
            doors[i] = new terrain.Sprite(wx, surfaceY - dh * 0.5, 67, dh);
            doors[i].color = "#bababa";
            if (i === 0) {
                walls[i].opacity = 0; doors[i].opacity = 0;
                walls[i].visible = false; doors[i].visible = false;
            }
        }
    }
    resetLevel();

    // Camera back to start
    camera.x = width / 2;
    _layoutH = height;   // floor is freshly laid out for this height
}
function restartGame() {
    // Re-enable the sprite-draw pass that gameover turned off.
    allSprites._autoDraw = true;

    // Drop any leftover stash so the player isn't bounced to its death spot,
    // and CLEAR every in-flight attack/turret-shot so nothing hits us on frame 1.
    stashedSprites = [];
    for (const a of [...pdata.activeAttacks]) a.delete();
    for (const s of [...turretShots]) s.delete();

    // Player back to a known good state — explicit position, zero velocity,
    // upright, visible, full hp.
    player.x = 0;
    player.y = 300;
    player.vel.x = 0;
    player.vel.y = 0;
    player.rotation = 0;
    player.scale.x = 1; player.scale.y = 1;
    player.color = "white";
    player.facingRight = true;
    player.visible = true;
    delete player.everyFrame.hurt;       // clear any in-progress damage flash

    pdata.hp = 100;
    pdata.attackCooldown = 0;
    pdata.pendingAttack = null;
    pdata.groundedTimer = 0;
    pdata.airborne = false;

    // Fresh score/level/level-state.
    score = 0;
    levelNum = 1;
    resetLevel();

    // Camera back to start, animator back to idle.
    camera.x = width / 2;
    camera.y = height / 2;
    anim.playBase("player.idle");
}
// ============================================================
// Input -> intended actions
// ============================================================
function computePlayerActions(pdata, player, kb) {
    const actions = {
        moveX: 0, facingRight: player.facingRight, jump: false, attack: null,
        chargeStart: null, chargeRelease: null,
    };

    if (kb.pressing("left"))       { actions.moveX = -10; actions.facingRight = false; }
    else if (kb.pressing("right")) { actions.moveX =  10; actions.facingRight = true;  }

    if (kb.presses("up") && pdata.groundedTimer > 0) actions.jump = true;

    if (kb.presses("space") && pdata.attackCooldown === 0) {
        const isGrounded = pdata.groundedTimer > 0;
        const holdingForward = (player.facingRight && kb.pressing("right")) || (!player.facingRight && kb.pressing("left"));
        if (isGrounded)        actions.attack = "ground_punch";
        else if (holdingForward) actions.attack = "air_forward";
        else                     actions.attack = "air_explosion";
    }

    if (kb.presses("c") && pdata.attackCooldown === 0) actions.attack = "bullet";

    // X and Z are CHARGE-throws now: hold-to-aim further, release to throw.
    // - Press starts the charge (and shows the bottle in the soldier's hand).
    // - Release fires the projectile with velocity scaled by how long it was held.
    if (kb.presses("x") && pdata.attackCooldown === 0 && !pdata.chargingThrow) actions.chargeStart = "beer";
    if (kb.presses("z") && pdata.attackCooldown === 0 && !pdata.chargingThrow) actions.chargeStart = "molotov";
    if (pdata.chargingThrow === "beer"    && !kb.pressing("x")) actions.chargeRelease = "beer";
    if (pdata.chargingThrow === "molotov" && !kb.pressing("z")) actions.chargeRelease = "molotov";

    return actions;
}

// ============================================================
// Dispatcher
// ============================================================
q5.update = function () {
   if (gameState === "startscreen") {
    updateStartScreen();
    if (isStartScreenDone()) {
        stopStartScreenMusic();
        gameState = "playing";
        setWorldVisible(true);
        // Sprites have been falling under gravity during the start screen. Reset them.
        resetGameplayPositions();
    }
    return;
}

    if (gameState === "playing") {
        updatePlaying();
        if (pdata.hp <= 0) {
            // Enter the death screen WITHOUT stashing sprite positions (that
            // dance left the player's box2d body unable to move on respawn).
            // Instead just tell q5play to skip its automatic sprite-draw pass
            // — the death screen is opaque and we don't want gameplay sprites
            // rendered on top of it. restartGame() flips it back on.
            gameState = "gameover";
            stopAlarm();                   // player died — silence the turret alarm
            allSprites._autoDraw = false;
            gameOverScreen = new GameOverScreen({
                quote: '"YOU FAILED, SOLDIER."',
                onContinue: () => {
                    restartGame();
                    gameState = "playing";
                    gameOverScreen = null;
                },
            });
        }
        return;
    }

    if (gameState === "gameover") {
    // Wipe the gameplay rendering first
    push();
    translate(-camera.x, -camera.y);
    fill(0);
    rect(0, 0, width, height);
    pop();

    gameOverScreen.draw();
    gameOverScreen.update();
    return;
}

    if (gameState === "ending") {
        updateEnding();
        return;
    }
};

// ============================================================
// Gameplay update (the old q5.update body)
// ============================================================
function updatePlaying() {
    // Keep the floor aligned with the live canvas height (fullscreen/resize).
    syncFloorToViewport();

    // Background scroll
    const positionAlongCorridor = camera.x % (height * 6);
    image(corridorBG, (3 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    if (positionAlongCorridor < 0) {
        image(corridorBG, (-3 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    } else if (positionAlongCorridor > height * 6 - width) {
        image(corridorBG, (9 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    }

    // Grounded check
    const touchingTerrain = player.colliding(terrain) > 0;
    const restingVertically = Math.abs(player.vel.y) < 1.0;
    if (touchingTerrain) {
        pdata.groundedTimer = 8;
        pdata.airborne = false;
    } else if (restingVertically && !pdata.airborne) {
        pdata.groundedTimer = 8;
    } else if (pdata.groundedTimer > 0) {
        pdata.groundedTimer--;
    }

    const actions = computePlayerActions(pdata, player, kb);
    player.vel.x = actions.moveX;
    player.facingRight = actions.facingRight;

    if (actions.jump) {
        player.vel.y = -16;
        pdata.groundedTimer = 0;
        pdata.airborne = true;
    }

    camera.x += (player.x - camera.x) * 0.67;

    anim.playBase(actions.moveX !== 0 ? "player.run" : "player.idle");

    if (pdata.attackCooldown > 0) pdata.attackCooldown--;

    // Standard one-shot attacks (punches, bullet) — instant on key-press.
    if (actions.attack && !anim.isOneShotPlaying() && pdata.attackCooldown === 0) {
        pdata.pendingAttack = actions.attack;
        player.color = "pink";
        anim.playOneShot(`player.${actions.attack}.startup`, () => {
            createAttack(pdata.pendingAttack);
            pdata.pendingAttack = null;
            player.color = "white";
        });
    }

    // CHARGE-throw flow for bottles (X / Z): press starts charging + bottle in
    // hand; while held the charge accumulates; release fires with velocity
    // scaled by how long the button was held (tap = short toss, hold = long
    // throw). Auto-fires at max charge (90 frames ~ 1.5s).
    if (actions.chargeStart) {
        pdata.chargingThrow = actions.chargeStart;
        pdata.chargeFrames = 0;
        spawnChargingBottle(actions.chargeStart);
    }
    if (pdata.chargingThrow) {
        pdata.chargeFrames++;
        if (pdata.chargeFrames >= 90) {                      // auto-release at full charge
            actions.chargeRelease = pdata.chargingThrow;
        }
    }
    if (actions.chargeRelease && pdata.chargingThrow) {
        const charge = Math.min(1, pdata.chargeFrames / 90); // 0 = tap, 1 = full hold
        const type = pdata.chargingThrow === "beer" ? "beer_throw" : "molotov_throw";
        pdata.chargingThrow = null;
        pdata.chargeFrames = 0;
        if (pdata.carriedBottle) { pdata.carriedBottle.delete(); pdata.carriedBottle = null; }
        pdata.pendingAttack = type;
        pdata.pendingCharge = charge;
        player.color = "pink";
        anim.playOneShot(`player.${type}.startup`, () => {
            createAttack(pdata.pendingAttack, pdata.pendingCharge);
            pdata.pendingAttack = null;
            pdata.pendingCharge = 0;
            player.color = "white";
        });
    }

    anim.update();
    anim.render();

    // Level progression: trip-line, countdown, turret AI, key pickup.
    updateLevel();

    // Per-sprite everyFrame callbacks
    for (let i = 0; i < allSprites.length; i++) {
        const sprite = allSprites[i];
        if (!sprite.everyFrame) throw "no everyFrame object";
        const everyFrame = Object.entries(sprite.everyFrame);
        for (let j = 0; j < everyFrame.length; j++) {
            everyFrame[j][1].f(sprite);
            everyFrame[j][1].duration--;
            if (everyFrame[j][1].duration <= 0) {
                delete sprite.everyFrame[everyFrame[j][0]];
                everyFrame.splice(j, 1);
                j--;
            }
        }
    }

    // Turret head tracks the player: flip horizontally to face them. Done AFTER
    // the everyFrame tweens so the facing sign is the final word on scale.x and
    // survives the punch/rise scale animations (we keep their magnitude).
    for (const t of turrets) {
        if (t.dead) continue;
        const mag = Math.abs(t.scale.x) || 1;
        const faceSign = (player.x < t.x) ? -1 : 1;     // player on left -> face left
        t.scale.x = TURRET_FACE_DIR * faceSign * mag;
    }

    // TEMP debug: press K to kill the player and see the gameover screen
    if (kb.presses("k")) pdata.hp = 0;
}

// ============================================================
// Ending update — three sub-phases:
//   1. "approach"   player walks up to the red button, presses SPACE
//   2. "typewriter" black screen, white 8-bit text letter-by-letter
//   3. "youwon"     big green "YOU WON", then back to the start screen
// ============================================================
function updateEnding() {
    syncFloorToViewport();   // keep the floor aligned if the window is resized mid-cutscene
    if (endingPhase === "approach")   return endingApproachUpdate();
    if (endingPhase === "typewriter") return endingTypewriterUpdate();
    if (endingPhase === "youwon")     return endingYouWonUpdate();
}

// Approach phase looks just like normal gameplay — corridor scrolls, player
// walks, sprites render. Pressing SPACE while close to the red button cuts to
// the cutscene. No combat / no level logic runs here.
function endingApproachUpdate() {
    // Background scroll (same as updatePlaying)
    const posAlong = camera.x % (height * 6);
    image(corridorBG, (3 * height - width * 0.5) - posAlong, 0, height * 6, height);
    if (posAlong < 0) {
        image(corridorBG, (-3 * height - width * 0.5) - posAlong, 0, height * 6, height);
    } else if (posAlong > height * 6 - width) {
        image(corridorBG, (9 * height - width * 0.5) - posAlong, 0, height * 6, height);
    }

    // Grounded check + simple movement (no jumping needed but kept for consistency)
    const touchingTerrain = player.colliding(terrain) > 0;
    if (touchingTerrain || Math.abs(player.vel.y) < 1) pdata.groundedTimer = 8;
    else if (pdata.groundedTimer > 0) pdata.groundedTimer--;

    if (kb.pressing("left"))       { player.vel.x = -10; player.facingRight = false; }
    else if (kb.pressing("right")) { player.vel.x =  10; player.facingRight = true;  }
    else                            { player.vel.x = 0; }
    if (kb.presses("up") && pdata.groundedTimer > 0) { player.vel.y = -16; pdata.groundedTimer = 0; }

    camera.x += (player.x - camera.x) * 0.67;

    anim.playBase(player.vel.x !== 0 ? "player.run" : "player.idle");
    anim.update();
    anim.render();

    // Per-sprite everyFrame (needed for the button/desk + any leftovers).
    for (let i = 0; i < allSprites.length; i++) {
        const sprite = allSprites[i];
        if (!sprite.everyFrame) continue;
        const entries = Object.entries(sprite.everyFrame);
        for (let j = 0; j < entries.length; j++) {
            entries[j][1].f(sprite);
            entries[j][1].duration--;
            if (entries[j][1].duration <= 0) { delete sprite.everyFrame[entries[j][0]]; entries.splice(j, 1); j--; }
        }
    }

    // SPACE near the button → button slams, screen fades to typewriter cutscene.
    if (endingButton && kb.presses("space")) {
        const dx = Math.abs(player.x - endingButton.x);
        if (dx < 110) {
            squashScale(endingButton, 0.4, 6);   // button slams down
            endingPhase = "typewriter";
            allSprites._autoDraw = false;        // hide gameplay sprites under the cutscene
            endingTypeFrames = 0;
            endingTypeChars  = 0;
            endingPostDoneFrames = 0;
        }
    }
}

// Black screen + Undertale-style typewriter text, one letter every couple frames.
function endingTypewriterUpdate() {
    // Full-screen black (origin is screen-center in postdraw / user-update)
    push();
    fill(0); noStroke();
    rect(-width / 2, -height / 2, width, height);
    pop();

    endingTypeFrames++;
    if (endingTypeChars < ENDING_MESSAGE.length) {
        if (endingTypeFrames % TYPEWRITER_FRAMES_PER_CHAR === 0) endingTypeChars++;
    } else {
        endingPostDoneFrames++;
        if (endingPostDoneFrames > 180) {        // 3 s after the last char
            endingPhase = "youwon";
            endingPostDoneFrames = 0;
        }
    }

    // Skip the cutscene with SPACE / ENTER if the player wants to.
    if (kb.presses("space") || kb.presses("enter")) {
        if (endingTypeChars < ENDING_MESSAGE.length) {
            endingTypeChars = ENDING_MESSAGE.length;  // first press completes the text
        } else {
            endingPhase = "youwon";                   // second press skips to YOU WON
            endingPostDoneFrames = 0;
        }
    }

    // Draw the text up to the current character count, line-by-line.
    const sub = ENDING_MESSAGE.substring(0, endingTypeChars);
    const lines = sub.split("\n");
    const size = 3;
    const charH = 7 * size;
    const lineGap = 14;
    const lineH = charH + lineGap;
    const totalH = ENDING_MESSAGE.split("\n").length * lineH;
    const startY = -totalH / 2 + charH / 2;
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].length) continue;
        drawPixelText(lines[i], 0, startY + i * lineH, size, "#ffffff", "#1a1a2a", null, "center");
    }
}

// Big green YOU WON, then revert to the start screen.
function endingYouWonUpdate() {
    push();
    fill(0); noStroke();
    rect(-width / 2, -height / 2, width, height);
    pop();

    endingPostDoneFrames++;
    drawPixelText("YOU WON", 0, 0, 10, "#3aff5a", "#0a3a14", null, "center");

    if (endingPostDoneFrames > 240 || kb.presses("space") || kb.presses("enter")) {
        // Reset all gameplay state and bounce to the start screen.
        score = 0; levelNum = 1;
        pdata.hp = 100;
        pdata.hasKey = false;
        timerFrames = LEVEL_SECONDS * 60;
        timerActive = false;
        levelPhase = "pre";
        cratesSpawned = false;
        keyDropArmed = false;
        keySpawned = false;
        for (const a of [...pdata.activeAttacks]) a.delete();
        for (const s of [...turretShots]) s.delete();
        transitionToStartScreen();
    }
}

// ============================================================
// Helpers
// ============================================================
function despawnAfter(sprite, frames) {
    let f = 0;
    sprite.everyFrame = sprite.everyFrame || {};
    sprite.everyFrame.despawn = {
        duration: frames + 1,
        f: () => { f++; if (f >= frames) sprite.delete(); },
    };
}

// ------------------------------------------------------------
// Juice: small reusable hit-reaction tweens, driven by the same
// per-sprite everyFrame system the rest of the game uses. Each one
// decays back to its resting transform, so re-triggering mid-tween
// just restarts cleanly without permanent drift.
// ------------------------------------------------------------

// Decaying horizontal jitter around the sprite's home column.
function shakeSprite(sprite, intensity, frames) {
    const baseX = sprite.homeX ?? sprite.x;
    sprite.homeX = baseX;
    let f = 0;
    sprite.everyFrame = sprite.everyFrame || {};
    sprite.everyFrame.shake = {
        duration: frames + 1,
        f: (self) => {
            f++;
            const k = 1 - Math.min(1, f / frames);
            self.x = baseX + (Math.random() * 2 - 1) * intensity * k;
            if (f >= frames) self.x = baseX;
        },
    };
}

// Uniform "pop" — scales up then eases back to 1. Good for impacts.
function punchScale(sprite, amount, frames) {
    let f = 0;
    sprite.everyFrame = sprite.everyFrame || {};
    sprite.everyFrame.punch = {
        duration: frames + 1,
        f: (self) => {
            f++;
            const k = 1 - Math.min(1, f / frames);
            const s = 1 + amount * k;
            self.scale.x = s; self.scale.y = s;
            if (f >= frames) { self.scale.x = 1; self.scale.y = 1; }
        },
    };
}

// Squash-and-stretch — widens while flattening, then settles back.
function squashScale(sprite, amount, frames) {
    let f = 0;
    sprite.everyFrame = sprite.everyFrame || {};
    sprite.everyFrame.squash = {
        duration: frames + 1,
        f: (self) => {
            f++;
            const k = 1 - Math.min(1, f / frames);
            self.scale.x = 1 + amount * k;
            self.scale.y = 1 - amount * k;
            if (f >= frames) { self.scale.x = 1; self.scale.y = 1; }
        },
    };
}

// Burst of little wooden chips that fly out, tumble, shrink and vanish.
function spawnDebris(x, y, count) {
    for (let i = 0; i < count; i++) {
        const d = Sprite.withSensor(x, y, 14, 14);
        d.everyFrame = d.everyFrame || {};
        d.gravity = true;
        d.img = debrisImgs[i % debrisImgs.length];   // .color alone won't render
        d.vel.x = (Math.random() * 2 - 1) * 9;
        d.vel.y = -6 - Math.random() * 7;
        d.rotationSpeed = (Math.random() * 2 - 1) * 22;
        const life = 32;
        let f = 0;
        d.everyFrame.shrink = {
            duration: life + 1,
            f: (self) => { f++; const s = Math.max(0.1, 1 - f / life); self.scale.x = s; self.scale.y = s; },
        };
        despawnAfter(d, life);
    }
}

// Standard ease-out-back: overshoots the target then settles — gives the
// turret a satisfying little pop as it locks into place.
function easeOutBack(t) {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

// Bottle in the soldier's hand while he's CHARGING a throw — stays alive as
// long as pdata.chargingThrow is set, lifts higher and pulses faster as the
// charge fills (visual cue for how strong the throw will be).
function spawnChargingBottle(type) {
    if (pdata.carriedBottle) { pdata.carriedBottle.delete(); pdata.carriedBottle = null; }
    const img = (type === "beer") ? beerBottleImg : molotovImg;
    const held = Sprite.withSensor(player.x, player.y - 36, 32);
    held.everyFrame = {};
    held.img = img;
    held.kind = "held";
    held.rotationLock = false;
    held.gravity = false;
    held.everyFrame.follow = {
        duration: Infinity,
        f: (s) => {
            const dir = player.facingRight ? 1 : -1;
            const charge = Math.min(1, pdata.chargeFrames / 90);
            // bottle lifts higher and rocks faster the longer you hold
            s.x = player.x + dir * 42;
            s.y = player.y - 36 - charge * 36;
            s.rotation += dir * (4 + charge * 14);
            s.vel.x = 0; s.vel.y = 0;
            const pulse = 1 + Math.sin(pdata.chargeFrames * 0.45) * 0.06 * charge;
            s.scale.x = pulse * dir;
            s.scale.y = 1 + charge * 0.18;
        },
    };
    pdata.carriedBottle = held;
}

function createAttack(type, charge = 1.0) {
    let a;
    let offsetX = 0, offsetY = 0;
    let attachToPlayer = true;
    let img = null;
    let imgScale = 1;

    if (type === "ground_punch") {
        // Alternate left/right hand each swing by varying the punch height.
        pdata.lastHand = (pdata.lastHand === "L") ? "R" : "L";
        offsetX = 80;
        offsetY = (pdata.lastHand === "L") ? 26 : 54;   // L = high jab, R = body shot
        a = Sprite.withSensor(player.x + (player.facingRight ? offsetX : -offsetX), player.y + offsetY, 100, 60);
        a.life = 15;
        img = punchBurstImg;
    } else if (type === "air_forward") {
        offsetX = 100; offsetY = 40;
        a = Sprite.withSensor(player.x + (player.facingRight ? offsetX : -offsetX), player.y + offsetY, 120, 40);
        a.life = 10;
        img = punchBurstImg;
        imgScale = 1.2;
    } else if (type === "air_explosion") {
        a = Sprite.withSensor(player.x, player.y, 250);
        a.life = 25;
        img = airExplosionImg;
    } else if (type === "molotov_throw" || type === "beer_throw" || type === "bullet") {
        a = createProjectile(player, type, charge);
        pdata.activeAttacks.add(a);
        pdata.attackCooldown = 6;
        return;
    }

    a.type = type;
    a.facingRight = player.facingRight;
    // The hit sensor is now VISIBLE with its dedicated effect sprite — the
    // punch starburst / air shockwave reads the attack at the contact point.
    // (Do NOT set sprite.debug: q5play 4.x's debug draw calls a removed
    // `_doFill` and throws every frame, which would crash gameplay.)
    a.visible = true;
    if (img) {
        a.img = img;
        a.scale.x = imgScale * (a.facingRight ? 1 : -1);
        a.scale.y = imgScale;
    }

    pdata.activeAttacks.add(a);
    pdata.attackCooldown = a.life + 10;

    if (attachToPlayer) {
        a.everyFrame = a.everyFrame || {};
        a.everyFrame.follow = {
            duration: a.life + 1,
            f: (sprite) => {
                sprite.x = player.x + (a.facingRight ? offsetX : -offsetX);
                sprite.y = player.y + offsetY;
                sprite.vel.x = 0;
                sprite.vel.y = 0;
            },
        };
    }

    despawnAfter(a, a.life);
}

const PROJECTILE_TYPES = ["molotov_throw", "beer_throw", "bullet", "molotov_explosion"];

// Overlap callback for every active attack (melee sensor, thrown bottle,
// bullet, or molotov blast) against crates / turrets / terrain.
function handleHit(attack, target) {
    if (PROJECTILE_TYPES.includes(attack.type)) {
        handleProjectileHit(attack, target, [...crates, ...turrets]);
        return;
    }

    // Melee sensors linger for several frames, so guard against a single
    // swing registering many hits — each attack damages a target only once.
    if (!attack.alreadyHit) attack.alreadyHit = new Set();
    if (attack.alreadyHit.has(target)) return;
    attack.alreadyHit.add(target);

    applyAttackDamage(attack.type, target);
}

// Single source of truth for what an attack does to a destructible. Exposed
// on window so the molotov-blast logic in items.js can route through it too.
function applyAttackDamage(type, target) {
    if (!target || target.kind === "dead") return;
    if (target.kind === "crate")  return damageCrate(target);
    if (target.kind === "turret") return damageTurret(target, ATTACK_DAMAGE[type] ?? 5);
}
window.applyAttackDamage = applyAttackDamage;

// Crates always take 3 hits to break, walking through every art frame:
// full -> damaged -> broken -> gone.
function damageCrate(c) {
    c.hp -= 1;
    const px = c.x, py = c.y;       // crate may have been kicked, so use its live pos
    if (c.hp <= 0) {
        c.kind = "dead";
        score += 10;                // +10 per box broken
        spawnDebris(px, py, 9);     // full break: big burst of chips
        c.delete();                 // remove the body so the husk can't block the player
        // If every turret is down, the FIRST crate destroyed after that drops
        // the key — randomly out of whichever box the player smashes first.
        if (keyDropArmed && !keySpawned) spawnKey(px, py);
        return;
    }
    c.img = c.hp === 2 ? crateFrames.hit : crateFrames.broken;
    squashScale(c, 0.22, 9);        // recoil from the blow (no x-shake: crates move now)
    spawnDebris(px, py, 3);         // a few splinters knocked loose
}

function damageTurret(t, dmg) {
    if (t.dead) return;
    t.hp -= dmg;
    if (t.hp <= 0) {
        t.hp = 0;
        t.dead = true;
        t.active = false;
        t.img = turretFrames.destroyed;
        shakeSprite(t, 12, 16);                 // violent death rattle
        punchScale(t, 0.18, 10);
        spawnDebris(t.homeX ?? t.x, t.y, 12);
        score += 30;                            // +30 per turret
        spawnCrates();                          // boxes appear after the first turret falls
        // When the LAST turret falls, the key immediately drops from a random
        // live crate — no need to smash one first.
        if ([...turrets].every(x => x.dead) && !keySpawned) {
            const live = [...crates].filter(c => c.kind === "crate");
            const src = live.length ? live[Math.floor(Math.random() * live.length)] : null;
            if (src) spawnKey(src.x, src.y);
            else     spawnKey(player.x + 200, surfaceY - 100);
        }
        keyDropArmed = true;                    // (still also triggers on crate smash, harmless)
        return;
    }
    t.img = t.hp > 50 ? turretFrames.idle : turretFrames.fire;
    shakeSprite(t, 5, 8);                       // recoil on every hit
    punchScale(t, 0.1, 6);
}

// ============================================================
// Level system: threshold-gated spawning, active turrets, timer + score
// ============================================================
const LEVEL_SECONDS = 300;            // Mario-style countdown, per level
const THRESHOLD_OFFSET = 520;         // distance past spawn where the trip-line sits
const TURRET_REL_XS = [260, 820, 1450];      // (legacy) turret x's relative to the trip-line
const CRATE_REL_XS  = [180, 560, 1080, 1650]; // crate x's (spawn after the 1st turret falls)

// Per-level turret layouts. `ground` entries are x-offsets from the trip-line;
// `flying` entries are { x, y } where y is a NEGATIVE offset from the surface
// (turret floats that many px above the floor). Level 3 introduces flying
// turrets; 4 and 5 mix more of them in for harder waves.
const LEVEL_TURRETS = {
    1: { ground: [260, 820, 1450], flying: [] },
    2: { ground: [260, 820, 1450], flying: [] },
    3: { ground: [260, 1300],           flying: [{ x: 780,  y: -260 }] },
    4: { ground: [260, 1500],           flying: [{ x: 700, y: -240 }, { x: 1700, y: -320 }] },
    5: { ground: [260, 1300, 2100],     flying: [{ x: 700, y: -240 }, { x: 1500, y: -360 }, { x: 1900, y: -200 }] },
};
const SHOT_DAMAGE = 10;               // half a heart per hit (5 hearts = 100 hp)
const TURRET_FIRE_INTERVAL = 120;     // frames between a turret's shots
const TURRET_WINDUP = 26;             // wind-up tell (frames) before it fires
const TURRET_RANGE = 1100;            // turret only engages when the player is this close
const TURRET_FACE_DIR = 1;            // flip to -1 if the turret art faces the wrong way

const DOOR_OFFSET = 1900;             // door sits past the last crate
const DOOR_W = SOVIET_DOOR_W;         // matches the loaded image dims (140 wide)
const DOOR_H = SOVIET_DOOR_H;         // full corridor height (== surfaceY)

let levelNum = 1;
let score = 0;
let levelPhase = "pre";               // "pre" (before trip-line) | "combat"
let thresholdX = THRESHOLD_OFFSET;
let timerFrames = LEVEL_SECONDS * 60;
let timerActive = false;
let cratesSpawned = false;
let keyDropArmed = false;             // true once every turret is down — the next crate to break drops the key
let keySpawned = false;
let levelDoor = null;                 // exit door at the end of the level

// Level-5 ending sequence state.
let endingPhase = null;               // null | "approach" | "typewriter" | "youwon"
let endingDesk = null;
let endingButton = null;
let endingTypeFrames = 0;
let endingTypeChars = 0;
let endingPostDoneFrames = 0;
const ENDING_MESSAGE =
    "YOU SAVED THE WORLD FROM NUCLEAR FALLOUT.\n" +
    "BY STOPPING THE SUBMARINE FROM LAUNCHING THE NUKES,\n" +
    "YOU PREVENTED CATASTROPHE.\n" +
    " \n" +
    "THE UNITED STATES THANKS YOU FOR YOUR SERVICE.";
const TYPEWRITER_FRAMES_PER_CHAR = 2;     // ~30 chars/sec at 60fps

function clearLevelEntities() {
    for (const c of [...crates]) c.delete();
    for (const t of [...turrets]) t.delete();
    for (const s of [...turretShots]) s.delete();
    if (window.theKey) { window.theKey.delete(); window.theKey = null; }
    if (levelDoor) { levelDoor.delete(); levelDoor = null; }
}

// Wipe the level back to its "pre" state for a fresh run/restart. Nothing
// spawns yet: turrets power up when the player trips the line, crates after
// the first turret is destroyed.
function resetLevel() {
    clearLevelEntities();

    levelPhase = "pre";
    thresholdX = player.x + THRESHOLD_OFFSET;
    timerFrames = LEVEL_SECONDS * 60;
    timerActive = false;
    cratesSpawned = false;
    keyDropArmed = false;
    keySpawned = false;
    pdata.hasKey = false;
}

// Aggressive cleanup before any new level setup. Called from BOTH
// startNextLevel() AND breachThreshold() so a stale border wall or prior
// Soviet exit door can NEVER bleed into the new level — defense in depth
// against the "border spliced into the door at level 3" issue.
function cleanupForNewLevel() {
    // Level 2 onwards: every corridor wall+door is gone for good. (walls live
    // at every 6×height units — walls[0] at ≈-640, walls[1] at ≈3680, … —
    // and walls[1] alone was enough to box the player in at level 3.)
    if (levelNum >= 2) {
        for (let i = 0; i < walls.length; i++) {
            if (walls[i]) { walls[i].delete(); walls[i] = null; }
            if (doors[i]) { doors[i].delete(); doors[i] = null; }
        }
    }
    // Previous level's Soviet exit door is always wiped before the next one
    // spawns — guarantees no ghost/overlap door survives the transition.
    if (levelDoor) { levelDoor.delete(); levelDoor = null; }
}

// Build the level-specific layout. Always runs the defensive cleanup first
// (regardless of whether startNextLevel already did it), then spawns this
// level's fresh turrets + Soviet exit door.
function setupCurrentLevel() {
    cleanupForNewLevel();
    spawnTurrets();
    spawnDoor();
}

// Advance to the next wave further down the corridor (after entering the door).
// Special-case: clearing LEVEL 5 ends the game — instead of spawning level 6,
// we drop the player into the ending sequence (button on a desk → cutscene).
function startNextLevel() {
    clearLevelEntities();

    if (levelNum === 5) {
        startEndingSequence();
        return;
    }

    levelNum += 1;
    score += 50;                      // +50 per new level unlocked
    levelPhase = "pre";
    thresholdX = player.x + THRESHOLD_OFFSET;
    cratesSpawned = false;
    keyDropArmed = false;
    keySpawned = false;
    pdata.hasKey = false;

    // Run cleanup IMMEDIATELY on advance — borders gone before the player
    // even reaches the next trip-line.
    cleanupForNewLevel();
}

// ============================================================
// Level-5 ENDING: red button on a desk -> Undertale-style typewriter
// cutscene -> green "YOU WON" -> back to the start screen.
// ============================================================
function startEndingSequence() {
    gameState = "ending";
    stopAlarm();                       // player beat the game — silence the alarm
    endingPhase = "approach";
    endingTypeFrames = 0;
    endingTypeChars = 0;
    endingPostDoneFrames = 0;
    cleanupForNewLevel();             // wipe any lingering turrets / doors

    // Big desk + big red button spawn just ahead of the player so they walk a
    // few steps to it. CRUCIAL: make them STATIC so they don't fall through
    // the floor (dynamic sensors have gravity and would vanish in one frame).
    const dx = player.x + 320;
    const DESK_W = 320, DESK_H = 170;
    const BUTTON_W = 160, BUTTON_H = 130;
    const deskY = surfaceY - DESK_H / 2;                  // desk base on floor
    endingDesk = Sprite.withSensor(dx, deskY, DESK_W, DESK_H, "static");
    endingDesk.everyFrame = {};
    endingDesk.img = deskImg;
    endingDesk.kind = "desk";

    // Button sits on TOP of the desk — its bottom edge meets the desk top.
    const desktopY = deskY - DESK_H / 2;                  // top surface of desk
    endingButton = Sprite.withSensor(dx, desktopY - BUTTON_H / 2 + 6, BUTTON_W, BUTTON_H, "static");
    endingButton.everyFrame = {};
    endingButton.img = buttonImg;
    endingButton.kind = "button";
}

function transitionToStartScreen() {
    if (endingButton) { endingButton.delete(); endingButton = null; }
    if (endingDesk)   { endingDesk.delete();   endingDesk   = null; }
    endingPhase = null;
    allSprites._autoDraw = true;
    // CRUCIAL: reset the camera to screen-center BEFORE the start screen
    // re-renders. updateStartScreen() uses `translate(-camera.x, -camera.y)`
    // for its coord math; if the camera is still at the player's level-5
    // position (~x=8000), the whole submarine scene draws thousands of px
    // off-screen and the YOU WON frame stays frozen on the canvas.
    camera.x = width / 2;
    camera.y = height / 2;
    setWorldVisible(false);
    initStartScreen();
    gameState = "startscreen";
}

// Player crossed the trip-line: start the clock (once, for the whole run),
// then build out the current level via setupCurrentLevel (which re-runs
// cleanup as a second pass).
function breachThreshold() {
    levelPhase = "combat";
    if (!timerActive) {            // first ever breach — start the run timer
        timerFrames = LEVEL_SECONDS * 60;
    }
    timerActive = true;
    setupCurrentLevel();
}

function spawnDoor() {
    if (levelDoor) { levelDoor.delete(); levelDoor = null; }
    // Door spans the FULL SCREEN (top edge at y=0, bottom edge at y=height)
    // and is SOLID — covers everything top-to-bottom including the lower
    // exit beneath the surface line. With the key the open animation deletes
    // the blocker, plays a sensor-only shrink visual, and advances the level.
    const dy = DOOR_H / 2;                // centred vertically across the screen
    const d = new terrain.Sprite(thresholdX + DOOR_OFFSET, dy, DOOR_W, DOOR_H);
    d.everyFrame = {};
    d.img = doorImg;
    d.kind = "door";
    d.opened = false;
    levelDoor = d;
}

function spawnTurrets() {
    const cfg = LEVEL_TURRETS[Math.min(levelNum, 5)] || LEVEL_TURRETS[1];
    const groundRestY = surfaceY - TURRET_H / 2 + TURRET_FLOOR_NUDGE;

    // GROUND turrets — rise out of the floor, exactly as before.
    cfg.ground.forEach(rx => makeTurret(thresholdX + rx, groundRestY, /*flying=*/false));

    // FLYING turrets — appear in the air at the configured offset above the
    // surface. They don't rise out of the floor; they pop in active and hover.
    cfg.flying.forEach(({ x, y }) => makeTurret(thresholdX + x, surfaceY + y, /*flying=*/true));
}

function makeTurret(tx, ty, flying) {
    const t = Sprite.withSensor(tx, ty, TURRET_W, TURRET_H, "static");
    t.everyFrame = {};
    t.homeX = tx;
    t.kind = "turret";
    t.flying = flying;
    t.hp = flying ? 70 : 100;          // flyers a bit easier to kill (smaller hit area in feel)
    t.dead = false;
    t.active = false;
    t.fireTimer = TURRET_FIRE_INTERVAL + Math.floor(Math.random() * 50);
    t.img = turretFrames.idle;
    t.restY = ty;
    turrets.add(t);
    if (flying) {
        // Pop-in: punch + bob, active immediately (player must aim by moving
        // around and throwing bottles to reach them).
        t.active = true;
        startAlarm();                   // turrets are live — sound the alarm
        punchScale(t, 0.2, 12);
        const phase = Math.random() * Math.PI * 2;
        let pf = 0;
        t.everyFrame.hover = { duration: Infinity, f: (s) => {
            pf++;
            s.y = s.restY + Math.sin(phase + pf * 0.05) * 22;  // gentle airborne bob (restY tracks floor on resize)
        }};
    } else {
        riseTurret(t);                  // ground turret rise + power-on
    }
}

function spawnCrates() {
    if (cratesSpawned) return;
    cratesSpawned = true;
    // The crate art is 150x170 but has ~40 px of empty padding at the bottom
    // (the wooden base doesn't reach the image edge). We give the COLLIDER a
    // shorter height than the image so physics rests the collider on the
    // floor while the bigger image extends below it — visible base on floor.
    const CRATE_COLLIDER_H = 90;       // shorter -> visible image sinks lower onto the red floor stripe
    const restY = surfaceY - CRATE_COLLIDER_H / 2;
    CRATE_REL_XS.forEach((rx) => {
        const cx = thresholdX + rx;
        const c = new Sprite(cx, restY, CRATE_W, CRATE_COLLIDER_H);
        c.everyFrame = {};
        c.homeX = cx;
        c.kind = "crate";
        c.hp = 3;
        c.img = crateFrames.full;     // 150x170 img — extends below the shorter collider
        c.rotationLock = true;
        c.bounciness = 0;
        c.friction = 0.25;
        crates.add(c);
        punchScale(c, 0.2, 8);
    });
}

// Turret emerges from the floor (power-on), then becomes a live shooter.
function riseTurret(t) {
    const fromY = t.restY + TURRET_H;
    const frames = 45;
    let f = 0;
    t.y = fromY;
    t.everyFrame.rise = {
        duration: frames + 1,
        f: (self) => {
            f++;
            const k = Math.min(1, f / frames);
            self.y = fromY + (self.restY - fromY) * easeOutBack(k);
            if (f >= frames) {
                self.y = self.restY;
                shakeSprite(self, 4, 6);   // little thud as it locks in
                self.active = true;        // turret is now live and hunting the player
                startAlarm();              // turrets are live — sound the alarm
                punchScale(self, 0.15, 8); // power-on pop
            }
        },
    };
}

// Run every frame: live turrets track the player, wind up, and fire shells.
function updateTurrets() {
    for (const t of turrets) {
        if (t.dead || !t.active) continue;
        const dx = player.x - t.x;
        if (Math.abs(dx) > TURRET_RANGE) continue;   // only engage a nearby player
        t.fireTimer--;
        if (t.fireTimer === TURRET_WINDUP) {
            t.img = turretFrames.fire;                // wind-up tell
            punchScale(t, 0.08, 6);
        }
        if (t.fireTimer <= 0) {
            fireTurretShot(t);
            t.fireTimer = TURRET_FIRE_INTERVAL;
            t.img = t.hp > 50 ? turretFrames.idle : turretFrames.fire;
        }
    }
}

// A turret fires a bright shell straight at the player's CURRENT position. The
// shell flies in exactly the direction it's launched (velocity re-asserted each
// frame so gravity can't bend it), leaving a short glowing trail.
function fireTurretShot(t) {
    // Muzzle sits at the barrel. Shells are SLOW enough that the player can
    // outrun them by sprinting away, and the turret aims with random angular
    // spread so not every shot is a hit — many fly wide.
    const dirX = (player.x < t.x) ? -1 : 1;
    const sx = t.x + dirX * (TURRET_W * 0.42);
    const sy = t.y - TURRET_H * 0.12;
    const dx = player.x - sx, dy = (player.y - 20) - sy;
    const speed = 11;                                // 11 px/f, only +1 over walk speed
    const baseAngle = Math.atan2(dy, dx);
    const spread = (Math.random() - 0.5) * 0.95;     // ±~27° random aim error — many shots miss
    const angle = baseAngle + spread;
    const vx = Math.cos(angle) * speed;
    const vy = Math.sin(angle) * speed;

    const shot = Sprite.withSensor(sx, sy, 42);
    shot.everyFrame = {};
    shot.kind = "turretshot";
    shot.img = turretShotImg;            // visible glowing shell (q5play won't draw a bare color)
    shot.rotationLock = true;
    shot.spent = false;
    shot.vel.x = vx; shot.vel.y = vy;
    // PURE BALLISTIC: shells fly dead-straight in their fired direction. If
    // the player walks out of the trajectory the shell whistles past — it
    // does NOT track. We re-assert velocity each frame so gravity can't bend
    // it; q5play's `player.overlaps(turretShots, onPlayerShot)` handles the
    // actual hit detection (no proximity-fudge any more).
    shot.everyFrame.fly = { duration: Infinity, f: (s) => { s.vel.x = vx; s.vel.y = vy; } };
    turretShots.add(shot);
    despawnAfter(shot, 170);

    // muzzle flash
    punchScale(t, 0.1, 6);
    spawnDebris(sx, sy, 3);
}

// Player took a turret shell.
function onPlayerShot(playerSprite, shot) {
    if (shot.spent) return;
    shot.spent = true;
    pdata.hp -= SHOT_DAMAGE;
    flashPlayerHurt();
    spawnDebris(shot.x, shot.y, 4);
    shot.delete();
}

function flashPlayerHurt() {
    player.color = "red";
    player.everyFrame = player.everyFrame || {};
    let f = 0;
    player.everyFrame.hurt = { duration: 9, f: () => { f++; if (f >= 8) player.color = "white"; } };
}

// Walking into a crate boots it away like a soccer ball.
function kickCrate(playerSprite, c) {
    if (c.kind !== "crate") return;
    const dir = playerSprite.vel.x !== 0 ? Math.sign(playerSprite.vel.x)
                                         : (playerSprite.facingRight ? 1 : -1);
    c.vel.x = dir * 24;               // strong horizontal boot
    c.vel.y = -4;                     // tiny hop so it reads as a kick
}

// Per-frame level progression, called from updatePlaying().
function updateLevel() {
    // Trip-line: crossing it starts the clock and powers up the turrets.
    if (levelPhase === "pre" && player.x >= thresholdX) breachThreshold();

    // Mario-style countdown; running out of time is fatal.
    if (timerActive && timerFrames > 0) {
        timerFrames--;
        if (timerFrames <= 0) { timerFrames = 0; pdata.hp = 0; }
    }

    updateTurrets();

    // Touch the key -> stash it in the player's inventory. The key alone
    // doesn't end the level any more; you still have to reach the door.
    const k = window.theKey;
    if (k && !k.collected &&
        Math.abs(player.x - k.x) < 95 && Math.abs(player.y - k.y) < 140) {
        k.collected = true;
        k.delete();
        window.theKey = null;
        pdata.hasKey = true;
        punchScale(player, 0.15, 8);   // tiny "got it" cue (animator overwrites x-flip next frame, fine)
    }

    // Reach the door WITH the key -> opens, advance to the next level.
    if (levelDoor && pdata.hasKey && !levelDoor.opened &&
        Math.abs(player.x - levelDoor.x) < DOOR_W / 2 + 60 &&
        Math.abs(player.y - levelDoor.y) < DOOR_H / 2 + 80) {
        levelDoor.opened = true;
        openDoorAndAdvance(levelDoor);
    }
}

// Door "open" animation — DELETE the solid blocker (so the player can walk
// through), then play a slide-shrink sensor visual at the same spot, then
// startNextLevel(). This way the open door never blocks while it's animating.
function openDoorAndAdvance(d) {
    const dx = d.x, dy = d.y, dw = DOOR_W, dh = DOOR_H;
    d.delete();                          // clear the solid wall
    levelDoor = null;
    const ghost = Sprite.withSensor(dx, dy, dw, dh);
    ghost.everyFrame = {};
    ghost.img = doorImg;
    let f = 0;
    const frames = 14;
    ghost.everyFrame.open = {
        duration: frames + 2,
        f: (self) => {
            f++;
            const k = 1 - Math.min(1, f / frames);
            self.scale.x = k;
            self.scale.y = 1 + (1 - k) * 0.05;   // tiny squish up as it slides
            if (f >= frames) { self.delete(); startNextLevel(); }
        },
    };
}

// ============================================================
// HUD (drawn after the sprites via a postdraw hook, so it stays on top).
// The camera transform is off here, so the origin is the screen CENTER.
// ============================================================
function pad6(n) { return String(Math.max(0, Math.floor(n))).padStart(6, "0"); }

// Blocky 8-bit heart (7x6). "1" = pixel on.
const HEART_BMP = ["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"];
function drawHeart(x, y, pxsz, fillType /* "full" | "half" | "empty" */) {
    push();
    noStroke();
    const bodyFull  = "#ff3344";
    const bodyEmpty = "#3a2230";
    const shine     = "#ff9aa2";
    for (let r = 0; r < HEART_BMP.length; r++) {
        for (let c = 0; c < HEART_BMP[r].length; c++) {
            if (HEART_BMP[r][c] !== "1") continue;
            // "half" fills only the LEFT side of the heart so half-a-heart of
            // damage is visible immediately (cols 0-3 = left + centre).
            let isFilled = (fillType === "full") || (fillType === "half" && c <= 3);
            fill(isFilled ? bodyFull : bodyEmpty);
            rect(x + c * pxsz, y + r * pxsz, pxsz, pxsz);
            // tiny glints on the filled lobes
            if (isFilled && r === 1 &&
                ((c === 1) || (fillType === "full" && c === 5))) {
                fill(shine);
                rect(x + c * pxsz, y + r * pxsz, pxsz, pxsz);
            }
        }
    }
    pop();
}

// Retro 8-bit HUD, drawn after the sprites (postdraw hook) so it sits on top.
// Camera transform is off here, so the origin is the screen CENTER.
function drawHUD() {
    if (gameState !== "playing") return;
    const secs = Math.max(0, Math.ceil(timerFrames / 60));
    const S = 4;                         // pixel-font scale
    const rowY = -height / 2 + 16 + (7 * S) / 2;  // vertical center of the top text row
    const leftX = -width / 2 + 28;
    const rightX = width / 2 - 28;
    const OUT = "#0a0a22";               // dark outline for that cooked-in arcade look

    push();
    drawPixelText("SCORE " + pad6(score), leftX, rowY, S, "#ffe066", OUT, null, "left");
    drawPixelText("LEVEL " + levelNum,    0,     rowY, S, "#5fe1ff", OUT, null, "center");
    drawPixelText("TIME " + secs, rightX, rowY, S, secs <= 30 ? "#ff5560" : "#ffffff", OUT, null, "right");

    // Hearts row, under the score — half-heart granularity so each 10-hp shot
    // is immediately visible (each shot deducts exactly half a heart).
    const hp = Math.max(0, pdata.hp);
    const fullCount = Math.floor(hp / 20);
    const showHalf = (hp % 20) >= 10 && hp > 0;
    const hpx = 5, heartW = 7 * hpx;
    const heartY = rowY + (7 * S) / 2 + 14;
    for (let i = 0; i < 5; i++) {
        let ft = "empty";
        if (i < fullCount) ft = "full";
        else if (i === fullCount && showHalf) ft = "half";
        drawHeart(leftX + i * (heartW + 14), heartY, hpx, ft);
    }
    pop();
}
window.q5.addHook("postdraw", drawHUD);

// Key pops out of whichever crate the player just smashed (passed as x,y).
// Called from damageCrate() once `keyDropArmed` is set (i.e. every turret is
// dead). Random because the player picks which crate to break first.
function spawnKey(spawnX, spawnY) {
    if (keySpawned) return;
    keySpawned = true;
    const pos = { x: spawnX, y: spawnY };

    const k = new Sprite(pos.x, pos.y - 10, KEY_W, KEY_H);
    k.everyFrame = {};
    k.img = keyImg;
    k.kind = "key";
    k.rotationLock = true;
    k.bounciness = 0.25;
    k.friction = 0.4;

    // Pop up and arc toward whichever side the player is on, tumbling in
    // the air, then settle upright on the floor with a slow glint.
    const dir = (player.x <= pos.x) ? -1 : 1;
    k.vel.y = -18;          // upward launch; gravity arcs it back down
    k.vel.x = dir * 7;
    const spin = -dir * 17; // tumble in the direction of travel

    k.landed = false;
    k.bobT = 0;
    k.everyFrame.pop = {
        duration: Infinity,
        f: (self) => {
            if (!self.landed) {
                self.rotation += spin;                        // tumble while airborne
                if (self.colliding(ground) > 0 && self.vel.y > -2) {
                    self.landed = true;
                    squashScale(self, 0.3, 8);                // squash as it hits the deck
                }
            } else {
                self.rotation *= 0.6;                         // settle upright
                if (Math.abs(self.rotation) < 0.5) self.rotation = 0;
                self.bobT += 0.13;
                if (self.everyFrame.squash === undefined) {   // gentle glint once settled
                    const s = 1 + Math.sin(self.bobT) * 0.05;
                    self.scale.x = s; self.scale.y = s;
                }
            }
        },
    };
    window.theKey = k;
}

// ============================================================
// Debug hooks (harmless) — handy for inspecting/driving the game.
// ============================================================
window.player = player;
window.gameDebug = () => ({
    gameState,
    score, levelNum, timerFrames, timerActive, levelPhase,
    hp: pdata.hp, thresholdX, playerX: Math.round(player.x),
    turrets: turrets.length, crates: crates.length,
    activeTurrets: [...turrets].filter(t => t.active && !t.dead).length,
    deadTurrets: [...turrets].filter(t => t.dead).length,
    key: !!window.theKey,
    keyDropArmed,
    hasKey: !!pdata.hasKey,
    door: levelDoor ? { x: Math.round(levelDoor.x), opened: !!levelDoor.opened } : null,
});