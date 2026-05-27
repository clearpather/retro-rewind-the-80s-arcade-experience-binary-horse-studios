window.exe = _ => eval(_);


function loadPNG(src) {
    return new Promise((resolve, reject) => {
        const img = document.createElement("img");
        img.src = src;
        img.onload = () => resolve(img);
        img.onerror = e => reject(e);
    });
}


await Canvas(1600, 900);
noSmooth();


canvas.style.position = "fixed";


window.onresize = function() {
    if (window.innerHeight / window.innerWidth > height / width) {
        canvas.style.width = "100%";
        canvas.style.height = `${(height / width) * window.innerWidth}px`;
        canvas.style.left = "0";
        canvas.style.top = `${(window.innerHeight - (height / width) * window.innerWidth) * 0.5}px`;
    }
    else {
        canvas.style.width = `${(width / height) * window.innerHeight}px`;
        canvas.style.height = "100%";
        canvas.style.left = `${(window.innerWidth - (width / height) * window.innerHeight) * 0.5}px`;
        canvas.style.top = "0";
    }
}
window.onresize();


allSprites.everyFrame = {};
allSprites.autoCull = false;


camera.zoom = 1;
camera.x = 0;
camera.y = height / 2;
world.gravity.y = 37;


window.GAMESTATE = {
    key: false,
    timer: 300,
    score: 0,
    ammo: {molotov: 0, beer: 0, bullet: 0}
};


import { createProjectile, handleProjectileHit } from "./items.js";


// ============================================================
// Animator
// ============================================================
function createAnimator(sprite, frames, sequences) {
    const state = {
        baseName: null,
        baseFrame: 0,
        baseTimer: 0,
        oneShotName: null,
        oneShotFrame: 0,
        oneShotTimer: 0,
        oneShotOnComplete: null,
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
    const c = document.createElement("canvas");
    c.width = frameWidth;
    c.height = frameHeight;


    const ctx = c.getContext("2d");
    if (!ctx) return null;


    try {
        ctx.drawImage(sheetImage, srcX, srcY, frameWidth, frameHeight, 0, 0, frameWidth, frameHeight);
    } catch (e) {
        console.warn("Failed to extract frame:", e);
        return null;
    }


    const img = await loadImage(c.toDataURL());
    img.resize(frameWidth * 20/3, frameHeight * 20/3);
    return img;
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
    "player.ground_punch.startup":  { blocks: [{ sheet: "usRun",  framePos: {x:1,y:0}, duration: 5 }] },
    "player.air_forward.startup":   { blocks: [{ sheet: "usRun",  framePos: {x:2,y:0}, duration: 5 }] },
    "player.air_explosion.startup": { blocks: [
        { sheet: "usFire", framePos: {x:3,y:0}, duration: 8 },
        { sheet: "usFire", framePos: {x:4,y:0}, duration: 7 },
    ]},
    "player.molotov_throw.startup": { blocks: [
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 2 },
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 5 },
        { sheet: "usRun", framePos: {x:1,y:1}, duration: 5 },
    ]},
    "player.beer_throw.startup":    { blocks: [
        { sheet: "usRun", framePos: {x:1,y:0}, duration: 2 },
        { sheet: "usRun", framePos: {x:2,y:0}, duration: 5 },
        { sheet: "usRun", framePos: {x:1,y:1}, duration: 5 },
    ]},
    "player.bullet.startup": { blocks: [
        { sheet: "usFire", framePos: {x:0,y:2}, duration: 2 },
        { sheet: "usFire", framePos: {x:2,y:0}, duration: 2 },
        { sheet: "usFire", framePos: {x:0,y:2}, duration: 2 },
    ]},
};


const animationFrames = await buildAnimationFrames(spritesheets, animationSequences);


const corridorBG = await loadImage("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPAAAAAoCAYAAADAOHfQAAAFCklEQVR4AexdPY4UPRD116Rf9mX7BdyAcCRyUqQl4hpcg7sQzAEgQwR7CoTQRpAiNmHxW7ZaNaZcbve6Sz3wpH7rnyq/Z5dd3b07I5gOh8MtwRjwDJzXGUgp3QLT1dVVKnFxcZGAsn9tG1yANR79gGVb0wcuoDYWNqBm7+0HF2CNQz9g2db0gQuojYUNqNl7+8EFWOPQD1i2NX3gAmpjYQNq9t5+cAHWOPQDlm1NH7iANWMxJifq3YU6gEa+4aJI091P/mAEGIHdRqBMWt02E/h4PA5djMfn2dZMosXXsvdqenyerVcH/i2+lh0cPfD4PFuPhvi2+Fp24VlaenyebSm/9hvBp5MW3NI2ExgOfwG4REbgrCIgSasnbSbw5eWl9nlw3ePzbGuEW3wte6+mx+fZenXg3+Jr2cHRA4/Ps/VoiG+Lr2UXnqWlx+fZlvJrv9F8mttMYO3AOiPACOw3AmYCP+id/dGrlDJub26SwOPzbM2wZZ0eLfBF6kVqcW2IQAWd5yR63yqzrnbLX6DhYCYwDDPuF49EWYQ88Pbb6/xzxRWphelF6kVqtdd2d5M92c88hvuWg1Be0ftW6httfCQlSWwm8PzOjslnAmxsD/KQk2vmO+n91ZhtAVpQjNSL1OLaXifvjCI+GvPe6M77+mwLOpP3sqsKM4E1E4Ki21vWI7Wwjki9SC2uDREYg+h9WzprPIXhayaw/A5w+fxjevHy5YMBoRoitTCHSL1ILa6t75wiXjVE71ttHq1+JLGZwDIQCxkF4ayVo3TAU9PQ/fAbBc1r1UfpgMfiL/vgNwold9kepQOekttqw++BSDLe4td94jei1Lwj62YCz78DDFLy+DzbGvkWX8veq+nxebZeHfi3+Fp2cPTA4/NsPRri2+Jr2YVnaenxebal/NpvNJ/mNhNYO7DOCDAC+42AmcB4ZRg5ZY/Ps62ZQ4uvZe/V9Pg8W68O/Ft8LTs4euDxebYeDfFt8bXswrO09Pg821J+7TeaT3ObCawduuv403uGfIkDZTfH0gFZB59lQkOwdOgqv0i9SC0EI1IvUusPX5uZwCfv7PfBRqKkR7++ZeXWc8DKP72f8GW7vk5sG2tBN1IvUotrc85mDs6ez2Se3urLTOCZDQmVG1h8D/KQ/itSC7OL1IvU4trML3QgLN2I3reOCV5fXyfATGD9zo7E7eA1XTVf6aBtW2tBO1IvUotrQwSWQ+9NOUrbIs5kqb+0Xf0cWF79Rn2RQ/isiYktQgv6kXqRWlxb3xc5ZG8QtxJiizqTpf6SNpIXftUnMO5CowHBEqM1hK/UkbbY+8vj/AWA4/H4W134dXk0/Eb0aQ1dH8FtcWgNqVt+I/qEvyxHcFscpQ7alt+IPnCPhpnAo0XIxwgwAttEgAm8TVzJygiERIAJHBJmijAC20SACbxNXP8wVi5nTxHAx0cyHyawRIIlI7DzCMi/woF/nVKSmAm8803j9BgBREAnL9oC/N9ICUbiwDgcGIO95gESFk9elADqeApPb66+J4Ix4BmonYH99H9KT5IG9mx6+v/XRDAGPAPneQb4OzDeRwhG4EwjMH3+8jgRjAHPwHmegendv+/TPzcfEkvGgefg/PJgevZ1Sm//+5E2KcnLuPJ8bZpfE5OXNy/evM/3IcYnMJ8Qmz4heHPY9ubAJzBf8/maf8Y3cT6Bt9o88vLJHvBw4BM4IMh8jdz2NfJvju9PAAAA//+D7uq9AAAABklEQVQDABKMPA4wFkJmAAAAAElFTkSuQmCC");


// ============================================================
// World setup
// ============================================================
let player;
let ground;
let walls = [];
let doors = [];


{
    window.worldAnchor = Sprite.withSensor(0, 0, 37, 37, "static");


    window.terrain = new Group();
    terrain.physics = "static";
    terrain.bounciness = 0;


    const surfaceY = 700;
    const doorHeight = 200;


    ground = new terrain.Sprite(37000, surfaceY + 37, 80000, 74);
    ground.visible = false;


    window.crates = new Group();


    walls[0] = new terrain.Sprite(width * -0.5, surfaceY * 0.5, 74, surfaceY);


    for (let i = 0; i < 8; i++) {
        walls[i + 1] = new terrain.Sprite((i * 6) * height - width * 0.5, (surfaceY - doorHeight) * 0.5, 74, surfaceY - doorHeight);
        doors[i] = new terrain.Sprite((i * 6) * height - width * 0.5, surfaceY - doorHeight * 0.5, 67, doorHeight);
        doors[i].color = "#bababa";
    }


    player = new Sprite(0, 300, 100, 180);
    player.facingRight = true;
    player.color = "white";
    player.rotationLock = true;
    player.friction = 0;
    player.bounciness = 0;


    window.balls = new Group();
    balls.diameter = 67;
    balls.color = "#e91e63";
    balls.bounciness = 0.9;
    balls.hp = 67;


    for (let i = 0; i < 15; i++) {
        new balls.Sprite(random(100, 700), random(50, 400));
    }
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
};


const anim = createAnimator(player, animationFrames, animationSequences);
anim.playBase("player.idle");


pdata.activeAttacks.overlaps(balls, handleHit);
pdata.activeAttacks.overlaps(terrain, handleHit);
player.passes(pdata.activeAttacks);


// ============================================================
// Input -> intended actions
// ============================================================
function computePlayerActions(pdata, player, kb) {
    const actions = {
        moveX: 0,
        facingRight: player.facingRight,
        jump: false,
        attack: null,
    };


    if (kb.pressing("left")) {
        actions.moveX = -10;
        actions.facingRight = false;
    } else if (kb.pressing("right")) {
        actions.moveX = 10;
        actions.facingRight = true;
    }


    if (kb.presses("up") && pdata.groundedTimer > 0) {
        actions.jump = true;
    }


    if (kb.presses("space") && pdata.attackCooldown === 0) {
        const isGrounded = pdata.groundedTimer > 0;
        const holdingForward = (player.facingRight && kb.pressing("right")) || (!player.facingRight && kb.pressing("left"));


        if (isGrounded) {
            actions.attack = "ground_punch";
        } else if (holdingForward) {
            actions.attack = "air_forward";
        } else {
            actions.attack = "air_explosion";
        }
    }


    if (kb.presses("z") && pdata.attackCooldown === 0) actions.attack = "molotov_throw";
    if (kb.presses("x") && pdata.attackCooldown === 0) actions.attack = "beer_throw";
    if (kb.presses("c") && pdata.attackCooldown === 0) actions.attack = "bullet";


    return actions;
}


// ============================================================
// Main loop
// ============================================================
q5.update = function () {
    // --- Background scroll ---
    const positionAlongCorridor = camera.x % (height * 6);
    image(corridorBG, (3 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    if (positionAlongCorridor < 0) {
        image(corridorBG, (-3 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    } else if (positionAlongCorridor > height * 6 - width) {
        image(corridorBG, (9 * height - width * 0.5) - positionAlongCorridor, 0, height * 6, height);
    }


    // Grounded check: collision OR resting (velocity-based fallback, but only when not mid-jump)
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


    // --- Input -> action -> physics ---
    const actions = computePlayerActions(pdata, player, kb);


    player.vel.x = actions.moveX;
    player.facingRight = actions.facingRight;


    if (actions.jump) {
    player.vel.y = -16;
    pdata.groundedTimer = 0;
    pdata.airborne = true;
}


    camera.x += (player.x - camera.x) * 0.67;


    // --- Base animation: pure function of horizontal movement ---
    anim.playBase(actions.moveX !== 0 ? "player.run" : "player.idle");


    // --- Attack cooldown tick ---
    if (pdata.attackCooldown > 0) pdata.attackCooldown--;


    // --- One-shot attack animation: triggered by input, spawns hitbox on completion ---
    if (actions.attack && !anim.isOneShotPlaying() && pdata.attackCooldown === 0) {
        pdata.pendingAttack = actions.attack;
        player.color = "pink";
        anim.playOneShot(`player.${actions.attack}.startup`, () => {
            createAttack(pdata.pendingAttack);
            pdata.pendingAttack = null;
            player.color = "white";
        });
    }


    // --- Advance + render animation ---
    anim.update();
    anim.render();


    // --- Per-sprite everyFrame callbacks ---
    for (let i = 0; i < allSprites.length; i++) {
        const sprite = allSprites[i];
        if (!sprite.everyFrame) {
            throw "no everyFrame object";
        }


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
};


// ============================================================
// Helpers
// ============================================================
function despawnAfter(sprite, frames) {
    let f = 0;
    sprite.everyFrame = sprite.everyFrame || {};
    sprite.everyFrame.despawn = {
        duration: frames + 1,
        f: () => {
            f++;
            if (f >= frames) sprite.delete();
        },
    };
}


// ============================================================
// Attack spawning
// FIX: No more GlueJoint — hitboxes follow the player via everyFrame manual repositioning.
// This eliminates physics coupling that was breaking the player's terrain collisions.
// FIX: despawnAfter ensures hitboxes (and their interference) actually go away.
// ============================================================
function createAttack(type) {
    let a;
    let offsetX = 0;
    let offsetY = 0;
    let attachToPlayer = true;


    if (type === "ground_punch") {
        offsetX = 80;
        offsetY = 40;
        a = Sprite.withSensor(player.x + (player.facingRight ? offsetX : -offsetX), player.y + offsetY, 100, 60);
        a.life = 15;
    }


    else if (type === "air_forward") {
        offsetX = 100;
        offsetY = 40;
        a = Sprite.withSensor(player.x + (player.facingRight ? offsetX : -offsetX), player.y + offsetY, 120, 40);
        a.life = 8;
    }


    else if (type === "air_explosion") {
        offsetX = 0;
        offsetY = 0;
        a = Sprite.withSensor(player.x, player.y, 250);
        a.life = 25;
    }


    else if (type === "molotov_throw" || type === "beer_throw" || type === "bullet") {
        a = createProjectile(player, type);
        pdata.activeAttacks.add(a);
        pdata.attackCooldown = 6;
        return;
    }


    a.img = "\u{1f98c}";
    a.type = type;
    a.facingRight = player.facingRight;


    pdata.activeAttacks.add(a);
    pdata.attackCooldown = a.life + 10;


    a.debug = true;


    // Follow player manually via everyFrame — no joint, no physics coupling
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


// ============================================================
// Hit resolution
// ============================================================
function handleHit(attack, target) {
    const isProjectile = attack.type === "molotov_throw" || attack.type === "beer_throw" || attack.type === "bullet";


    const hittables = [...balls];
    const targetIsHittable = hittables.includes(target);


    const targetHasHP = target.hasOwnProperty("hp");


    if (isProjectile) {
        handleProjectileHit(attack, target, hittables);
    }
    else if (targetIsHittable) {
        if (attack.type === "ground_punch") {
            target.vel.x = attack.facingRight ? 15 : -15; target.vel.y = -5;
            target.hp -= 20;
        }
        else if (attack.type === "air_forward") {
            target.vel.x = attack.facingRight ? 20 : -20; target.vel.y = -10;
            target.hp -= 18;
        }
        else if (attack.type === "air_explosion") {
            let angle = atan2(target.y - attack.y, target.x - attack.x);
            target.vel.x = 25 * cos(angle);
            target.vel.y = 25 * sin(angle) ** 2;


            target.hp -= 37;
        }
    }


    if (targetHasHP && target.hp < 0) {
        target.delete();
    }
}

