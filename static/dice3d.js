import * as THREE from './three.module.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Make 3D environment full screen
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

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

// Dice cube
// D20 dice (icosahedron)
const d20Geometry = new THREE.IcosahedronGeometry(1.2, 0);
const d20Material = new THREE.MeshStandardMaterial({ color: 0x7a3cff }); // purple
const d20 = new THREE.Mesh(d20Geometry, d20Material);
scene.add(d20);

camera.position.z = 5;

// Wooden tabletop (cylinder)
const tableRadius = 2.5;
const tableHeight = 0.3;
const tableGeometry = new THREE.CylinderGeometry(tableRadius, tableRadius, tableHeight, 32);
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5a2b }); // warm brown
const table = new THREE.Mesh(tableGeometry, tableMaterial);
table.position.y = -1.5;
scene.add(table);

function animate() {
    requestAnimationFrame(animate);
    d20.rotation.x += 0.02;
    d20.rotation.y += 0.02;
    renderer.render(scene, camera);
}

animate();
