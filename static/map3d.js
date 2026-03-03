import * as THREE from './three.module.js';

// Scene
const scene = new THREE.Scene();

// Camera
const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(0, 10, 20);
camera.lookAt(0, 0, 0);

// Renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Resize support
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Textures
const loader = new THREE.TextureLoader();
const mapTexture = loader.load('/static/map.png');
const displacementMap = loader.load('/static/map_displacement.png');

// Terrain
const geometry = new THREE.PlaneGeometry(20, 20, 128, 128);
const material = new THREE.MeshStandardMaterial({
    map: mapTexture,
    displacementMap: displacementMap,
    displacementScale: 2.5
});
const terrain = new THREE.Mesh(geometry, material);
terrain.rotation.x = -Math.PI / 2;
scene.add(terrain);

// Lighting
const light = new THREE.DirectionalLight(0xffffff, 1.1);
light.position.set(10, 20, 10);
scene.add(light);
scene.add(new THREE.AmbientLight(0xffffff, 0.5));

// Mouse height adjustment
let isMouseDown = false;
let lastY = 0;

renderer.domElement.addEventListener('mousedown', (e) => {
    isMouseDown = true;
    lastY = e.clientY;
});

renderer.domElement.addEventListener('mouseup', () => {
    isMouseDown = false;
});

renderer.domElement.addEventListener('mousemove', (e) => {
    if (!isMouseDown) return;
    const dy = e.clientY - lastY;
    material.displacementScale = Math.max(
        0,
        Math.min(10, material.displacementScale - dy * 0.01)
    );
    lastY = e.clientY;
});

// Render loop
function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}
animate();