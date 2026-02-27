import * as THREE from './three.module.js';

const scene = new THREE.Scene();

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
const d20Material = new THREE.MeshStandardMaterial({
    color: 0x7a3cff
});

const d20 = new THREE.Mesh(d20Geometry, d20Material);
scene.add(d20);

// ---- FIXED FACE EXTRACTION ----
const positionAttr = d20Geometry.attributes.position;

let outwardOffset = 0.35;

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
    ctx.fillStyle = 'yellow';
    ctx.strokeStyle = 'black';
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
const table = new THREE.Mesh(
    new THREE.CylinderGeometry(2.5, 2.5, 0.3, 32),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b })
);
table.position.y = -1.5;
scene.add(table);

// Animate
function animate() {
    requestAnimationFrame(animate);
    d20.rotation.x += 0.02;
    d20.rotation.y += 0.02;
    renderer.render(scene, camera);
}

animate();