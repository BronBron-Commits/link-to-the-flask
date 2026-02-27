
import * as THREE from './three.module.js';

const scene = new THREE.Scene();


// Procedural nighttime skybox (darker, animated stars)
const skyCanvas = document.createElement('canvas');
skyCanvas.width = 2048;
skyCanvas.height = 2048;
const skyCtx = skyCanvas.getContext('2d');

// Store star data for animation
const starCount = 900;
const stars = [];
for (let i = 0; i < starCount; i++) {
    stars.push({
        x: Math.random() * skyCanvas.width,
        y: Math.random() * skyCanvas.height,
        r: 0.3 + Math.random() * 0.7,
        twinkle: 0.5 + Math.random() * 0.5,
        speed: 0.002 + Math.random() * 0.004,
        phase: Math.random() * Math.PI * 2
    });
}

function drawSky() {
    // Fill pure black
    skyCtx.fillStyle = '#000000';
    skyCtx.fillRect(0, 0, skyCanvas.width, skyCanvas.height);

    // Draw animated stars
    for (let i = 0; i < starCount; i++) {
        const star = stars[i];
        // Animate twinkle
        star.phase += star.speed;
        const twinkle = star.twinkle * (0.7 + 0.3 * Math.sin(star.phase));
        skyCtx.beginPath();
        skyCtx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        skyCtx.fillStyle = 'rgba(255,255,255,' + twinkle + ')';
        skyCtx.shadowColor = '#fff';
        skyCtx.shadowBlur = 6;
        skyCtx.fill();
        skyCtx.shadowBlur = 0;
    }

    // Moon
    const moonX = 820;
    const moonY = 220;
    skyCtx.beginPath();
    skyCtx.arc(moonX, moonY, 60, 0, Math.PI * 2);
    skyCtx.fillStyle = 'rgba(240,240,255,0.85)';
    skyCtx.shadowColor = '#fff';
    skyCtx.shadowBlur = 30;
    skyCtx.fill();
    skyCtx.shadowBlur = 0;
}

const skyTexture = new THREE.CanvasTexture(skyCanvas);
skyTexture.mapping = THREE.EquirectangularReflectionMapping;
skyTexture.magFilter = THREE.LinearFilter;
skyTexture.minFilter = THREE.LinearMipMapLinearFilter;

const skyGeo = new THREE.SphereGeometry(50, 64, 64);
const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture, side: THREE.BackSide });
const skySphere = new THREE.Mesh(skyGeo, skyMat);
scene.add(skySphere);

drawSky();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Fullscreen
renderer.domElement.style.position = 'fixed';
renderer.domElement.style.top = '0';
renderer.domElement.style.left = '0';
renderer.domElement.style.width = '100vw';
renderer.domElement.style.height = '100vh';
renderer.domElement.style.zIndex = '999';

function resize3D() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize3D);
resize3D();

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

const ambient = new THREE.AmbientLight(0xffffff, 0.4);
scene.add(ambient);

// D20
const radius = 1.2;
const d20Geometry = new THREE.IcosahedronGeometry(radius, 0);

// Create procedural royal blue + gold veins texture
const d20Canvas = document.createElement('canvas');
d20Canvas.width = 512;
d20Canvas.height = 512;
const d20Ctx = d20Canvas.getContext('2d');

// Fill royal blue
d20Ctx.fillStyle = '#1a237e'; // Royal blue
d20Ctx.fillRect(0, 0, d20Canvas.width, d20Canvas.height);

// Gold noise veins
for (let i = 0; i < 1200; i++) {
    const x = Math.random() * d20Canvas.width;
    const y = Math.random() * d20Canvas.height;
    const angle = Math.random() * Math.PI * 2;
    const length = 40 + Math.random() * 60;
    d20Ctx.save();
    d20Ctx.translate(x, y);
    d20Ctx.rotate(angle);
    d20Ctx.beginPath();
    d20Ctx.moveTo(0, 0);
    d20Ctx.lineTo(length, 0);
    d20Ctx.lineWidth = 2 + Math.random() * 2;
    // Blend gold with blue for veins
    const blueGold = 'rgba(60, 90, 200, 0.7)'; // deep blue
    const gold = 'rgba(180, 160, 80, 0.35)'; // muted gold
    d20Ctx.strokeStyle = Math.random() < 0.7 ? blueGold : gold;
    d20Ctx.shadowColor = 'rgba(60, 90, 200, 0.3)';
    d20Ctx.shadowBlur = 4;
    d20Ctx.stroke();
    d20Ctx.restore();
}

const d20Texture = new THREE.CanvasTexture(d20Canvas);
const d20Material = new THREE.MeshStandardMaterial({
    map: d20Texture,
    color: 0xffffff,
    metalness: 0.5,
    roughness: 0.3
});

const d20 = new THREE.Mesh(d20Geometry, d20Material);
scene.add(d20);

// ---- FIXED FACE EXTRACTION ----
const positionAttr = d20Geometry.attributes.position;

let outwardOffset = 0.05; // Distance to move numbers outside faces

for (let i = 0; i < positionAttr.count; i += 3) {

    // Each triangle = 3 vertices
    const vA = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
    const vB = new THREE.Vector3().fromBufferAttribute(positionAttr, i + 1);
    const vC = new THREE.Vector3().fromBufferAttribute(positionAttr, i + 2);

    // Face center
    const center = new THREE.Vector3()
        .add(vA)
        .add(vB)
        .add(vC)
        .divideScalar(3);

    // Correct outward normal
    const normal = new THREE.Vector3()
        .crossVectors(
            vB.clone().sub(vA),
            vC.clone().sub(vA)
        )
        .normalize();

    // Ensure normal points outward
    if (normal.dot(center) < 0) {
        normal.negate();
    }

    // Create number texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe066'; // lighter gold
    ctx.strokeStyle = '#fff9c4'; // pale gold outline
    ctx.lineWidth = 16;
    ctx.font = 'bold 180px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeText((i / 3 + 1).toString(), 128, 128);
    ctx.fillText((i / 3 + 1).toString(), 128, 128);

    const texture = new THREE.CanvasTexture(canvas);

    const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.5),
        new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        })
    );

    // Position slightly outside face
    plane.position.copy(
        center.clone().add(
            normal.clone().multiplyScalar(outwardOffset)
        )
    );

    // Face outward
    plane.lookAt(
        plane.position.clone().add(normal)
    );

    d20.add(plane);
}

camera.position.z = 5;

// Table
// Procedural wood texture for table
const tableCanvas = document.createElement('canvas');
tableCanvas.width = 512;
tableCanvas.height = 512;
const tableCtx = tableCanvas.getContext('2d');

// Fill base wood color (more orange)
tableCtx.fillStyle = '#3b2312'; // dark oak base
tableCtx.fillRect(0, 0, tableCanvas.width, tableCanvas.height);

// Draw wood grain lines (warmer orange-brown)
for (let i = 0; i < 180; i++) {
    const y = Math.random() * tableCanvas.height;
    const amplitude = 14 + Math.random() * 24;
    const frequency = 0.025 + Math.random() * 0.035;
    tableCtx.beginPath();
    for (let x = 0; x < tableCanvas.width; x++) {
        const offset = Math.sin(x * frequency + y / 40) * amplitude;
        tableCtx.lineTo(x, y + offset);
    }
    tableCtx.lineWidth = 2.2 + Math.random() * 1.2;
    tableCtx.strokeStyle = 'rgba(90, 60, 30, 0.55)'; // dark oak grain
    tableCtx.shadowColor = 'rgba(40, 20, 10, 0.18)';
    tableCtx.shadowBlur = 6;
    tableCtx.stroke();
}

// Add random scratches
for (let i = 0; i < 60; i++) {
    const x = Math.random() * tableCanvas.width;
    const y = Math.random() * tableCanvas.height;
    const angle = Math.random() * Math.PI * 2;
    const length = 40 + Math.random() * 60;
    tableCtx.save();
    tableCtx.translate(x, y);
    tableCtx.rotate(angle);
    tableCtx.beginPath();
    tableCtx.moveTo(0, 0);
    tableCtx.lineTo(length, 0);
    tableCtx.lineWidth = 1.2 + Math.random() * 0.8;
    tableCtx.strokeStyle = 'rgba(255, 255, 255, 0.18)'; // subtle white scratch
    tableCtx.shadowColor = 'rgba(255, 255, 255, 0.08)';
    tableCtx.shadowBlur = 2;
    tableCtx.stroke();
    tableCtx.restore();
}

const tableTexture = new THREE.CanvasTexture(tableCanvas);
// Make table surface bigger and add beveled edge
const tableRadius = 4.0;
const tableHeight = 0.3;
const table = new THREE.Mesh(
    new THREE.CylinderGeometry(tableRadius, tableRadius, tableHeight, 64),
    new THREE.MeshStandardMaterial({
        map: tableTexture,
        color: 0xffffff,
        roughness: 0.85,
        metalness: 0.18,
        normalScale: new THREE.Vector2(1.2, 1.2)
    })
);
table.position.y = -1.5;
scene.add(table);

// Add beveled edge using torus
const bevelGeometry = new THREE.TorusGeometry(tableRadius + 0.08, 0.12, 32, 128);
const bevelMaterial = new THREE.MeshStandardMaterial({
    map: tableTexture,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.18
});
const bevel = new THREE.Mesh(bevelGeometry, bevelMaterial);
bevel.position.y = -1.35 + tableHeight / 2;
bevel.rotation.x = Math.PI / 2;
scene.add(bevel);

// Animate
function animate() {
    requestAnimationFrame(animate);
    d20.rotation.x += 0.02;
    d20.rotation.y += 0.02;
    // Animate skybox stars
    drawSky();
    skyTexture.needsUpdate = true;
    renderer.render(scene, camera);
}

animate();