// BVH Collision System using three-mesh-bvh
// Provides triangle-accurate collision detection for static world geometry

import * as THREE from '/static/three.module.js';

let MeshBVH = null;
let acceleratedRaycast = null;

/**
 * Initialize BVH collision system - must be called before using BVH collisions
 * Loads three-mesh-bvh from CDN
 */
export async function initializeBVH() {
    try {
        // Import from CDN ES module
        const bvhModule = await import('https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.7.6/+esm');
        MeshBVH = bvhModule.MeshBVH;
        acceleratedRaycast = bvhModule.acceleratedRaycast;
        
        // Do NOT override globally - will break skybox
        // Apply selectively per-scene after building collider
        
        console.log('✅ BVH Collision System initialized');
        return true;
    } catch (error) {
        console.error('❌ Failed to load three-mesh-bvh:', error);
        return false;
    }
}

/**
 * Apply accelerated raycast to a specific mesh (not globally)
 * This prevents breaking GroundedSkybox which relies on default raycast
 * @param {THREE.Mesh} mesh - The mesh to apply accelerated raycast to
 */
export function applyAcceleratedRaycast(mesh) {
    if (acceleratedRaycast && mesh && mesh.isMesh) {
        mesh.raycast = acceleratedRaycast;
    }
}

/**
 * Helper function to merge geometries (replaces external import)
 * Combines multiple BufferGeometries into a single merged geometry
 */
function mergeGeometries(geometries, useGroups = false) {
    const isIndexed = geometries.length > 0 && geometries[0].index !== null;
    const attributeNames = new Set();
    
    geometries.forEach(geometry => {
        Object.keys(geometry.attributes).forEach(name => {
            attributeNames.add(name);
        });
    });
    
    const merged = new THREE.BufferGeometry();
    let vertexOffset = 0;
    const vertexOffsets = [];
    
    // Combine all attributes
    const attributeArrays = {};
    attributeNames.forEach(name => {
        attributeArrays[name] = [];
    });
    
    let indexArray = [];
    
    geometries.forEach((geometry, i) => {
        vertexOffsets.push(vertexOffset);
        
        // Add vertex attributes
        attributeNames.forEach(name => {
            const attribute = geometry.attributes[name];
            if (attribute) {
                const array = attribute.array;
                const itemSize = attribute.itemSize;
                for (let j = 0; j < array.length; j++) {
                    attributeArrays[name].push(array[j]);
                }
            } else if (i > 0) {
                // Fill with defaults if attribute doesn't exist
                const itemSize = geometries[0].attributes[name]?.itemSize || 3;
                const count = geometry.attributes.position.count;
                for (let j = 0; j < count * itemSize; j++) {
                    attributeArrays[name].push(j % itemSize === 3 ? 1 : 0);
                }
            }
        });
        
        // Add indices
        if (isIndexed) {
            const index = geometry.index.array;
            for (let j = 0; j < index.length; j++) {
                indexArray.push(index[j] + vertexOffset);
            }
        }
        
        vertexOffset += geometry.attributes.position.count;
    });
    
    // Set merged attributes
    attributeNames.forEach(name => {
        const firstGeom = geometries.find(g => g.attributes[name]);
        if (firstGeom) {
            const itemSize = firstGeom.attributes[name].itemSize;
            const array = firstGeom.attributes[name].array.constructor;
            merged.setAttribute(name, new THREE.BufferAttribute(new array(attributeArrays[name]), itemSize));
        }
    });
    
    if (isIndexed) {
        merged.setIndex(new THREE.BufferAttribute(new Uint32Array(indexArray), 1));
    }
    
    return merged;
}

/**
 * Build a single merged collider mesh from all static geometry in a scene
 * ONLY includes structural geometry (walls, floors, terrain)
 * Excludes: decorations, props, chairs, books, cylinders, etc.
 * @param {THREE.Object3D} sceneRoot - The root node to traverse
 * @param {string[]} excludeNames - Array of object name patterns to exclude
 * @returns {THREE.Mesh|null} The merged collider mesh with BVH, or null if no geometry found
 */
export function buildMergedColliderMesh(sceneRoot, excludeNames = []) {
    if (!MeshBVH) {
        console.error('BVH not initialized. Call initializeBVH() first.');
        return null;
    }
    
    const geometries = [];
    const geometryUUIDs = new Set(); // Deduplicate by UUID
    const excludePatterns = excludeNames.map(name => name.toLowerCase());
    
    // Define structural geometry patterns
    const structuralPatterns = [
        'wall', 'floor', 'terrain', 'ground', 'stairs',
        'plane001', 'roadway', 'foundation', 'base'
    ];
    
    // Define blacklisted patterns (MUST NOT be included)
    const blacklistPatterns = [
        'cylinder', 'chair', 'book', 'table', 'shelf', 'barrel',
        'decoration', 'prop', 'asset', 'light', 'sky',
        'camera', 'armature', 'rig', 'particle', 'emitter'
    ];
    
    console.log('🔍 Scanning scene for structural geometry only...');
    let consideredCount = 0;
    let addedCount = 0;
    
    // Traverse and collect ONLY structural geometry
    sceneRoot.traverse((obj) => {
        // Skip non-meshes
        if (!obj.isMesh) return;
        
        consideredCount++;
        
        const nameLower = (obj.name || '').toLowerCase();

        // Never include combat actor meshes (targetables/proxies or their children).
        if (obj.userData?.isTargetable || obj.userData?.selectTarget) return;
        let parent = obj.parent;
        while (parent) {
            if (parent.userData?.isTargetable || parent.userData?.selectTarget) return;
            parent = parent.parent;
        }
        
        // Skip dynamic objects
        if (obj.userData.dynamic) return;
        if (obj.userData.collider === 'ignore') return;
        
        // Skip explicitly excluded objects
        if (excludePatterns.some(pattern => nameLower.includes(pattern))) {
            return;
        }
        
        // AGGRESSIVE: Skip if blacklisted
        if (blacklistPatterns.some(pattern => nameLower.includes(pattern))) {
            return;
        }
        
        // AGGRESSIVE: Only include if matches structural pattern
        const isStructural = structuralPatterns.some(pattern => nameLower.includes(pattern));
        if (!isStructural) {
            // Also check if it's a large flat mesh (likely floor/terrain)
            if (obj.geometry && obj.geometry.attributes.position) {
                const bbox = new THREE.Box3().setFromBufferAttribute(obj.geometry.attributes.position);
                const size = bbox.getSize(new THREE.Vector3());
                // Accept large flat surfaces (terrain/floors are typically large with small height)
                const isLarge = size.x > 10 && size.z > 10;
                const isFlat = size.y < 2; // Height much smaller than width/depth
                if (!isLarge || !isFlat) {
                    return;
                }
            } else {
                return;
            }
        }
        
        // Skip if already added (deduplicate by geometry UUID)
        if (obj.geometry && geometryUUIDs.has(obj.geometry.uuid)) {
            return;
        }
        
        if (obj.geometry) {
            geometryUUIDs.add(obj.geometry.uuid);
        }
        
        try {
            // Clone geometry and apply world transform
            const geo = obj.geometry.clone();
            geo.applyMatrix4(obj.matrixWorld);
            geometries.push(geo);
            addedCount++;
            console.log(`  ✅ ${obj.name} (verts: ${obj.geometry.attributes.position.count})`);
        } catch (err) {
            console.warn(`  ⚠️ ${obj.name}: ${err.message}`);
        }
    });
    
    console.log(`📊 Considered: ${consideredCount} meshes → Added: ${addedCount} structural meshes`);
    
    if (geometries.length === 0) {
        console.warn('❌ No structural geometry found for BVH collider');
        return null;
    }
    
    console.log(`📊 Merging ${geometries.length} geometries for BVH...`);
    
    // Merge all geometries into one
    const mergedGeometry = mergeGeometries(geometries, false);
    
    // Create invisible mesh
    const colliderMesh = new THREE.Mesh(
        mergedGeometry,
        new THREE.MeshBasicMaterial({ visible: false })
    );
    
    // Build BVH tree with depth limits to prevent warnings
    try {
        colliderMesh.geometry.boundsTree = new MeshBVH(colliderMesh.geometry, {
            maxDepth: 30,
            maxLeafTris: 10
        });
        console.log('✅ BVH tree built successfully');
        console.log(`   Triangles: ${mergedGeometry.attributes.position.count / 3}`);
    } catch (err) {
        console.error('❌ Failed to build BVH tree:', err);
        return null;
    }
    
    return colliderMesh;
}

/**
 * Core BVH collision resolution for capsule vs triangle mesh
 * Resolves collisions and updates player position
 * @param {Object} player - Player state {start, end, radius, velocity}
 * @param {THREE.Mesh} colliderMesh - The BVH-accelerated collider mesh
 */
export function resolveCollisionsWithBVH(player, colliderMesh) {
    if (!colliderMesh || !colliderMesh.geometry.boundsTree) {
        return;
    }
    
    // Temporary objects for efficient collision queries
    const tempSegment = new THREE.Line3();
    const closestPoint = new THREE.Vector3();
    const capsulePoint = new THREE.Vector3();
    const direction = new THREE.Vector3();
    const padding = player.radius + 0.01;
    
    // Set up segment for capsule (line from start to end)
    tempSegment.start.copy(player.start);
    tempSegment.end.copy(player.end);
    
    // Create bounds for capsule to filter triangles
    const capsuleBounds = new THREE.Box3().setFromPoints([
        player.start,
        player.end
    ]);
    capsuleBounds.expandByScalar(player.radius);
    
    let collisionCount = 0;
    
    // Use shapecast for efficient triangle-capsule collision
    colliderMesh.geometry.boundsTree.shapecast({
        
        // Check if this bounding box could contain collisions
        intersectsBounds: (box) => {
            return capsuleBounds.intersectsBox(box);
        },
        
        // Check collision with individual triangle
        intersectsTriangle: (tri) => {
            // Find closest point on triangle to capsule segment
            const distance = tri.closestPointToSegment(
                tempSegment,
                closestPoint,
                capsulePoint
            );
            
            // If distance < radius, we have a collision
            if (distance < player.radius) {
                collisionCount++;
                const depth = player.radius - distance + 0.001; // Small epsilon
                
                // Calculate collision normal and resolve
                direction.copy(capsulePoint).sub(closestPoint);
                
                if (direction.lengthSq() > 0.0001) {
                    direction.normalize();
                    
                    // Push both capsule points out
                    player.start.addScaledVector(direction, depth);
                    player.end.addScaledVector(direction, depth);
                    
                    // Dampen velocity along collision normal
                    if (player.velocity) {
                        const velAlongNormal = player.velocity.dot(direction);
                        if (velAlongNormal < 0) {
                            player.velocity.addScaledVector(direction, -velAlongNormal);
                        }
                    }
                }
                
                // Update bounds for next iteration
                capsuleBounds.setFromPoints([player.start, player.end]);
                capsuleBounds.expandByScalar(player.radius);
            }
        }
    });
}

/**
 * Query ground height at a given position using BVH raycasting
 * @param {THREE.Mesh} colliderMesh - The BVH-accelerated collider mesh
 * @param {THREE.Vector3} position - World position to query
 * @param {number} maxDrop - Maximum distance to search downward
 * @returns {number} Ground Y coordinate, or -Infinity if no ground found
 */
export function queryGroundHeightBVH(colliderMesh, position, maxDrop = Infinity) {
    if (!colliderMesh || !colliderMesh.geometry.boundsTree) {
        return -Infinity;
    }
    
    const rayOrigin = new THREE.Vector3(position.x, position.y + 10, position.z);
    const rayDirection = new THREE.Vector3(0, -1, 0);
    const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0, 10 + maxDrop);
    
    const intersects = raycaster.intersectObject(colliderMesh, false);
    
    if (intersects.length > 0) {
        const hit = intersects[0];
        return hit.point.y;
    }
    
    return -Infinity;
}

/**
 * Additional feature: Visualize the BVH structure for debugging
 * @param {THREE.Mesh} colliderMesh - The BVH-accelerated collider mesh
 * @returns {THREE.Group|null} Group containing visualization meshes
 */
export function createBVHVisualizer(colliderMesh) {
    if (!colliderMesh || !colliderMesh.geometry.boundsTree) {
        return null;
    }
    
    // Try to import MeshBVHHelper if available
    try {
        // This would need to be imported from the BVH library
        console.log('BVH visualization available (import MeshBVHHelper if needed)');
        return null;
    } catch (err) {
        console.warn('BVH visualizer not available:', err.message);
        return null;
    }
}

/**
 * Dispose of BVH resources
 * @param {THREE.Mesh} colliderMesh - The BVH-accelerated collider mesh
 */
export function disposeBVHCollider(colliderMesh) {
    if (!colliderMesh) return;
    
    try {
        if (colliderMesh.geometry.boundsTree) {
            colliderMesh.geometry.boundsTree.dispose();
        }
        colliderMesh.geometry.dispose();
        colliderMesh.material.dispose();
    } catch (err) {
        console.warn('Error disposing BVH collider:', err);
    }
}
