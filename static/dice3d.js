import * as THREE from './three.module.js';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth/window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true });

renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Light
const light = new THREE.DirectionalLight(0xffffff, 1);
light.position.set(5, 10, 5);
scene.add(light);

// Dice cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshStandardMaterial({ color: 0xffffff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

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
    cube.rotation.x += 0.02;
    cube.rotation.y += 0.02;
    renderer.render(scene, camera);
}

animate();
