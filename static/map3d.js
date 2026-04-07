import * as THREE from './three.module.js';
import { OrbitControls } from './OrbitControls.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141f);

const camera = new THREE.PerspectiveCamera(
    60,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, 0);
controls.update();

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
keyLight.position.set(5, 10, 7);
scene.add(keyLight);

const grid = new THREE.GridHelper(20, 20, 0x3a4a74, 0x22314d);
scene.add(grid);

const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({
        color: 0x151c2d,
        roughness: 0.95,
        metalness: 0.05,
    })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.001;
scene.add(floor);

const testMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x5cb8ff })
);
testMesh.position.y = 0.5;
scene.add(testMesh);

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

function animate(timeMs) {
    const t = Number(timeMs) * 0.001;
    testMesh.rotation.y = t * 0.8;
    testMesh.rotation.x = Math.sin(t * 0.7) * 0.2;

    controls.update();
    renderer.render(scene, camera);
}

renderer.setAnimationLoop(animate);

window.__MAP3D_BOOTSTRAP__ = {
    scene,
    camera,
    renderer,
    controls,
};
