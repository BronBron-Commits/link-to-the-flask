// Camera vertical movement controls
let moveUp = false, moveDown = false;
let orbitLeft = false, orbitRight = false;
document.addEventListener('keydown', (e) => {
    if (e.code === 'KeyW') moveUp = true;
    if (e.code === 'KeyS') moveDown = true;
    if (e.code === 'KeyA') orbitLeft = true;
    if (e.code === 'KeyD') orbitRight = true;
});
document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW') moveUp = false;
    if (e.code === 'KeyS') moveDown = false;
    if (e.code === 'KeyA') orbitLeft = false;
    if (e.code === 'KeyD') orbitRight = false;
});
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
// Camera orbit state
let orbitAngle = 0;
const orbitRadius = 6;
let orbitHeight = 4.5;
camera.position.set(0, orbitHeight, orbitRadius);
camera.lookAt(0, -1.5, 0); // Look at table center

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// WASD and mouse look controls
let yaw = 0, pitch = 0;
let mouseDown = false;
let prevMouseX = 0, prevMouseY = 0;

renderer.domElement.addEventListener('mousedown', (e) => {
    mouseDown = true;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
});
renderer.domElement.addEventListener('mouseup', () => { mouseDown = false; });
renderer.domElement.addEventListener('mouseleave', () => { mouseDown = false; });
renderer.domElement.addEventListener('mousemove', (e) => {
    if (!mouseDown) return;
    const dx = e.clientX - prevMouseX;
    const dy = e.clientY - prevMouseY;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
    yaw -= dx * 0.002;
    pitch -= dy * 0.002;
    pitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, pitch));
});

// Mouse wheel zoom
renderer.domElement.addEventListener('wheel', (e) => {
    // Zoom in/out by changing camera FOV (frame zoom)
    const fovSpeed = 2;
    camera.fov += e.deltaY > 0 ? fovSpeed : -fovSpeed;
    // Clamp FOV
    camera.fov = Math.max(30, Math.min(90, camera.fov));
    camera.updateProjectionMatrix();
});

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
const radius = 0.6;
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

// Add second die
const d20b = new THREE.Mesh(d20Geometry.clone(), d20Material.clone());
d20b.position.set(1.2, 0, 0); // Offset second die to the right
scene.add(d20b);

// Dice roll animation state
let rolling = false;
let falling = false;
let rollStart = 0;
let rollDuration = 1200; // ms
let rollTarget = { x: 0, y: 0 };
let gravity = -0.025;
let dieVelocity = new THREE.Vector3(0, 0, 0);
let dieAngularVelocity = new THREE.Vector2(0, 0);
const dieInitialY = 1.5;

// Second die animation state
let rollingB = false;
let fallingB = false;
let dieVelocityB = new THREE.Vector3(0, 0, 0);
let dieAngularVelocityB = new THREE.Vector2(0, 0);

// Roll dice on click
renderer.domElement.addEventListener('click', (e) => {
    // Raycast to check if either die was clicked
    const mouse = new THREE.Vector2(
        (e.clientX / renderer.domElement.clientWidth) * 2 - 1,
        -(e.clientY / renderer.domElement.clientHeight) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects([d20, d20b], true);
    if (intersects.length > 0) {
        // Which die?
        const obj = intersects[0].object;
        if ((obj === d20 || d20.children.includes(obj)) && !falling && !rolling) {
            falling = true;
            d20.position.y = dieInitialY;
            dieVelocity.set(0, 0, 0);
            dieVelocity.x = (Math.random() - 0.5) * 0.08;
            dieVelocity.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocity.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocity.y = 0.2 + Math.random() * 0.5;
        } else if ((obj === d20b || d20b.children.includes(obj)) && !fallingB && !rollingB) {
            fallingB = true;
            d20b.position.y = dieInitialY;
            dieVelocityB.set(0, 0, 0);
            dieVelocityB.x = (Math.random() - 0.5) * 0.08;
            dieVelocityB.z = (Math.random() - 0.5) * 0.08;
            dieAngularVelocityB.x = 0.2 + Math.random() * 0.5;
            dieAngularVelocityB.y = 0.2 + Math.random() * 0.5;
        }
    }
});

// ---- FIXED FACE EXTRACTION ----
const positionAttr = d20Geometry.attributes.position;
let outwardOffset = 0.05; // Distance to move numbers outside faces

// Store face centers and normals for both dice
const d20Faces = [];
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
    d20Faces.push({ center, normal });
    // Create number texture
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffe066'; // lighter gold
    ctx.strokeStyle = '#fff9c4'; // pale gold outline
    ctx.lineWidth = 8; // half original line width
    ctx.font = 'bold 90px Arial'; // half original font size
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
    // Add numbers to second die
    const planeB = plane.clone();
    d20b.add(planeB);
}

// Highlight top face for both dice
function highlightTopFace(die, faces) {
    let maxDot = -Infinity;
    let topIdx = -1;
    for (let i = 0; i < faces.length; i++) {
        // World normal
        const worldNormal = faces[i].normal.clone().applyQuaternion(die.quaternion);
        // Up vector
        const dot = worldNormal.dot(new THREE.Vector3(0, 1, 0));
        if (dot > maxDot) {
            maxDot = dot;
            topIdx = i;
        }
    }
    // Remove highlighting: all numbers same color and opacity
    for (let i = 0; i < die.children.length; i++) {
        die.children[i].material.color.set('#ffffff');
        die.children[i].material.opacity = 0.85;
    }
    return topIdx + 1; // Face number
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
// Lower the bevel to sit flush with table surface
bevel.position.y = -1.5 + tableHeight / 2 + 0.01; // matches table.position.y, slight offset for flush
bevel.rotation.x = Math.PI / 2;
scene.add(bevel);

// Fireplace (simple box with glowing fire)
// Fireplace removed

// Bookshelves (tall boxes)
// Bookshelves removed

// Add a lit candle to the table
const candleHeight = 0.35;
const candleRadius = 0.08;
const candleGeometry = new THREE.CylinderGeometry(candleRadius, candleRadius, candleHeight, 32);
const candleMaterial = new THREE.MeshStandardMaterial({ color: 0xf5e6c2, roughness: 0.6 });
const candle = new THREE.Mesh(candleGeometry, candleMaterial);
const candleX = -tableRadius * 0.65; // Move to left side
candle.position.set(candleX, -1.5 + tableHeight / 2 + candleHeight / 2, 0.7);
scene.add(candle);

// Candle flame (small sphere)
const flameGeometry = new THREE.SphereGeometry(0.04, 16, 16);
const flameMaterial = new THREE.MeshBasicMaterial({ color: 0xffd700, emissive: 0xffa500 });
const flame = new THREE.Mesh(flameGeometry, flameMaterial);
flame.position.set(candleX, candle.position.y + candleHeight / 2 + 0.04, 0.7);
scene.add(flame);

// Candle light
const candleLight = new THREE.PointLight(0xffd700, 1.2, 2.5);
candleLight.position.copy(flame.position);
scene.add(candleLight);

// Add Leave Table button
const leaveBtn = document.createElement('button');
leaveBtn.textContent = 'Leave Table';
leaveBtn.style.position = 'fixed';
leaveBtn.style.top = '16px';
leaveBtn.style.left = '16px';
leaveBtn.style.zIndex = '1001';
leaveBtn.style.padding = '10px 22px';
leaveBtn.style.fontSize = '1.1em';
leaveBtn.style.background = '#222';
leaveBtn.style.color = '#fff';
leaveBtn.style.border = '2px solid #fff';
leaveBtn.style.borderRadius = '8px';
leaveBtn.style.cursor = 'pointer';
leaveBtn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
leaveBtn.style.opacity = '0.92';
leaveBtn.addEventListener('mouseenter', () => leaveBtn.style.opacity = '1');
leaveBtn.addEventListener('mouseleave', () => leaveBtn.style.opacity = '0.92');
leaveBtn.addEventListener('click', () => {
    window.location.href = '/'; // Redirect to main scene (index.html)
});
document.body.appendChild(leaveBtn);

// Display winning numbers at the top of the screen
const resultDiv = document.createElement('div');
resultDiv.style.position = 'fixed';
resultDiv.style.top = '16px';
resultDiv.style.left = '50%';
resultDiv.style.transform = 'translateX(-50%)';
resultDiv.style.zIndex = '1002';
resultDiv.style.fontSize = '2.2em';
resultDiv.style.fontWeight = 'bold';
resultDiv.style.color = '#ffe066';
resultDiv.style.textShadow = '0 2px 8px #222, 0 0 8px #fff9c4';
resultDiv.style.pointerEvents = 'none';
document.body.appendChild(resultDiv);

// Animate
function animate() {
    // Camera vertical movement with W/S
    if (moveUp) orbitHeight += 0.12;
    if (moveDown) orbitHeight -= 0.12;
    orbitHeight = Math.max(2.5, Math.min(8, orbitHeight));

    // Camera orbit with A/D
    if (orbitLeft) orbitAngle -= 0.04;
    if (orbitRight) orbitAngle += 0.04;

    // Update camera position to orbit around table center
    camera.position.x = Math.sin(orbitAngle) * orbitRadius;
    camera.position.z = Math.cos(orbitAngle) * orbitRadius;
    camera.position.y = orbitHeight;
    camera.lookAt(0, -1.5, 0);
    requestAnimationFrame(animate);
    // Gravity/falling animation for both dice
    if (falling) {
        dieVelocity.y += gravity;
        d20.position.add(dieVelocity);
        d20.rotation.x += dieAngularVelocity.x;
        d20.rotation.y += dieAngularVelocity.y;
        const tableTopY = table.position.y + tableHeight / 2 + radius;
        if (d20.position.y <= tableTopY) {
            d20.position.y = tableTopY;
            falling = false;
            dieVelocity.set(0, 0, 0);
            dieAngularVelocity.set(0, 0);
        }
    }
    if (fallingB) {
        dieVelocityB.y += gravity;
        d20b.position.add(dieVelocityB);
        d20b.rotation.x += dieAngularVelocityB.x;
        d20b.rotation.y += dieAngularVelocityB.y;
        const tableTopY = table.position.y + tableHeight / 2 + radius;
        if (d20b.position.y <= tableTopY) {
            d20b.position.y = tableTopY;
            fallingB = false;
            dieVelocityB.set(0, 0, 0);
            dieAngularVelocityB.set(0, 0);
        }
    }
    // Highlight top face for both dice and get numbers
    const numA = highlightTopFace(d20, d20Faces);
    const numB = highlightTopFace(d20b, d20Faces);
    // Display result at top of screen
    resultDiv.textContent = `Die 1: ${numA}   Die 2: ${numB}`;
    // No idle spin
    // ...existing code...
    // Animate skybox stars
    drawSky();
    skyTexture.needsUpdate = true;
    // Flicker candle flame and light
    const flicker = 0.98 + Math.sin(Date.now() * 0.008) * 0.04 + Math.random() * 0.02;
    candleLight.intensity = 1.2 * flicker;
    flame.scale.set(flicker, flicker * 1.15, flicker);

    // Mouse look only (disabled for orbit)
    // camera.rotation.order = 'YXZ';
    // camera.rotation.y = yaw;
    // camera.rotation.x = pitch;
    // Keep camera above and angled down
    // camera.position.y = Math.max(camera.position.y, 2.5);

    renderer.render(scene, camera);
}

animate();