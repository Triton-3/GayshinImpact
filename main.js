import * as THREE from 'three';
import {
    GLTFLoader
} from 'three/addons/loaders/GLTFLoader.js';
import {
    EffectComposer
} from 'three/addons/postprocessing/EffectComposer.js';
import {
    RenderPass
} from 'three/addons/postprocessing/RenderPass.js';
import {
    UnrealBloomPass
} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {
    ShaderPass
} from 'three/addons/postprocessing/ShaderPass.js';
import {
    OutlinePass
} from 'three/addons/postprocessing/OutlinePass.js';
import {
    FXAAShader
} from 'three/addons/shaders/FXAAShader.js';

const clock = new THREE.Clock();

// --- Player Attack System Variables ---
let isPlayerAttacking = false;
let currentAttackComboCount = 0;
const maxSlashesInCombo = 5;
const timeBetweenSlashes = 120;
const slashLifetime = 0.7;
const activeSlashes = [];
const slashDamageAmount = 20000;
const slashOuterRadius = 1.3;
const slashArcVisualThickness = 0.15;
const slashInnerRadius = slashOuterRadius - slashArcVisualThickness;
const slashArcAngle = Math.PI * 0.7;
const slashThetaSegments = 32;
const slashGeometry = new THREE.RingGeometry(slashInnerRadius, slashOuterRadius, slashThetaSegments, 1, 0, slashArcAngle);
slashGeometry.computeBoundingSphere();
const slashMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFFF33,
    emissive: 0xCCAA00,
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    toneMapped: false,
});
// --- End Player Attack System Variables ---

// --- Basic Three.js Setup ---
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({
    antialias: false
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
scene.fog = new THREE.FogExp2(0x1a2a4a, 0.0035);
const ENTIRE_SCENE = 0;
const BLOOM_SCENE = 1;
camera.layers.enable(ENTIRE_SCENE);
camera.layers.enable(BLOOM_SCENE);
// --- Postprocessing Setup ---
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.8, 0.9, 0.15);
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(renderPass);
bloomComposer.addPass(bloomPass);
const outlinePass = new OutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
outlinePass.overlayMaterial.blending = THREE.SubtractiveBlending;
outlinePass.edgeStrength = 3.0;
outlinePass.edgeThickness = 1.0;
outlinePass.visibleEdgeColor.set('#ffffff');
outlinePass.hiddenEdgeColor.set('#ffffff');
const bloomBlendPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
        baseTexture: {
            value: null
        },
        bloomTexture: {
            value: bloomComposer.renderTarget2.texture
        }
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
    fragmentShader: `uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main() { gl_FragColor = texture2D( baseTexture, vUv ) + texture2D( bloomTexture, vUv ); }`,
    defines: {}
}), 'baseTexture');
bloomBlendPass.needsSwap = true;
const fxaaPass = new ShaderPass(FXAAShader);
const pixelRatio = renderer.getPixelRatio();
fxaaPass.material.uniforms['resolution'].value.x = 1 / (window.innerWidth * pixelRatio);
fxaaPass.material.uniforms['resolution'].value.y = 1 / (window.innerHeight * pixelRatio);
const finalComposer = new EffectComposer(renderer);
finalComposer.addPass(renderPass);
finalComposer.addPass(bloomBlendPass);
finalComposer.addPass(outlinePass);
finalComposer.addPass(fxaaPass);
// --- End Postprocessing ---

// --- Player Health & UI ---
const playerMaxHealth = 69000;
let playerCurrentHealth = playerMaxHealth;
const healthBarFillEl = document.getElementById('healthbar');
const healthBarTextEl = document.getElementById('healthbar-text');

function formatNumberWithCommas(number) {
    return Math.round(number).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function updateHealthBarUI() {
    const healthPercentage = Math.max(0, (playerCurrentHealth / playerMaxHealth) * 100);
    healthBarFillEl.style.width = healthPercentage + '%';
    healthBarTextEl.innerText = `${formatNumberWithCommas(playerCurrentHealth)} / ${formatNumberWithCommas(playerMaxHealth)}`;
    if (healthPercentage < 30) {
        healthBarFillEl.style.backgroundColor = '#ff5452';
    } else if (healthPercentage < 60) {
        healthBarFillEl.style.backgroundColor = '#ffd700';
    } else {
        healthBarFillEl.style.backgroundColor = '#a4d548';
    }
}
updateHealthBarUI();
// --- End Player Health ---

// --- Boss Variables & UI ---
const bossMaxHealth = 6900000;
let bossCurrentHealth = bossMaxHealth;
const bossHealthBarFillEl = document.getElementById('boss-healthbar');
let isBossDefeated = false;
let isBossPhase2 = false;
const bossPhase2Threshold = 0.5;
const bossMoveSpeed = 1.2;
const bossEmissiveIntensityPhase2 = 0.7;
const bossPhaseTransitionDuration = 2.0;
let bossInPhaseTransition = false;
let bossPhaseTransitionTimer = 0;
const bossDefeatGlowIntensity = 2.5;
const bossPhase2SpiralRotationSpeed = 0.25;
let bossPhase2SpiralOffset = 0;
// --- End Boss Variables ---

// --- Player Launch, Fall Damage & Aerial Slam Mechanics ---
const playerLaunchVelocityY = 2;
const playerCollisionRadius = 0.7;
const playerCollisionOffsetY = 1.0;
const playerBoundingSphere = new THREE.Sphere();
let playerLaunchCooldown = 1.5;
let timeSinceLastLaunch = playerLaunchCooldown;
let maxHeightReachedDuringFall = 0;
const minFallDamageHeight = 2.5;
const fallDamageMultiplier = 1000;
let isAerialSlamming = false;
const aerialSlamSpeed = 0.8;
const aerialSlamTrailMaterial = new THREE.LineBasicMaterial({
    color: 0x9933FF,
    linewidth: 3,
    transparent: true,
    opacity: 0.8
});
const activeSlamTrails = [];
const slamTrailSegmentLifetime = 0.5;
const slamTrailSpawnInterval = 0.03;
let timeSinceLastTrailSegment = 0;
let lastTrailPoint = null;
const slamExplosionMaxRadius = 4.0;
const slamExplosionLifetime = 0.6;
const slamExplosionDamage = 500000;
const slamExplosionGeometry = new THREE.SphereGeometry(1, 32, 16);
const slamExplosionMaterialBase = new THREE.MeshStandardMaterial({
    color: 0x9933FF,
    emissive: 0x7700FF,
    emissiveIntensity: 2.5,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide,
    toneMapped: false
});
let activeSlamExplosion = null;
const tempExplosionSphere = new THREE.Sphere();
let playerSpawnPoint = new THREE.Vector3(0, 0, 0);
const fallTeleportThresholdY = -50;
let isPlayerFallingOffEdge = false;
let playerFallOffTimer = 0;
const playerFallOffDuration = 2.0;
let isImmuneDuringSlamDescent = false;
let isImmuneAfterSlamLand = false;
const slamLandImmunityDuration = 0.75;
let slamLandImmunityTimer = 0;
// --- End Player Mechanics ---

// --- End Boss Health & UI ---

// --- Elemental Burst Variables & UI ---
const burstFillEl = document.getElementById('fill');
const burstImageEl = document.querySelector('#burst-container .circle-image');
let currentBurstPercentage = 0;
const maxBurstPercentage = 100;
const chargeAmountPerHit = 1;
let isBurstReady = false;
let isBurstActivating = false;
let activeBurstSlashMesh = null;
let isBurstPowerUpActive = false;
const burstSlashOuterRadius = 3.5;
const burstSlashArcVisualThickness = 0.3;
const burstSlashInnerRadius = burstSlashOuterRadius - burstSlashArcVisualThickness;
const burstSlashArcAngle = Math.PI * 1.2;
const burstSlashThetaStart = -Math.PI / 2 - (burstSlashArcAngle / 2);
const burstSlashThetaSegments = 48;
const burstSlashLifetime = 1.2;
const burstSlashDamage = 1000000;
const burstSlashGeometry = new THREE.RingGeometry(burstSlashInnerRadius, burstSlashOuterRadius, burstSlashThetaSegments, 1, burstSlashThetaStart, burstSlashArcAngle);
burstSlashGeometry.computeBoundingSphere();
const burstSlashMaterialBase = new THREE.MeshStandardMaterial({
    color: 0x9933FF,
    emissive: 0x7700CC,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    toneMapped: false,
});
const poweredUpSlashColor = 0x9933FF;
const poweredUpSlashEmissive = 0x7700CC;
const poweredUpSlashEmissiveIntensity = 2.0;

function updateBurstUI() {
    if (!burstFillEl || !burstImageEl) {
        return;
    }
    burstFillEl.style.height = currentBurstPercentage + '%';
    if (currentBurstPercentage >= maxBurstPercentage) {
        burstFillEl.style.opacity = '0';
        burstImageEl.style.filter = 'brightness(1)';
        isBurstReady = true;
    } else {
        burstFillEl.style.opacity = '0.6';
        burstImageEl.style.filter = 'brightness(0.5)';
        isBurstReady = false;
    }
}
updateBurstUI();
// --- End Elemental Burst ---

// --- Scene Objects ---
const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
        topColor: {
            value: new THREE.Color("#192a5e")
        },
        bottomColor: {
            value: new THREE.Color("#4780d9")
        },
    },
    vertexShader: `varying vec3 vPosition; void main() { vPosition = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying vec3 vPosition; uniform vec3 topColor; uniform vec3 bottomColor; void main() { float mixFactor = smoothstep(-200.0, 200.0, vPosition.y); gl_FragColor = vec4(mix(bottomColor, topColor, mixFactor), 1.0); }`,
    side: THREE.BackSide,
    fog: false
});
const skySphere = new THREE.Mesh(skyGeometry, skyMaterial);
skySphere.layers.set(ENTIRE_SCENE);
scene.add(skySphere);
const moonGeometry = new THREE.SphereGeometry(7, 32, 32);
const moonMaterial = new THREE.MeshStandardMaterial({
    color: "#e0f0ff",
    emissive: "#e0f0ff",
    emissiveIntensity: 3.0,
    toneMapped: false
});
const moon = new THREE.Mesh(moonGeometry, moonMaterial);
moon.position.set(-150, 200, 200);
moon.layers.enable(ENTIRE_SCENE);
moon.layers.enable(BLOOM_SCENE);
scene.add(moon);
const textureLoader = new THREE.TextureLoader();
textureLoader.load("clouds/cloud1.png", function(cloudTexture) {
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    cloudTexture.wrapS = THREE.RepeatWrapping;
    cloudTexture.wrapT = THREE.RepeatWrapping;
    cloudTexture.repeat.set(2, 1);
    const cloudMaterial = new THREE.MeshBasicMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.1,
        depthWrite: false
    });
    for (let i = 0; i < 70; i++) {
        const cG = new THREE.PlaneGeometry(50, 10);
        const c = new THREE.Mesh(cG, cloudMaterial);
        const rX = (Math.random() - 0.5) * 300;
        const rY = 7 + Math.random() * 50;
        const rZ = (Math.random() - 0.5) * 300;
        c.position.set(rX, rY, rZ);
        c.rotation.x = -Math.PI / 6;
        const d = new THREE.Vector3(0, 0, 0).sub(c.position).normalize();
        c.lookAt(c.position.clone().add(d));
        c.layers.set(ENTIRE_SCENE);
        scene.add(c);
    }
});
textureLoader.load("clouds/cloud2.png", function(cloudTexture) {
    cloudTexture.colorSpace = THREE.SRGBColorSpace;
    cloudTexture.wrapS = THREE.RepeatWrapping;
    cloudTexture.wrapT = THREE.RepeatWrapping;
    cloudTexture.repeat.set(2, 1);
    const cloudMaterial = new THREE.MeshBasicMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.01,
        depthWrite: false
    });
    for (let i = 0; i < 70; i++) {
        const cG = new THREE.PlaneGeometry(50, 10);
        const c = new THREE.Mesh(cG, cloudMaterial);
        const rX = (Math.random() - 0.5) * 300;
        const rY = 7 + Math.random() * 50;
        const rZ = (Math.random() - 0.5) * 300;
        c.position.set(rX, rY, rZ);
        c.rotation.x = -Math.PI / 6;
        const d = new THREE.Vector3(0, 0, 0).sub(c.position).normalize();
        c.lookAt(c.position.clone().add(d));
        c.layers.set(ENTIRE_SCENE);
        scene.add(c);
    }
});
const starGeometry = new THREE.BufferGeometry();
const starVertices = [];
for (let i = 0; i < 1000; i++) {
    const x = (Math.random() - 0.5) * 1500;
    const y = (Math.random() - 0.5) * 1500;
    const z = (Math.random() - 0.5) * 1500;
    starVertices.push(x, y, z);
}
starGeometry.setAttribute("position", new THREE.Float32BufferAttribute(starVertices, 3));
const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    sizeAttenuation: false,
    fog: false
});
const stars = new THREE.Points(starGeometry, starMaterial);
stars.layers.set(ENTIRE_SCENE);
scene.add(stars);
const groundSize = 100;
const wallHeight = 50;
const wallThickness = 1;
const wallYOffset = 0.01;
const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize);
const groundMaterial = new THREE.MeshStandardMaterial({
    color: "#646373",
    metalness: 0.1,
    roughness: 0.8
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.layers.set(ENTIRE_SCENE);
ground.receiveShadow = true;
scene.add(ground);
const wallMaterial = new THREE.MeshStandardMaterial({
    color: "#504f5e",
    metalness: 0.1,
    roughness: 0.9
});
const wall1Geo = new THREE.BoxGeometry(wallThickness, wallHeight, groundSize + wallThickness);
const wall1 = new THREE.Mesh(wall1Geo, wallMaterial);
wall1.position.set(groundSize / 2 + wallThickness / 2, -wallHeight / 2 - wallYOffset, 0);
wall1.receiveShadow = true;
scene.add(wall1);
const wall2Geo = new THREE.BoxGeometry(wallThickness, wallHeight, groundSize + wallThickness);
const wall2 = new THREE.Mesh(wall2Geo, wallMaterial);
wall2.position.set(-groundSize / 2 - wallThickness / 2, -wallHeight / 2 - wallYOffset, 0);
wall2.receiveShadow = true;
scene.add(wall2);
const wall3Geo = new THREE.BoxGeometry(groundSize + wallThickness, wallHeight, wallThickness);
const wall3 = new THREE.Mesh(wall3Geo, wallMaterial);
wall3.position.set(0, -wallHeight / 2 - wallYOffset, groundSize / 2 + wallThickness / 2);
wall3.receiveShadow = true;
scene.add(wall3);
const wall4Geo = new THREE.BoxGeometry(groundSize + wallThickness, wallHeight, wallThickness);
const wall4 = new THREE.Mesh(wall4Geo, wallMaterial);
wall4.position.set(0, -wallHeight / 2 - wallYOffset, -groundSize / 2 - wallThickness / 2);
wall4.receiveShadow = true;
scene.add(wall4);
// --- End Scene Objects ---

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0x7080a0, 0.5);
ambientLight.layers.enable(ENTIRE_SCENE);
scene.add(ambientLight);
const moonLight = new THREE.DirectionalLight(0xe0f0ff, 4.0);
moonLight.position.set(-150, 200, 200);
moonLight.target.position.set(0, 0, 0);
moonLight.castShadow = true;
moonLight.shadow.mapSize.width = 2048;
moonLight.shadow.mapSize.height = 2048;
moonLight.shadow.camera.left = -50;
moonLight.shadow.camera.right = 50;
moonLight.shadow.camera.top = 50;
moonLight.shadow.camera.bottom = -50;
moonLight.shadow.camera.near = 1;
moonLight.shadow.camera.far = 500;
moonLight.shadow.bias = 0;
moonLight.layers.enable(ENTIRE_SCENE);
scene.add(moonLight);
scene.add(moonLight.target);
// --- End Lights ---

// --- Player Model ---
let player;
const gltfLoader = new GLTFLoader();
gltfLoader.load('textures/skirk/scene.gltf', (gltf) => {
    player = gltf.scene;
    player.scale.set(1.5, 1.5, 1.5);
    player.traverse(function(node) {
        if (node.isMesh) {
            node.castShadow = true;
            node.receiveShadow = true;
        }
    });
    scene.add(player);
    outlinePass.selectedObjects = [player];
    playerSpawnPoint.copy(player.position);
    maxHeightReachedDuringFall = player.position.y;
    lastTrailPoint = player.position.clone();
});
// --- End Player Model ---

// --- Boss Cube ---
const bossLoaderTexture = new THREE.TextureLoader();
const bossMaterial = new THREE.MeshStandardMaterial({
    map: bossLoaderTexture.load('textures/boss/gojo.png'),
    color: 0xffffff,
    emissive: 0x000000,
    emissiveIntensity: 1
});
const bossCubeGeo = new THREE.BoxGeometry(5, 5, 5);
const boss = new THREE.Mesh(bossCubeGeo, bossMaterial);
boss.position.set(0, 5, -4);
boss.layers.set(ENTIRE_SCENE);
boss.castShadow = true;
boss.receiveShadow = true;
scene.add(boss);
const bossBoundingBox = new THREE.Box3();
// --- End Boss Cube ---

function updateBossHealthBarUI() {
    if (bossHealthBarFillEl && boss) {
        const healthPercentage = Math.max(0, (bossCurrentHealth / bossMaxHealth) * 100);
        bossHealthBarFillEl.style.width = healthPercentage + '%';
        if (!isBossPhase2 && !bossInPhaseTransition && !isBossDefeated && (bossCurrentHealth / bossMaxHealth) <= bossPhase2Threshold) {
            console.log("Boss initiating Phase 2 transition...");
            bossInPhaseTransition = true;
            bossPhaseTransitionTimer = 0;
            const bossNameEl = document.getElementById('boss-name');
            const bossDesc = document.getElementById("boss-desc");
            if (bossNameEl) {
                bossNameEl.innerText = "C6 Gojo Satoeru (+ Locked In)";
                bossDesc.innerText = "Domain Expansion: Why So Serious"
            }
        }
    }
}
updateBossHealthBarUI();

// --- Missile Configuration ---
const activeMissiles = [];
let missileSpeed = 6;
const missileLifetime = 6;
const missileFireIntervalP1 = 2.0;
const missileFireIntervalP2 = 0.2;
let timeSinceLastMissile = missileFireIntervalP1;
const bossMissilesPerBurstPhase2 = 20;
const phase1MissileDamage = 1000;
const phase1MissileColor = 0x007bff;
const phase1MissileEmissive = 0x0056b3;
const phase2MissileDamage = 420;
const phase2MissileColor = 0xff0000;
const phase2MissileEmissive = 0xcc0000;
const missileGeometry = new THREE.SphereGeometry(0.3, 8, 8);
const baseMissileMaterial = new THREE.MeshStandardMaterial({
    emissiveIntensity: 1.5,
    toneMapped: false
});
// --- End Missile Configuration ---

// --- Camera Settings & Movement ---
let groundLevel = 0;
let cameraDistance = 5;
let targetCameraDistance = 5;
let cameraAngleH = 0;
let cameraAngleV = Math.PI / 6;
const minZoom = 0.4;
const maxZoom = 20;
const zoomSpeed = 0.1;
const rotationSpeed = 0.15;
const jumpSpeed = 0.2;
const gravity = 0.01;
let moveSpeed = 0.1;
let velocityY = 0;
let isJumping = false;
const keys = {
    w: false,
    a: false,
    s: false,
    d: false,
    space: false,
    shift: false,
    q: false
};
// --- End Camera Settings ---

// --- Event Listeners ---
document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    else if (key == " ") keys.space = true;
    if (key === 'q') {
        activateElementalBurst();
    }
});
document.addEventListener("keyup", (event) => {
    const key = event.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;
    else if (key == " ") keys.space = false;
});
let isDragging = false;
let previousMouseX = 0;
let previousMouseY = 0;
document.addEventListener("mousedown", (event) => {
    if (event.target === renderer.domElement) {
        isDragging = true;
        previousMouseX = event.clientX;
        previousMouseY = event.clientY;
        event.preventDefault();
    }
});
document.addEventListener("mouseup", () => {
    isDragging = false;
});
document.addEventListener("mousemove", (event) => {
    if (isDragging) {
        let deltaX = event.clientX - previousMouseX;
        let deltaY = event.clientY - previousMouseY;
        cameraAngleH += deltaX * 0.0035;
        cameraAngleV -= deltaY * 0.0035;
        const maxV = Math.PI / 2.5;
        cameraAngleV = Math.min(maxV, cameraAngleV);
        previousMouseX = event.clientX;
        previousMouseY = event.clientY;
    }
});
document.addEventListener("wheel", (event) => {
    targetCameraDistance += event.deltaY * 0.01;
    targetCameraDistance = Math.max(minZoom, Math.min(maxZoom, targetCameraDistance));
});
// --- End Event Listeners ---

// --- Helper Functions ---
function shortestRotation(current, target) {
    let diff = ((target - current + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (Math.abs(diff) > Math.PI) {
        if (diff > 0) diff -= 2 * Math.PI;
        else diff += 2 * Math.PI;
    }
    return current + diff * rotationSpeed;
}

function getCameraDirection() {
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    direction.y = 0;
    direction.normalize();
    return direction;
}
// --- End Helper Functions ---

// --- spawnMissile Function ---
function spawnMissile() {
    if (!player || !boss || isBossDefeated || bossInPhaseTransition) return;
    if (isBossPhase2) {
        for (let i = 0; i < bossMissilesPerBurstPhase2; i++) {
            const missile = new THREE.Mesh(missileGeometry, baseMissileMaterial.clone());
            const angle = (i / bossMissilesPerBurstPhase2) * Math.PI * 2 + bossPhase2SpiralOffset;
            const direction = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)).normalize();
            missile.material.color.setHex(phase2MissileColor);
            missile.material.emissive.setHex(phase2MissileEmissive);
            missile.material.needsUpdate = true;
            const spawnHeightP2 = groundLevel + 0.5;
            missile.position.set(boss.position.x, spawnHeightP2, boss.position.z);
            missile.position.add(direction.clone().multiplyScalar(0.5));
            missile.userData = {
                speed: missileSpeed,
                creationTime: clock.getElapsedTime(),
                damage: phase2MissileDamage,
                direction: direction
            };
            activeMissiles.push(missile);
            scene.add(missile);
            missile.layers.enable(BLOOM_SCENE);
        }
    } else {
        const missile = new THREE.Mesh(missileGeometry, baseMissileMaterial.clone());
        missile.material.color.setHex(phase1MissileColor);
        missile.material.emissive.setHex(phase1MissileEmissive);
        missile.material.needsUpdate = true;
        missile.position.copy(boss.position);
        missile.position.y += 1.0;
        missile.userData = {
            target: player,
            speed: missileSpeed,
            creationTime: clock.getElapsedTime(),
            damage: phase1MissileDamage
        };
        activeMissiles.push(missile);
        scene.add(missile);
        missile.layers.enable(BLOOM_SCENE);
    }
}
// --- End spawnMissile ---

// --- Player Attack, Aerial Slam & Burst Functions ---
function spawnSlash(comboIndex) {
    if (!player || isBossDefeated || isBurstActivating || isAerialSlamming) return;
    const slash = new THREE.Mesh(slashGeometry, slashMaterial.clone());
    if (isBurstPowerUpActive) {
        slash.material.color.setHex(poweredUpSlashColor);
        slash.material.emissive.setHex(poweredUpSlashEmissive);
        slash.material.emissiveIntensity = poweredUpSlashEmissiveIntensity;
    }
    const playerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
    const playerWorldUp = new THREE.Vector3(0, 1, 0);
    const playerRight = new THREE.Vector3().crossVectors(playerForward, playerWorldUp).normalize();
    let spawnPos = player.position.clone().add(playerForward.clone().multiplyScalar(slashOuterRadius * 0.8)).add(new THREE.Vector3(0, 1.3, 0));
    let horizontalOffset = (Math.random() - 0.5) * 0.1;
    let verticalOffset = (Math.random() - 0.5) * 0.1;
    spawnPos.add(playerRight.clone().multiplyScalar(horizontalOffset));
    spawnPos.y += verticalOffset;
    slash.position.copy(spawnPos);
    slash.quaternion.copy(player.quaternion);
    slash.rotateX(Math.PI / 2);
    const xArmAngle = Math.PI / 4;
    slash.rotateY(-Math.PI / 2);
    if (comboIndex % 2 === 0) {
        slash.rotateY(xArmAngle + (Math.random() - 0.5) * 0.2);
    } else {
        slash.rotateY(-xArmAngle + (Math.random() - 0.5) * 0.2);
    }
    slash.rotateZ((Math.random() - 0.5) * 0.1);
    slash.userData = {
        creationTime: clock.getElapsedTime(),
        lifetime: slashLifetime * (1 + (Math.random() - 0.5) * 0.15),
        hasHitBoss: false
    };
    activeSlashes.push(slash);
    scene.add(slash);
    slash.layers.enable(BLOOM_SCENE);
}

function executeNextSlashInCombo() {
    if (currentAttackComboCount >= maxSlashesInCombo || !player || playerCurrentHealth <= 0 || isBossDefeated || isBurstActivating || isAerialSlamming) {
        isPlayerAttacking = false;
        currentAttackComboCount = 0;
        return;
    }
    spawnSlash(currentAttackComboCount);
    currentAttackComboCount++;
    if (currentAttackComboCount < maxSlashesInCombo) {
        setTimeout(executeNextSlashInCombo, timeBetweenSlashes);
    } else {
        setTimeout(() => {
            isPlayerAttacking = false;
            currentAttackComboCount = 0;
        }, timeBetweenSlashes * 1.5);
    }
}

function handlePlayerAttack() {
    if (!player || playerCurrentHealth <= 0 || isBossDefeated || isBurstActivating || isAerialSlamming) {
        return;
    }

    if (isJumping && player.position.y > groundLevel + 5) {
        console.log("Aerial Slam initiated!");
        isAerialSlamming = true;
        isPlayerAttacking = false;
        currentAttackComboCount = 0;

        isImmuneDuringSlamDescent = true;
        isImmuneAfterSlamLand = false;
        slamLandImmunityTimer = 0;

        maxHeightReachedDuringFall = player.position.y;
        velocityY = -aerialSlamSpeed;
        lastTrailPoint = player.position.clone();
        timeSinceLastTrailSegment = slamTrailSpawnInterval;

    } else if (!isPlayerAttacking) { // Ground attack
        isPlayerAttacking = true;
        currentAttackComboCount = 0;

        const sound = new Audio('textures/raa.mp3');
        sound.play();

        executeNextSlashInCombo();
    }
}

function spawnSlamTrailSegment() {
    if (!player || !lastTrailPoint) return;
    const currentPoint = player.position.clone();
    if (currentPoint.distanceTo(lastTrailPoint) < 0.05) return;
    const points = [lastTrailPoint, currentPoint];
    const trailGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const trailMaterialInstance = aerialSlamTrailMaterial.clone();
    trailMaterialInstance.opacity = 0.8;
    const trailLine = new THREE.Line(trailGeometry, trailMaterialInstance);
    trailLine.userData = {
        creationTime: clock.getElapsedTime()
    };
    activeSlamTrails.push(trailLine);
    scene.add(trailLine);
    trailLine.layers.enable(BLOOM_SCENE);
    lastTrailPoint = currentPoint;
}

function updateSlamTrails(deltaTime) {
    for (let i = activeSlamTrails.length - 1; i >= 0; i--) {
        const trail = activeSlamTrails[i];
        const elapsedTime = clock.getElapsedTime() - trail.userData.creationTime;
        const lifeRatio = Math.min(1.0, elapsedTime / slamTrailSegmentLifetime);
        if (lifeRatio >= 1.0) {
            scene.remove(trail);
            if (trail.geometry) trail.geometry.dispose();
            if (trail.material) trail.material.dispose();
            activeSlamTrails.splice(i, 1);
        } else {
            trail.material.opacity = 0.8 * (1.0 - lifeRatio * lifeRatio);
        }
    }
}

function spawnSlamExplosion(position) {
    if (activeSlamExplosion) return;
    const explosionMaterial = slamExplosionMaterialBase.clone();
    const explosionMesh = new THREE.Mesh(slamExplosionGeometry, explosionMaterial);
    explosionMesh.position.copy(position);
    explosionMesh.position.y = groundLevel + 0.1;
    explosionMesh.scale.set(0.01, 0.01, 0.01);
    scene.add(explosionMesh);
    explosionMesh.layers.enable(BLOOM_SCENE);
    activeSlamExplosion = {
        mesh: explosionMesh,
        creationTime: clock.getElapsedTime(),
        hasHitBoss: false
    };
    console.log("Slam explosion spawned!");
}

function updateActiveSlamExplosion(deltaTime) {
    if (!activeSlamExplosion) return;
    const explosion = activeSlamExplosion;
    const elapsedTime = clock.getElapsedTime() - explosion.creationTime;
    const lifeRatio = Math.min(1.0, elapsedTime / slamExplosionLifetime);
    if (lifeRatio >= 1.0) {
        scene.remove(explosion.mesh);
        if (explosion.mesh.geometry) explosion.mesh.geometry.dispose();
        if (explosion.mesh.material) explosion.mesh.material.dispose();
        activeSlamExplosion = null;
        return;
    }
    const currentRadius = slamExplosionMaxRadius * Math.sqrt(lifeRatio);
    explosion.mesh.scale.set(currentRadius, currentRadius, currentRadius);
    explosion.mesh.material.opacity = 0.7 * (1.0 - lifeRatio * lifeRatio);
    if (!explosion.hasHitBoss && boss && !isBossDefeated) {
        explosion.mesh.updateMatrixWorld();
        tempExplosionSphere.set(explosion.mesh.position, currentRadius);
        boss.updateMatrixWorld();
        bossBoundingBox.setFromObject(boss);
        if (bossBoundingBox.intersectsSphere(tempExplosionSphere)) {
            console.log("Slam explosion hit boss!");
            bossCurrentHealth -= slamExplosionDamage;
            if (bossCurrentHealth < 0) bossCurrentHealth = 0;
            updateBossHealthBarUI();
            explosion.hasHitBoss = true;
        }
    }
}
const tempSlashSphere = new THREE.Sphere();

function updateSlashesInScene(deltaTime) {
    if (!boss || isBossDefeated) return;
    boss.updateMatrixWorld();
    bossBoundingBox.setFromObject(boss);
    for (let i = activeSlashes.length - 1; i >= 0; i--) {
        const slash = activeSlashes[i];
        const elapsedTime = clock.getElapsedTime() - slash.userData.creationTime;
        const lifeRatio = slash.userData.lifetime > 0 ? Math.min(1.0, elapsedTime / slash.userData.lifetime) : 1.0;
        if (lifeRatio >= 1.0) {
            scene.remove(slash);
            if (slash.material) slash.material.dispose();
            activeSlashes.splice(i, 1);
        } else {
            slash.material.opacity = 1.0 - Math.pow(lifeRatio, 2.5);
            if (!slash.userData.hasHitBoss && slash.geometry.boundingSphere) {
                slash.updateMatrixWorld();
                tempSlashSphere.copy(slash.geometry.boundingSphere).applyMatrix4(slash.matrixWorld);
                if (bossBoundingBox.intersectsSphere(tempSlashSphere)) {
                    let currentDamage = slashDamageAmount;
                    if (isBurstPowerUpActive) {
                        currentDamage *= 2;
                    }
                    bossCurrentHealth -= currentDamage;
                    if (bossCurrentHealth < 0) bossCurrentHealth = 0;
                    updateBossHealthBarUI();
                    slash.userData.hasHitBoss = true;
                    if (currentBurstPercentage < maxBurstPercentage) {
                        currentBurstPercentage += chargeAmountPerHit;
                        if (currentBurstPercentage > maxBurstPercentage) {
                            currentBurstPercentage = maxBurstPercentage;
                        }
                        updateBurstUI();
                    }
                }
            }
        }
    }
}

function spawnBurstSlash() {
    if (!player) return;
    const burstMaterialInstance = burstSlashMaterialBase.clone();
    activeBurstSlashMesh = new THREE.Mesh(burstSlashGeometry, burstMaterialInstance);
    const playerForward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.quaternion);
    const spawnOffsetForward = 1.8;
    const spawnOffsetY = 1.2;
    activeBurstSlashMesh.position.copy(player.position).add(playerForward.clone().multiplyScalar(spawnOffsetForward)).add(new THREE.Vector3(0, spawnOffsetY, 0));
    activeBurstSlashMesh.quaternion.copy(player.quaternion);
    activeBurstSlashMesh.rotateX(-Math.PI / 2);
    activeBurstSlashMesh.rotateY(Math.PI);
    activeBurstSlashMesh.userData = {
        creationTime: clock.getElapsedTime(),
        lifetime: burstSlashLifetime,
        hasHitBoss: false
    };
    scene.add(activeBurstSlashMesh);
    isBurstActivating = true;
    activeBurstSlashMesh.layers.enable(BLOOM_SCENE);
}

function activateElementalBurst() {
    if (isBurstReady && !isBurstActivating && player && playerCurrentHealth > 0) {
        console.log("Elemental Burst Activated!");
        currentBurstPercentage = 0;
        isBurstReady = false;
        updateBurstUI();
        spawnBurstSlash();
        if (!isBurstPowerUpActive) {
            isBurstPowerUpActive = true;
            console.log("Player attacks permanently powered up!");
        }
    }
}

function updateActiveBurstSlash(deltaTime) {
    if (!activeBurstSlashMesh) return;
    const elapsedTime = clock.getElapsedTime() - activeBurstSlashMesh.userData.creationTime;
    const lifeRatio = activeBurstSlashMesh.userData.lifetime > 0 ? Math.min(1.0, elapsedTime / burstSlashLifetime) : 1.0;
    if (lifeRatio >= 1.0) {
        scene.remove(activeBurstSlashMesh);
        if (activeBurstSlashMesh.material) activeBurstSlashMesh.material.dispose();
        activeBurstSlashMesh = null;
        isBurstActivating = false;
    } else {
        activeBurstSlashMesh.material.opacity = 1.0 - Math.pow(lifeRatio, 2.0);
        if (boss && !isBossDefeated && !activeBurstSlashMesh.userData.hasHitBoss && activeBurstSlashMesh.geometry.boundingSphere) {
            boss.updateMatrixWorld();
            bossBoundingBox.setFromObject(boss);
            activeBurstSlashMesh.updateMatrixWorld();
            tempSlashSphere.copy(activeBurstSlashMesh.geometry.boundingSphere).applyMatrix4(activeBurstSlashMesh.matrixWorld);
            if (bossBoundingBox.intersectsSphere(tempSlashSphere)) {
                console.log("Burst Slash hit boss!");
                bossCurrentHealth -= burstSlashDamage;
                if (bossCurrentHealth < 0) bossCurrentHealth = 0;
                updateBossHealthBarUI();
                activeBurstSlashMesh.userData.hasHitBoss = true;
            }
        }
    }
}
// --- End Player Functions ---

// Event listener for MOUSE CLICK (Player Attack)
document.addEventListener('mousedown', (event) => {
    if (event.target === renderer.domElement && event.button === 0) {
        handlePlayerAttack();
    }
});

// --- Game Loop ---
// --- Game Loop ---
function animate() {
    requestAnimationFrame(animate);
    const deltaTime = clock.getDelta();

    if (playerCurrentHealth <= 0) {
        window.location.href = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    }

    timeSinceLastLaunch += deltaTime;
    if (isAerialSlamming) {
        timeSinceLastTrailSegment += deltaTime;
    }

    if (isImmuneAfterSlamLand) {
        slamLandImmunityTimer += deltaTime;
        if (slamLandImmunityTimer >= slamLandImmunityDuration) {
            isImmuneAfterSlamLand = false;
            // console.log("Slam ground launch immunity ended."); // Optional debug
        }
    }

    if (player) {
        updateSlashesInScene(deltaTime);
        if (activeBurstSlashMesh) {
            updateActiveBurstSlash(deltaTime);
        }
        updateSlamTrails(deltaTime);
        if (activeSlamExplosion) {
            updateActiveSlamExplosion(deltaTime);
        }
    }

    // --- Boss Logic ---
    // ... (Boss logic - unchanged) ...
    if (boss && !isBossDefeated) {
        if (bossInPhaseTransition) {
            bossPhaseTransitionTimer += deltaTime;
            if (bossPhaseTransitionTimer >= bossPhaseTransitionDuration) {
                const sound = new Audio('textures/wss.mp3');
                sound.play();

                isBossPhase2 = true;
                bossInPhaseTransition = false;
                console.log("Boss entering Phase 2 actions!");
                if (boss.material && boss.material.isMeshStandardMaterial) {
                    boss.material.emissive.setHex(0xff0000);
                    boss.material.emissiveIntensity = bossEmissiveIntensityPhase2;
                    boss.material.needsUpdate = true;
                }
                boss.layers.enable(BLOOM_SCENE);
                timeSinceLastMissile = missileFireIntervalP2;
                bossPhase2SpiralOffset = 0;
            }
        } else if (isBossPhase2) {
            bossPhase2SpiralOffset += bossPhase2SpiralRotationSpeed * deltaTime;
            if (bossPhase2SpiralOffset > Math.PI * 2) {
                bossPhase2SpiralOffset -= Math.PI * 2;
            }
            if (player) {
                const directionToPlayer = player.position.clone().sub(boss.position);
                directionToPlayer.y = 0;
                if (directionToPlayer.lengthSq() > 0.01) {
                    directionToPlayer.normalize();
                    boss.position.add(directionToPlayer.multiplyScalar(bossMoveSpeed * deltaTime));
                }
                const lookAtPosition = player.position.clone();
                lookAtPosition.y = boss.position.y;
                boss.lookAt(lookAtPosition);
                if (timeSinceLastLaunch >= playerLaunchCooldown && !isImmuneDuringSlamDescent && !isImmuneAfterSlamLand) {
                    boss.updateMatrixWorld();
                    bossBoundingBox.setFromObject(boss);
                    playerBoundingSphere.center.copy(player.position).add(new THREE.Vector3(0, playerCollisionOffsetY, 0));
                    playerBoundingSphere.radius = playerCollisionRadius;
                    if (bossBoundingBox.intersectsSphere(playerBoundingSphere)) {
                        console.log("Player launched by boss contact!");
                        velocityY = playerLaunchVelocityY;
                        isJumping = true;
                        timeSinceLastLaunch = 0;
                        isAerialSlamming = false;
                        isImmuneDuringSlamDescent = false;
                    }
                }
            }
            if (player) {
                timeSinceLastMissile += deltaTime;
                if (timeSinceLastMissile >= missileFireIntervalP2 && playerCurrentHealth > 0) {
                    spawnMissile();
                    timeSinceLastMissile = 0;
                }
            }
        } else {
            boss.rotation.x += 0.005 * deltaTime * 60;
            boss.rotation.y += 0.005 * deltaTime * 60;
            boss.rotation.z += 0.005 * deltaTime * 60;
            if (player) {
                timeSinceLastMissile += deltaTime;
                if (timeSinceLastMissile >= missileFireIntervalP1 && playerCurrentHealth > 0) {
                    spawnMissile();
                    timeSinceLastMissile = 0;
                }
            }
        }
    } else if (boss && isBossDefeated) {
        /* Defeated state */ }

    // Boss Defeat Glow 
    if (boss && bossCurrentHealth <= 0 && !isBossDefeated) {
        isBossDefeated = true;
        console.log("Boss has been defeated! Applying defeat glow.");
        alert("u did it sigma! u defeated the boss! have a good birthday fr!!!!!!!!!!!!!!!!!!")
        if (boss.material && boss.material.isMeshStandardMaterial) {
            boss.material.emissive.setHex(0xffffff);
            boss.material.emissiveIntensity = bossDefeatGlowIntensity;
            boss.material.needsUpdate = true;
        }
        boss.layers.enable(BLOOM_SCENE);
        document.getElementById('boss-text-container').style.display = 'none';
        document.getElementById('boss-container').style.display = 'none';
    }

    // Missile Update Logic
    for (let i = activeMissiles.length - 1; i >= 0; i--) {
        const m = activeMissiles[i];
        const mD = m.userData;
        if (mD.target) {
            if (!scene.children.includes(mD.target)) {
                scene.remove(m);
                if (m.material) m.material.dispose();
                activeMissiles.splice(i, 1);
                continue;
            }
            const dir = new THREE.Vector3();
            const playerTargetPos = mD.target.position.clone().add(new THREE.Vector3(0, playerCollisionOffsetY, 0));
            dir.subVectors(playerTargetPos, m.position).normalize();
            m.position.add(dir.multiplyScalar(mD.speed * deltaTime));
        } else if (mD.direction) {
            m.position.add(mD.direction.clone().multiplyScalar(mD.speed * deltaTime));
        }
        if (player && playerCurrentHealth > 0) {
            const playerHitSphereCenter = player.position.clone().add(new THREE.Vector3(0, playerCollisionOffsetY, 0));
            const distanceToPlayer = m.position.distanceTo(playerHitSphereCenter);
            const missileCollisionRadius = m.geometry.parameters.radius || 0.3;
            if (distanceToPlayer < (playerCollisionRadius + missileCollisionRadius)) {
                playerCurrentHealth -= mD.damage;
                if (playerCurrentHealth < 0) playerCurrentHealth = 0;
                updateHealthBarUI();
                if (playerCurrentHealth <= 0) console.log("Player has been defeated!");
                if (isBossPhase2 && timeSinceLastLaunch >= playerLaunchCooldown && !isImmuneDuringSlamDescent && !isImmuneAfterSlamLand) {
                    console.log("Player launched by missile!");
                    velocityY = playerLaunchVelocityY;
                    isJumping = true;
                    timeSinceLastLaunch = 0;
                    isAerialSlamming = false;
                    isImmuneDuringSlamDescent = false;
                }
                scene.remove(m);
                if (m.material) m.material.dispose();
                activeMissiles.splice(i, 1);
                continue;
            }
        }
        if (clock.getElapsedTime() - mD.creationTime > missileLifetime) {
            scene.remove(m);
            if (m.material) m.material.dispose();
            activeMissiles.splice(i, 1);
        }
    }


    // Player & Camera Updates
    if (!player) {
        /* Allow rendering */ } else {
        let mov = new THREE.Vector3();
        const canInputMovement = playerCurrentHealth > 0 && !isBurstActivating && !isAerialSlamming; // Can player input W,A,S,D,Space

        if (canInputMovement && !isPlayerAttacking) {
            cameraDistance += (targetCameraDistance - cameraDistance) * zoomSpeed;
            const camDir = getCameraDirection();
            const camRight = new THREE.Vector3(camDir.z, 0, -camDir.x);
            let mX = 0,
                mZ = 0;
            moveSpeed = keys.shift ? 0.2 : 0.1;
            if (keys.w) mZ += moveSpeed;
            if (keys.s) mZ -= moveSpeed;
            if (keys.a) mX += moveSpeed;
            if (keys.d) mX -= moveSpeed;
            const mF = camDir.clone().multiplyScalar(mZ);
            const mS = camRight.clone().multiplyScalar(mX);
            mov.add(mF).add(mS);

            if (keys.space && !isJumping && player.position.y <= groundLevel + 0.01) { // Added small tolerance for ground check
                velocityY = jumpSpeed;
                isJumping = true;
                maxHeightReachedDuringFall = player.position.y; // Set peak at start of jump
            }
        }

        // Apply horizontal movement based on input
        if (mov.lengthSq() > 0) {
            player.position.add(mov);
            let tR = Math.atan2(mov.x, mov.z);
            player.rotation.y = shortestRotation(player.rotation.y, tR);
        }

        // --- Vertical Physics, Fall Off & Landing Logic ---
        const halfGroundSize = groundSize / 2;
        const isPlayerOffPlatformXZ = player.position.x > halfGroundSize || player.position.x < -halfGroundSize ||
            player.position.z > halfGroundSize || player.position.z < -halfGroundSize;

        // Teleport if too far down
        if (player.position.y < fallTeleportThresholdY) {
            console.log("Player fell below Y threshold! Teleporting.");
            player.position.copy(playerSpawnPoint);
            velocityY = 0;
            isJumping = false;
            isAerialSlamming = false;
            isImmuneDuringSlamDescent = false;
            isImmuneAfterSlamLand = false;
            maxHeightReachedDuringFall = playerSpawnPoint.y;
        } else {
            // Apply vertical physics (slam or gravity)
            if (isAerialSlamming) {
                velocityY = -aerialSlamSpeed;
                if (timeSinceLastTrailSegment >= slamTrailSpawnInterval) {
                    spawnSlamTrailSegment();
                    timeSinceLastTrailSegment = 0;
                }
            } else {
                velocityY -= gravity;
            }
            player.position.y += velocityY;

            // Determine if player is truly on solid ground or should be falling
            let isOnSolidGround = (player.position.y <= groundLevel) && !isPlayerOffPlatformXZ;

            if (isOnSolidGround) {
                player.position.y = groundLevel;
                const wasSlammingWhenLanded = isAerialSlamming;
                const wasAirbornePreviously = isJumping; // Capture if they *were* considered airborne

                if (isAerialSlamming) {
                    console.log("Aerial Slam landed on solid ground!");
                    isAerialSlamming = false;
                    isImmuneDuringSlamDescent = false;
                    isImmuneAfterSlamLand = true;
                    slamLandImmunityTimer = 0;
                    lastTrailPoint = null;
                    spawnSlamExplosion(player.position.clone());
                }

                if (wasAirbornePreviously && !wasSlammingWhenLanded) {
                    const fallDistance = maxHeightReachedDuringFall - groundLevel;
                    if (fallDistance > minFallDamageHeight) {
                        const damageTaken = Math.round((fallDistance - minFallDamageHeight) * fallDamageMultiplier);
                        if (damageTaken > 0 && playerCurrentHealth > 0) {
                            playerCurrentHealth -= damageTaken;
                            if (playerCurrentHealth < 0) playerCurrentHealth = 0;
                            updateHealthBarUI();
                            console.log(`Player took ${damageTaken} fall damage.`);
                            if (playerCurrentHealth <= 0) console.log("Player has been defeated by fall damage!");
                        }
                    }
                }
                velocityY = 0;
                isJumping = false;
                maxHeightReachedDuringFall = groundLevel;
            } else { // Player is airborne (either jumped, launched, or walked off XZ)
                if (!isJumping && isPlayerOffPlatformXZ && player.position.y <= groundLevel + 0.1) {
                    // This handles the case where player walks off an edge that was at groundLevel.
                    // They should now start falling, so ensure isJumping is true.
                    isJumping = true;
                    maxHeightReachedDuringFall = player.position.y; // Start tracking fall from this edge.
                    console.log("Player walked off edge, now falling.");
                }

                if (isJumping || player.position.y > groundLevel) { // General airborne peak tracking
                    if (velocityY >= -gravity && !isAerialSlamming) {
                        maxHeightReachedDuringFall = Math.max(maxHeightReachedDuringFall, player.position.y);
                    }
                }
            }
        }
        // --- End Vertical Physics & Fall Off ---

        // Camera follows player
        let oX = Math.sin(cameraAngleH) * Math.cos(cameraAngleV) * cameraDistance;
        let oY = Math.sin(cameraAngleV) * cameraDistance;
        let oZ = Math.cos(cameraAngleH) * Math.cos(cameraAngleV) * cameraDistance;
        let hO = 2.2;
        camera.position.set(player.position.x + oX, player.position.y + hO + oY, player.position.z + oZ);
        camera.lookAt(player.position.x, player.position.y + hO, player.position.z);
    }

    // Rendering
    renderer.setRenderTarget(bloomComposer.renderTarget1);
    renderer.clear();
    camera.layers.set(ENTIRE_SCENE);
    renderer.render(scene, camera);
    camera.layers.set(BLOOM_SCENE);
    bloomComposer.render();
    camera.layers.set(ENTIRE_SCENE);
    finalComposer.render();
}
// --- End Game Loop ---

// --- Resize Handler ---
window.addEventListener("resize", () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio);
    bloomComposer.setSize(w, h);
    finalComposer.setSize(w, h);
    bloomPass.setSize(w, h);
    outlinePass.setSize(w, h);
    const pR = renderer.getPixelRatio();
    fxaaPass.material.uniforms['resolution'].value.x = 1 / (w * pR);
    fxaaPass.material.uniforms['resolution'].value.y = 1 / (h * pR);
});
// --- End Resize Handler ---

// --- Initial Setup ---
//   animate();
// --- End Initial Setup ---

const intro = document.getElementById("intro");
const content = document.getElementById("content");
const cover = document.getElementById("cover");
const introVid = document.getElementById("introVid");
let nextIntro = false;

cover.addEventListener("click", () => {
    document.body.requestFullscreen()
    introVid.play();
});

introVid.addEventListener("ended", () => {
    introVid.src = "textures/GenshinIntroContinued.mp4";
    introVid.volume = 0.6;

    if (nextIntro) {
        animate();
        intro.remove();
        content.style.display = "block";
    }

    nextIntro = true;
});