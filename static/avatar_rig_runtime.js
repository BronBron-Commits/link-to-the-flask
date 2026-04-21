import * as THREE from '/static/three.module.js';

function makeRigEuler(x = 0, y = 0, z = 0) {
  return new THREE.Euler(x, y, z, 'XYZ');
}

function mirrorRigEuler(euler) {
  return new THREE.Euler(euler.x, -euler.y, -euler.z, 'XYZ');
}

function getRigBone(root, boneName) {
  if (!root || !boneName) return null;
  const bone = root.getObjectByName(boneName);
  return bone && bone.isBone ? bone : null;
}

function findParentBone(bone) {
  let parent = bone ? bone.parent : null;
  while (parent && !parent.isBone) {
    parent = parent.parent;
  }
  return parent && parent.isBone ? parent : null;
}

function hasPropBoneHint(name) {
  const key = (name || '').toLowerCase();
  return /(hammer|weapon|sword|axe|mace|club|staff|wand|shield|prop|item|gear)/.test(key);
}

function resolveSlotFromNearestMappedBone(sourceBone, mappedSlotBones, preferredSlots = []) {
  if (!sourceBone || !Array.isArray(mappedSlotBones) || !mappedSlotBones.length) return null;
  const sourcePos = sourceBone.getWorldPosition(new THREE.Vector3());
  const preferred = new Set(preferredSlots);
  let bestSlot = null;
  let bestScore = Number.POSITIVE_INFINITY;

  mappedSlotBones.forEach(({ slot, bone }) => {
    if (!slot || !bone) return;
    const distSq = sourcePos.distanceToSquared(bone.getWorldPosition(new THREE.Vector3()));
    const score = distSq * (preferred.has(slot) ? 0.72 : 1);
    if (score < bestScore) {
      bestScore = score;
      bestSlot = slot;
    }
  });

  return bestSlot;
}

function getFallbackRigMetricBounds(baseMetrics) {
  if (!baseMetrics) return {};

  return {
    hipsY: {
      min: baseMetrics.minY + baseMetrics.height * 0.25,
      max: baseMetrics.minY + baseMetrics.height * 0.78,
    },
    spineLen: {
      min: baseMetrics.height * 0.04,
      max: baseMetrics.height * 0.24,
    },
    chestLen: {
      min: baseMetrics.height * 0.04,
      max: baseMetrics.height * 0.24,
    },
    neckLen: {
      min: baseMetrics.height * 0.03,
      max: baseMetrics.height * 0.16,
    },
    headLen: {
      min: baseMetrics.height * 0.03,
      max: baseMetrics.height * 0.2,
    },
    shoulderOffsetX: {
      min: baseMetrics.width * 0.08,
      max: baseMetrics.width * 0.38,
    },
    shoulderOffsetY: {
      min: -baseMetrics.height * 0.06,
      max: baseMetrics.height * 0.1,
    },
    armUpperLen: {
      min: baseMetrics.width * 0.08,
      max: baseMetrics.width * 0.45,
    },
    armLowerLen: {
      min: baseMetrics.width * 0.06,
      max: baseMetrics.width * 0.4,
    },
    armDropY: {
      min: 0,
      max: baseMetrics.height * 0.12,
    },
    legOffsetX: {
      min: baseMetrics.width * 0.05,
      max: baseMetrics.width * 0.24,
    },
    legRootDrop: {
      min: baseMetrics.height * 0.08,
      max: baseMetrics.height * 0.42,
    },
    legUpperLen: {
      min: baseMetrics.height * 0.1,
      max: baseMetrics.height * 0.45,
    },
    legLowerLen: {
      min: baseMetrics.height * 0.08,
      max: baseMetrics.height * 0.4,
    },
    legForward: {
      min: baseMetrics.depth * 0.005,
      max: baseMetrics.depth * 0.12,
    },
    footForward: {
      min: baseMetrics.depth * 0.02,
      max: baseMetrics.depth * 0.28,
    },
  };
}

function sanitizeFallbackRigMetricOverrides(overrides, baseMetrics) {
  if (!overrides || typeof overrides !== 'object' || !baseMetrics) return {};

  const bounds = getFallbackRigMetricBounds(baseMetrics);
  const sanitized = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!Number.isFinite(value) || !(key in bounds)) continue;
    sanitized[key] = THREE.MathUtils.clamp(value, bounds[key].min, bounds[key].max);
  }
  return sanitized;
}

function applyFallbackRigMetricOverrides(baseMetrics, overrides) {
  if (!baseMetrics) return null;
  return {
    ...baseMetrics,
    ...sanitizeFallbackRigMetricOverrides(overrides, baseMetrics),
  };
}

function buildRigidFallbackSkinning(geometry, boneIndex) {
  const position = geometry.getAttribute('position');
  if (!position || !position.count) return null;

  const skinIndex = new THREE.Uint16BufferAttribute(position.count * 4, 4);
  const skinWeight = new THREE.Float32BufferAttribute(position.count * 4, 4);
  for (let i = 0; i < position.count; i += 1) {
    skinIndex.setX(i, boneIndex);
    skinIndex.setY(i, boneIndex);
    skinIndex.setZ(i, boneIndex);
    skinIndex.setW(i, boneIndex);
    skinWeight.setX(i, 1);
    skinWeight.setY(i, 0);
    skinWeight.setZ(i, 0);
    skinWeight.setW(i, 0);
  }

  return { skinIndex, skinWeight };
}

function isLikelyHeadAttachmentMesh(mesh) {
  const facialPattern = /(eye|eyes|lash|lashes|brow|eyebrow|teeth|tooth|tongue|mouth|lip|jaw|beard|mustache|moustache|hair|bang|fringe|head|face)/i;
  let cursor = mesh;
  let depth = 0;
  while (cursor && depth < 5) {
    if (typeof cursor.name === 'string' && facialPattern.test(cursor.name)) {
      return true;
    }
    cursor = cursor.parent;
    depth += 1;
  }
  return false;
}

function collectFallbackRigMetrics(root, mapping) {
  const box = new THREE.Box3().setFromObject(root);
  const min = root.worldToLocal(box.min.clone());
  const max = root.worldToLocal(box.max.clone());
  const center = root.worldToLocal(box.getCenter(new THREE.Vector3()));
  const width = Math.max(max.x - min.x, 0.2);
  const height = Math.max(max.y - min.y, 0.2);
  const depth = Math.max(max.z - min.z, 0.1);

  const defaults = {
    centerX: center.x,
    centerZ: center.z + depth * 0.03,
    minY: min.y,
    width,
    height,
    depth,
    hipsY: min.y + height * 0.53,
    spineLen: height * 0.12,
    chestLen: height * 0.14,
    neckLen: height * 0.1,
    headLen: height * 0.1,
    shoulderOffsetX: width * 0.18,
    // Screenshot baseline: shoulder height around -0.070 on a typical avatar.
    shoulderOffsetY: -height * 0.04,
    armUpperLen: width * 0.18,
    armLowerLen: width * 0.15,
    armDropY: height * 0.016,
    legOffsetX: width * 0.09,
    legRootDrop: height * 0.25,
    legUpperLen: height * 0.26,
    legLowerLen: height * 0.24,
    legForward: depth * 0.02,
    footForward: depth * 0.08,
  };

  if (!mapping || typeof mapping !== 'object') {
    return defaults;
  }

  const slotPos = new Map();
  for (const [slot, name] of Object.entries(mapping)) {
    const bone = getRigBone(root, name);
    if (!bone) continue;
    slotPos.set(slot, root.worldToLocal(bone.getWorldPosition(new THREE.Vector3())));
  }

  const hipsPos = slotPos.get('hips');
  const spinePos = slotPos.get('spine');
  const chestPos = slotPos.get('chest');
  const neckPos = slotPos.get('neck');
  const headPos = slotPos.get('head');
  const leftUpperArmPos = slotPos.get('leftUpperArm');
  const rightUpperArmPos = slotPos.get('rightUpperArm');
  const leftLowerArmPos = slotPos.get('leftLowerArm');
  const rightLowerArmPos = slotPos.get('rightLowerArm');
  const leftHandPos = slotPos.get('leftHand');
  const rightHandPos = slotPos.get('rightHand');
  const leftUpperLegPos = slotPos.get('leftUpperLeg');
  const rightUpperLegPos = slotPos.get('rightUpperLeg');
  const leftLowerLegPos = slotPos.get('leftLowerLeg');
  const rightLowerLegPos = slotPos.get('rightLowerLeg');
  const leftFootPos = slotPos.get('leftFoot');
  const rightFootPos = slotPos.get('rightFoot');

  const armSide = (leftUpperArmPos && leftLowerArmPos) ? 'left' : ((rightUpperArmPos && rightLowerArmPos) ? 'right' : null);
  const legSide = (leftUpperLegPos && leftLowerLegPos) ? 'left' : ((rightUpperLegPos && rightLowerLegPos) ? 'right' : null);

  const sideUpperArmPos = armSide === 'left' ? leftUpperArmPos : rightUpperArmPos;
  const sideLowerArmPos = armSide === 'left' ? leftLowerArmPos : rightLowerArmPos;
  const sideHandPos = armSide === 'left' ? leftHandPos : rightHandPos;

  const sideUpperLegPos = legSide === 'left' ? leftUpperLegPos : rightUpperLegPos;
  const sideLowerLegPos = legSide === 'left' ? leftLowerLegPos : rightLowerLegPos;
  const sideFootPos = legSide === 'left' ? leftFootPos : rightFootPos;

  const hipsY = hipsPos ? THREE.MathUtils.clamp(hipsPos.y, min.y + height * 0.25, min.y + height * 0.78) : defaults.hipsY;
  const shoulderBaseY = sideUpperArmPos
    ? sideUpperArmPos.y
    : (chestPos ? chestPos.y : hipsY + height * 0.27);
  const shoulderOffsetY = THREE.MathUtils.clamp(
    shoulderBaseY - hipsY - (spinePos ? (spinePos.y - hipsY) : 0),
    -height * 0.06,
    height * 0.1,
  );
  const shoulderOffsetX = sideUpperArmPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperArmPos.x - defaults.centerX), width * 0.08, width * 0.38)
    : defaults.shoulderOffsetX;
  const armUpperLen = (sideUpperArmPos && sideLowerArmPos)
    ? THREE.MathUtils.clamp(sideUpperArmPos.distanceTo(sideLowerArmPos), width * 0.08, width * 0.45)
    : defaults.armUpperLen;
  const armLowerLen = (sideLowerArmPos && sideHandPos)
    ? THREE.MathUtils.clamp(sideLowerArmPos.distanceTo(sideHandPos), width * 0.06, width * 0.4)
    : defaults.armLowerLen;
  const legOffsetX = sideUpperLegPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperLegPos.x - defaults.centerX), width * 0.05, width * 0.24)
    : defaults.legOffsetX;
  const legRootDrop = sideUpperLegPos
    ? THREE.MathUtils.clamp(Math.abs(sideUpperLegPos.y - hipsY), height * 0.08, height * 0.42)
    : defaults.legRootDrop;
  const legUpperLen = (sideUpperLegPos && sideLowerLegPos)
    ? THREE.MathUtils.clamp(sideUpperLegPos.distanceTo(sideLowerLegPos), height * 0.1, height * 0.45)
    : defaults.legUpperLen;
  const legLowerLen = (sideLowerLegPos && sideFootPos)
    ? THREE.MathUtils.clamp(sideLowerLegPos.distanceTo(sideFootPos), height * 0.08, height * 0.4)
    : defaults.legLowerLen;
  const spineLen = spinePos && hipsPos
    ? THREE.MathUtils.clamp(Math.abs(spinePos.y - hipsPos.y), height * 0.04, height * 0.24)
    : defaults.spineLen;
  const chestLen = chestPos && spinePos
    ? THREE.MathUtils.clamp(Math.abs(chestPos.y - spinePos.y), height * 0.04, height * 0.24)
    : defaults.chestLen;
  const neckLen = neckPos && chestPos
    ? THREE.MathUtils.clamp(Math.abs(neckPos.y - chestPos.y), height * 0.03, height * 0.16)
    : defaults.neckLen;
  const headLen = headPos && neckPos
    ? THREE.MathUtils.clamp(Math.abs(headPos.y - neckPos.y), height * 0.03, height * 0.2)
    : defaults.headLen;
  const legForward = (sideUpperLegPos && sideLowerLegPos)
    ? THREE.MathUtils.clamp(Math.abs(sideLowerLegPos.z - sideUpperLegPos.z), depth * 0.005, depth * 0.12)
    : defaults.legForward;
  const footForward = (sideLowerLegPos && sideFootPos)
    ? THREE.MathUtils.clamp(Math.abs(sideFootPos.z - sideLowerLegPos.z), depth * 0.02, depth * 0.28)
    : defaults.footForward;

  return {
    centerX: defaults.centerX,
    centerZ: defaults.centerZ,
    minY: defaults.minY,
    width,
    height,
    depth,
    hipsY,
    spineLen,
    chestLen,
    neckLen,
    headLen,
    shoulderOffsetX,
    shoulderOffsetY,
    armUpperLen,
    armLowerLen,
    armDropY: defaults.armDropY,
    legOffsetX,
    legRootDrop,
    legUpperLen,
    legLowerLen,
    legForward,
    footForward,
  };
}

function createFallbackRig(root, mapping, metricOverrides = {}) {
  const baseMetrics = collectFallbackRigMetrics(root, mapping);
  const metrics = applyFallbackRigMetricOverrides(baseMetrics, metricOverrides);
  const group = new THREE.Group();
  group.name = 'savedFallbackReboneRig';

  const hips = new THREE.Bone();
  hips.name = 'hips';
  hips.position.set(metrics.centerX, metrics.hipsY, metrics.centerZ);
  group.add(hips);

  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = metrics.spineLen;
  hips.add(spine);

  const chest = new THREE.Bone();
  chest.name = 'chest';
  chest.position.y = metrics.chestLen;
  spine.add(chest);

  const neck = new THREE.Bone();
  neck.name = 'neck';
  neck.position.y = metrics.neckLen;
  chest.add(neck);

  const head = new THREE.Bone();
  head.name = 'head';
  head.position.y = metrics.headLen;
  neck.add(head);

  function addArm(sideName, sideSign) {
    const upper = new THREE.Bone();
    upper.name = `${sideName}UpperArm`;
    upper.position.set(sideSign * metrics.shoulderOffsetX, metrics.shoulderOffsetY, 0);
    // Enforce a neutral T-pose baseline on initial fallback rebone.
    upper.rotation.set(0, 0, 0);
    chest.add(upper);

    const lower = new THREE.Bone();
    lower.name = `${sideName}LowerArm`;
    lower.position.set(sideSign * metrics.armUpperLen, 0, 0);
    lower.rotation.set(0, 0, 0);
    upper.add(lower);

    const hand = new THREE.Bone();
    hand.name = `${sideName}Hand`;
    hand.position.set(sideSign * metrics.armLowerLen, 0, 0);
    hand.rotation.set(0, 0, 0);
    lower.add(hand);
    return [upper, lower, hand];
  }

  function addLeg(sideName, sideSign) {
    const upper = new THREE.Bone();
    upper.name = `${sideName}UpperLeg`;
    upper.position.set(sideSign * metrics.legOffsetX, -metrics.legRootDrop, 0);
    upper.rotation.set(0, 0, 0);
    hips.add(upper);

    const lower = new THREE.Bone();
    lower.name = `${sideName}LowerLeg`;
    lower.position.set(0, -metrics.legUpperLen, metrics.legForward);
    lower.rotation.set(0, 0, 0);
    upper.add(lower);

    const foot = new THREE.Bone();
    foot.name = `${sideName}Foot`;
    foot.position.set(0, -metrics.legLowerLen, metrics.footForward);
    foot.rotation.set(0, 0, 0);
    lower.add(foot);
    return [upper, lower, foot];
  }

  const [leftUpperArm, leftLowerArm, leftHand] = addArm('left', -1);
  const [rightUpperArm, rightLowerArm, rightHand] = addArm('right', 1);
  const [leftUpperLeg, leftLowerLeg, leftFoot] = addLeg('left', -1);
  const [rightUpperLeg, rightLowerLeg, rightFoot] = addLeg('right', 1);

  root.add(group);

  return {
    root: group,
    baseMetrics,
    metrics,
    metricOverrides: sanitizeFallbackRigMetricOverrides(metricOverrides, baseMetrics),
    bones: new Map([
      ['hips', hips],
      ['spine', spine],
      ['chest', chest],
      ['neck', neck],
      ['head', head],
      ['leftUpperArm', leftUpperArm],
      ['leftLowerArm', leftLowerArm],
      ['leftHand', leftHand],
      ['rightUpperArm', rightUpperArm],
      ['rightLowerArm', rightLowerArm],
      ['rightHand', rightHand],
      ['leftUpperLeg', leftUpperLeg],
      ['leftLowerLeg', leftLowerLeg],
      ['leftFoot', leftFoot],
      ['rightUpperLeg', rightUpperLeg],
      ['rightLowerLeg', rightLowerLeg],
      ['rightFoot', rightFoot],
    ]),
  };
}

function buildProceduralFallbackSkinning(mesh, geometry, fallbackBoneIndexBySlot, fallbackBones) {
  const position = geometry.getAttribute('position');
  if (!position || !position.count) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const bbox = geometry.boundingBox;
  if (!bbox) return null;

  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());
  const minY = bbox.min.y;
  const width = Math.max(size.x, 0.001);
  const height = Math.max(size.y, 0.001);
  const depth = Math.max(size.z, 0.001);
  const skinIndex = new THREE.Uint16BufferAttribute(position.count * 4, 4);
  const skinWeight = new THREE.Float32BufferAttribute(position.count * 4, 4);
  const boneLocalPosBySlot = new Map();

  const slotProfiles = {
    hips:          { y: 0.44, ySpread: 0.14, x: 0.05, xSpread: 0.18, side: 'center', scale: 1.1  },
    spine:         { y: 0.58, ySpread: 0.14, x: 0.04, xSpread: 0.16, side: 'center', scale: 0.95 },
    chest:         { y: 0.72, ySpread: 0.13, x: 0.06, xSpread: 0.18, side: 'center', scale: 1.05 },
    neck:          { y: 0.86, ySpread: 0.09, x: 0.08, xSpread: 0.16, side: 'center', scale: 0.85 },
    head:          { y: 0.95, ySpread: 0.09, x: 0.12, xSpread: 0.2,  side: 'center', scale: 0.85 },
    leftUpperArm:  { y: 0.74, ySpread: 0.12, x: 0.56, xSpread: 0.13, side: 'left',   scale: 0.9  },
    leftLowerArm:  { y: 0.61, ySpread: 0.12, x: 0.76, xSpread: 0.12, side: 'left',   scale: 0.85 },
    leftHand:      { y: 0.49, ySpread: 0.11, x: 0.93, xSpread: 0.09, side: 'left',   scale: 0.78 },
    rightUpperArm: { y: 0.74, ySpread: 0.12, x: 0.56, xSpread: 0.13, side: 'right',  scale: 0.9  },
    rightLowerArm: { y: 0.61, ySpread: 0.12, x: 0.76, xSpread: 0.12, side: 'right',  scale: 0.85 },
    rightHand:     { y: 0.49, ySpread: 0.11, x: 0.93, xSpread: 0.09, side: 'right',  scale: 0.78 },
    leftUpperLeg:  { y: 0.36, ySpread: 0.14, x: 0.26, xSpread: 0.06, side: 'left',   scale: 1.0  },
    leftLowerLeg:  { y: 0.16, ySpread: 0.12, x: 0.24, xSpread: 0.06, side: 'left',   scale: 0.9  },
    leftFoot:      { y: 0.03, ySpread: 0.06, x: 0.22, xSpread: 0.08, side: 'left',   scale: 0.8  },
    rightUpperLeg: { y: 0.36, ySpread: 0.14, x: 0.26, xSpread: 0.06, side: 'right',  scale: 1.0  },
    rightLowerLeg: { y: 0.16, ySpread: 0.12, x: 0.24, xSpread: 0.06, side: 'right',  scale: 0.9  },
    rightFoot:     { y: 0.03, ySpread: 0.06, x: 0.22, xSpread: 0.08, side: 'right',  scale: 0.8  },
  };

  mesh.updateMatrixWorld(true);
  fallbackBones.forEach((bone, slot) => {
    boneLocalPosBySlot.set(slot, mesh.worldToLocal(bone.getWorldPosition(new THREE.Vector3())));
  });

  function getIndex(slot) {
    return fallbackBoneIndexBySlot.get(slot) ?? fallbackBoneIndexBySlot.get('hips') ?? 0;
  }

  function gaussian(value, spread) {
    const safeSpread = Math.max(spread, 0.0001);
    return Math.exp(-((value * value) / (2 * safeSpread * safeSpread)));
  }

  function normalize(entries) {
    const merged = new Map();
    entries.forEach(({ slot, weight }) => {
      if (!slot || weight <= 0) return;
      merged.set(slot, (merged.get(slot) || 0) + weight);
    });
    const compact = Array.from(merged.entries())
      .map(([slot, weight]) => ({ slot, weight }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
    const total = compact.reduce((sum, entry) => sum + entry.weight, 0) || 1;
    return compact.map((entry) => ({ slot: entry.slot, weight: entry.weight / total }));
  }

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const xNorm = (x - center.x) / (width * 0.5);
    const yNorm = (y - minY) / height;
    const side = xNorm < 0 ? 'left' : 'right';
    const lateral = Math.abs(xNorm);
    const entries = [];

    Object.entries(slotProfiles).forEach(([slot, profile]) => {
      const boneLocal = boneLocalPosBySlot.get(slot);
      if (!boneLocal) return;
      const sideScore = profile.side === 'center' ? 1 : (profile.side === side ? 1 : 0.0);
      if (sideScore === 0.0) return;
      const priorY = gaussian(yNorm - profile.y, profile.ySpread);
      const priorX = gaussian(lateral - profile.x, profile.xSpread);
      const dx = (x - boneLocal.x) / (width * (profile.side === 'center' ? 0.25 : 0.14));
      const dy = (y - boneLocal.y) / (height * (profile.side === 'center' ? 0.13 : 0.14));
      const dz = (z - boneLocal.z) / (depth * 0.28);
      const distanceScore = Math.exp(-(dx * dx + dy * dy + dz * dz));
      const weight = profile.scale * sideScore * ((distanceScore * 0.76) + (priorY * priorX * 0.24));
      if (weight > 0.0005) {
        entries.push({ slot, weight });
      }
    });

    if (!entries.length) {
      entries.push({ slot: side === 'left' ? 'leftUpperLeg' : 'rightUpperLeg', weight: 0.45 });
      entries.push({ slot: 'hips', weight: 0.35 });
      entries.push({ slot: 'spine', weight: 0.2 });
    }

    const normalized = normalize(entries);
    for (let c = 0; c < 4; c += 1) {
      const entry = normalized[c];
      const targetIndex = entry ? getIndex(entry.slot) : getIndex('hips');
      const targetWeight = entry ? entry.weight : 0;
      if (c === 0) {
        skinIndex.setX(i, targetIndex);
        skinWeight.setX(i, targetWeight);
      } else if (c === 1) {
        skinIndex.setY(i, targetIndex);
        skinWeight.setY(i, targetWeight);
      } else if (c === 2) {
        skinIndex.setZ(i, targetIndex);
        skinWeight.setZ(i, targetWeight);
      } else {
        skinIndex.setW(i, targetIndex);
        skinWeight.setW(i, targetWeight);
      }
    }
  }

  return { skinIndex, skinWeight };
}

function setupRuntimeMeshRebind(root, fallbackRigState, mapping) {
  const fallbackBones = Array.from(fallbackRigState.bones.values());
  const fallbackBoneIndexByUuid = new Map();
  fallbackBones.forEach((bone, idx) => fallbackBoneIndexByUuid.set(bone.uuid, idx));
  const fallbackBoneIndexBySlot = new Map();
  fallbackRigState.bones.forEach((bone, slot) => {
    fallbackBoneIndexBySlot.set(slot, fallbackBoneIndexByUuid.get(bone.uuid) ?? 0);
  });
  const sourceBoneNameToSlot = new Map();
  Object.entries(mapping || {}).forEach(([slot, boneName]) => {
    if (boneName) sourceBoneNameToSlot.set(boneName, slot);
  });
  const mappedSlotBones = [];
  Object.entries(mapping || {}).forEach(([slot, boneName]) => {
    if (!fallbackRigState.bones.has(slot)) return;
    const sourceBone = getRigBone(root, boneName);
    if (sourceBone) {
      mappedSlotBones.push({ slot, bone: sourceBone });
    }
  });
  const hipsBone = fallbackRigState.bones.get('hips');
  const hipsIndex = hipsBone ? (fallbackBoneIndexByUuid.get(hipsBone.uuid) || 0) : 0;

  const records = [];
  let remappedInfluences = 0;
  let autoWeightedMeshes = 0;
  let convertedMeshes = 0;

  function bindProceduralMesh(mesh, parent, kind) {
    const originalGeometry = mesh.geometry;
    if (!originalGeometry) return false;
    const workingGeometry = originalGeometry.clone();
    const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
    const procedural = isLikelyHeadAttachmentMesh(mesh)
      ? buildRigidFallbackSkinning(workingGeometry, headIndex)
      : buildProceduralFallbackSkinning(mesh, workingGeometry, fallbackBoneIndexBySlot, fallbackRigState.bones);
    if (!procedural) return false;
    workingGeometry.setAttribute('skinIndex', procedural.skinIndex);
    workingGeometry.setAttribute('skinWeight', procedural.skinWeight);

    const skinned = new THREE.SkinnedMesh(workingGeometry, mesh.material);
    skinned.name = mesh.name;
    skinned.castShadow = mesh.castShadow;
    skinned.receiveShadow = mesh.receiveShadow;
    skinned.frustumCulled = mesh.frustumCulled;
    skinned.position.copy(mesh.position);
    skinned.quaternion.copy(mesh.quaternion);
    skinned.scale.copy(mesh.scale);
    skinned.visible = mesh.visible;
    skinned.matrixAutoUpdate = mesh.matrixAutoUpdate;
    skinned.renderOrder = mesh.renderOrder;
    skinned.userData = { ...(mesh.userData || {}), runtimeFallbackGenerated: true };

    parent.add(skinned);
    mesh.visible = false;

    const newSkeleton = new THREE.Skeleton(fallbackBones);
    skinned.bind(newSkeleton);
    skinned.normalizeSkinWeights();
    records.push({
      kind,
      parent,
      originalMesh: mesh,
      replacement: skinned,
      localPosition: mesh.position.clone(),
      localQuaternion: mesh.quaternion.clone(),
      localScale: mesh.scale.clone(),
    });
    autoWeightedMeshes += 1;
    convertedMeshes += 1;
    return true;
  }

  root.traverse((obj) => {
    if (obj.userData?.runtimeFallbackGenerated) return;

    if (obj.isMesh && !obj.isSkinnedMesh && obj.geometry && obj.material) {
      if (obj.parent) bindProceduralMesh(obj, obj.parent, 'converted');
      return;
    }

    if (!obj.isSkinnedMesh || !obj.skeleton || !obj.geometry) return;

    const oldGeometry = obj.geometry;
    const oldSkinIndex = oldGeometry.getAttribute('skinIndex');
    const oldSkinWeight = oldGeometry.getAttribute('skinWeight');
    const sourceToFallback = new Map();
    let resolvedSourceBones = 0;

    obj.skeleton.bones.forEach((sourceBone, sourceIndex) => {
      if (!sourceBone) return;
      let cursor = sourceBone;
      let resolvedSlot = null;
      while (cursor && cursor.isBone) {
        const slot = sourceBoneNameToSlot.get(cursor.name);
        if (slot && fallbackRigState.bones.has(slot)) {
          resolvedSlot = slot;
          break;
        }
        cursor = findParentBone(cursor);
      }

      if (!resolvedSlot) {
        const preferredSlots = hasPropBoneHint(sourceBone.name)
          ? ['leftHand', 'rightHand', 'leftLowerArm', 'rightLowerArm', 'leftUpperArm', 'rightUpperArm']
          : [];
        resolvedSlot = resolveSlotFromNearestMappedBone(sourceBone, mappedSlotBones, preferredSlots);
      }

      const fallbackBone = resolvedSlot ? fallbackRigState.bones.get(resolvedSlot) : hipsBone;
      const fallbackIndex = fallbackBone ? (fallbackBoneIndexByUuid.get(fallbackBone.uuid) ?? hipsIndex) : hipsIndex;
      sourceToFallback.set(sourceIndex, fallbackIndex);
      if (resolvedSlot) resolvedSourceBones += 1;
    });

    const workingGeometry = oldGeometry.clone();
    if (isLikelyHeadAttachmentMesh(obj)) {
      const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
      const rigid = buildRigidFallbackSkinning(workingGeometry, headIndex);
      if (!rigid) return;
      workingGeometry.setAttribute('skinIndex', rigid.skinIndex);
      workingGeometry.setAttribute('skinWeight', rigid.skinWeight);
    } else if (oldSkinIndex && oldSkinIndex.itemSize >= 4 && oldSkinWeight && resolvedSourceBones >= 3) {
      const clonedSkinIndex = oldSkinIndex.clone();
      const setByChannel = [
        (i, v) => clonedSkinIndex.setX(i, v),
        (i, v) => clonedSkinIndex.setY(i, v),
        (i, v) => clonedSkinIndex.setZ(i, v),
        (i, v) => clonedSkinIndex.setW(i, v),
      ];
      for (let i = 0; i < clonedSkinIndex.count; i += 1) {
        const sourceIndices = [
          clonedSkinIndex.getX(i),
          clonedSkinIndex.getY(i),
          clonedSkinIndex.getZ(i),
          clonedSkinIndex.getW(i),
        ];
        for (let c = 0; c < 4; c += 1) {
          const remapped = sourceToFallback.get(sourceIndices[c]);
          if (typeof remapped === 'number') {
            setByChannel[c](i, remapped);
            remappedInfluences += 1;
          }
        }
      }
      workingGeometry.setAttribute('skinIndex', clonedSkinIndex);
    } else {
      const headIndex = fallbackBoneIndexBySlot.get('head') ?? hipsIndex;
      const procedural = isLikelyHeadAttachmentMesh(obj)
        ? buildRigidFallbackSkinning(workingGeometry, headIndex)
        : buildProceduralFallbackSkinning(obj, workingGeometry, fallbackBoneIndexBySlot, fallbackRigState.bones);
      if (!procedural) return;
      workingGeometry.setAttribute('skinIndex', procedural.skinIndex);
      workingGeometry.setAttribute('skinWeight', procedural.skinWeight);
      autoWeightedMeshes += 1;
    }

    obj.geometry = workingGeometry;
    const originalBindMatrix = obj.bindMatrix.clone();
    const originalBindMode = obj.bindMode;
    const originalSkeleton = obj.skeleton;
    const newSkeleton = new THREE.Skeleton(fallbackBones);
    obj.bind(newSkeleton, originalBindMatrix.clone());
    obj.bindMode = originalBindMode;
    obj.normalizeSkinWeights();
    records.push({
      kind: 'rebound',
      mesh: obj,
      originalGeometry: oldGeometry,
      originalSkeleton,
      originalBindMatrix,
      originalBindMode,
    });
  });

  return {
    active: records.length > 0,
    records,
    stats: {
      meshCount: records.length,
      remappedInfluences,
      autoWeightedMeshes,
      convertedMeshes,
    },
  };
}

function restoreRuntimeMeshRebind(rebindState) {
  if (!rebindState || !rebindState.records) return;
  rebindState.records.forEach((record) => {
    if (record.kind === 'converted') {
      if (record.replacement && record.replacement.parent) {
        record.replacement.parent.remove(record.replacement);
      }
      if (record.originalMesh) {
        record.originalMesh.visible = true;
      }
      return;
    }

    if (!record.mesh) return;
    record.mesh.geometry = record.originalGeometry;
    record.mesh.bindMode = record.originalBindMode;
    record.mesh.bind(record.originalSkeleton, record.originalBindMatrix.clone());
  });
}

function createFallbackWalkController(fallbackRigState, options = {}) {
  if (!fallbackRigState || !fallbackRigState.bones) {
    return {
      update() {},
      reset() {},
      toggleDance() { return false; },
      triggerFrontFlip() { return false; },
      triggerHammerFlourish() { return false; },
      getMode() { return 'walk'; },
    };
  }

  const slots = [
    'hips', 'spine', 'chest', 'head',
    'leftShoulder', 'rightShoulder',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];
  const basePose = new Map();
  slots.forEach((slot) => {
    const bone = fallbackRigState.bones.get(slot);
    if (!bone) return;
    basePose.set(slot, {
      bone,
      quat: bone.quaternion.clone(),
      position: bone.position.clone(),
    });
  });

  let walkTime = 0;
  let danceTime = 0;
  let frontFlipTime = 0;
  let danceActive = false;
  let frontFlipActive = false;
  let hammerFlourishActive = false;
  let hammerFlourishTime = 0;
  let wormActive = false;
  let wormTime = 0;
  let headspinActive = false;
  let headspinTime = 0;
  let jumpArmTime = 0;
  const frontFlipDuration = 0.6;
  const hammerFlourishDuration = 0.9;
  const useConservativeIdle = !!options.useConservativeIdle;
  const hasShoulderSlots = basePose.has('leftShoulder') || basePose.has('rightShoulder');

  function getBaseSlotPosition(slot) {
    const entry = basePose.get(slot);
    return entry ? entry.position.clone() : new THREE.Vector3();
  }

  const leftLegBase = {
    knee: getBaseSlotPosition('leftLowerLeg'),
    foot: getBaseSlotPosition('leftFoot'),
  };
  const rightLegBase = {
    knee: getBaseSlotPosition('rightLowerLeg'),
    foot: getBaseSlotPosition('rightFoot'),
  };

  function buildLegChainMetrics(base) {
    return {
      upperLen: Math.max(base.knee.length(), 0.001),
      lowerLen: Math.max(base.foot.length(), 0.001),
      footTarget: base.knee.clone().add(base.foot),
    };
  }

  const leftLegMetrics = buildLegChainMetrics(leftLegBase);
  const rightLegMetrics = buildLegChainMetrics(rightLegBase);

  function solvePlanarLegIK(targetY, targetZ, upperLen, lowerLen) {
    const tx = targetZ;
    const ty = Math.max(-targetY, 0.001);
    const dist = THREE.MathUtils.clamp(
      Math.sqrt((tx * tx) + (ty * ty)),
      0.001,
      Math.max(0.001, upperLen + lowerLen - 0.0001),
    );

    const a = ((upperLen * upperLen) - (lowerLen * lowerLen) + (dist * dist)) / (2 * dist);
    const h = Math.sqrt(Math.max((upperLen * upperLen) - (a * a), 0));
    const dirX = tx / dist;
    const dirY = ty / dist;
    const baseX = dirX * a;
    const baseY = dirY * a;
    const kneeX = baseX - ((h * dirY));
    const kneeY = baseY + ((h * dirX));

    const upperAngle = Math.atan2(kneeX, kneeY);
    const lowerAngle = Math.atan2(tx - kneeX, ty - kneeY) - upperAngle;
    return { upperAngle, lowerAngle };
  }

  function solveLegPose(metrics, targetY, targetZ, footPitch = 0) {
    const ik = solvePlanarLegIK(targetY, targetZ, metrics.upperLen, metrics.lowerLen);
    return {
      upper: ik.upperAngle,
      lower: ik.lowerAngle,
      foot: footPitch - ik.upperAngle - ik.lowerAngle,
    };
  }

  function reset() {
    basePose.forEach(({ bone, quat, position }) => {
      bone.quaternion.copy(quat);
      bone.position.copy(position);
    });
    if (fallbackRigState.root) fallbackRigState.root.updateMatrixWorld(true);
  }

  function updateWorld() {
    if (fallbackRigState.root) fallbackRigState.root.updateMatrixWorld(true);
  }

  function applySlotOffsets(slotOffsets, hipsOffset = null) {
    basePose.forEach(({ bone, quat, position }, slot) => {
      const euler = slotOffsets[slot] || makeRigEuler();
      bone.position.copy(position);

      if (slot === 'hips' && hipsOffset) {
        if (Number.isFinite(hipsOffset.x)) bone.position.x += hipsOffset.x;
        if (Number.isFinite(hipsOffset.y)) bone.position.y += hipsOffset.y;
        if (Number.isFinite(hipsOffset.z)) bone.position.z += hipsOffset.z;
      }

      bone.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromEuler(euler));
    });

    updateWorld();
  }

  function updateDance(deltaSeconds) {
    danceTime += deltaSeconds;
    const phase = danceTime * 0.72 * Math.PI * 2;
    const sway = Math.sin(phase);
    const bounce = Math.max(0, Math.sin(phase * 2.2));
    const torsoLean = Math.sin(phase * 0.5 + Math.PI * 0.2);
    const chestTwist = Math.sin(phase + Math.PI * 0.5) * 0.3;
    const leftPunch = Math.max(0, Math.sin(phase + Math.PI * 0.15));
    const rightPunch = Math.max(0, Math.sin(phase + Math.PI * 1.15));

    const slotOffsets = {
      hips: makeRigEuler(0.03 * bounce, chestTwist * 0.4, sway * 0.12),
      spine: makeRigEuler(0.06 * bounce + torsoLean * 0.05, chestTwist * 0.45, 0),
      chest: makeRigEuler(0.1 * bounce + torsoLean * 0.08, chestTwist, sway * 0.08),
      head: makeRigEuler(-0.02 + torsoLean * 0.06, -chestTwist * 0.35, -sway * 0.05),
      leftUpperArm: makeRigEuler(0.45 + leftPunch * 0.65 + bounce * 0.12, 0.18 + chestTwist * 0.25, -0.34),
      rightUpperArm: makeRigEuler(0.45 + rightPunch * 0.65 + bounce * 0.12, -0.18 - chestTwist * 0.25, 0.34),
      leftLowerArm: makeRigEuler(0.3 + leftPunch * 0.5, 0.02, -0.04),
      rightLowerArm: makeRigEuler(0.3 + rightPunch * 0.5, -0.02, 0.04),
      leftHand: makeRigEuler(leftPunch * 0.22, 0, -0.08),
      rightHand: makeRigEuler(rightPunch * 0.22, 0, 0.08),
      leftUpperLeg: makeRigEuler(0.08 + Math.max(0, -sway) * 0.2, 0, -0.08),
      rightUpperLeg: makeRigEuler(0.08 + Math.max(0, sway) * 0.2, 0, 0.08),
      leftLowerLeg: makeRigEuler(Math.max(0, sway) * 0.24, 0, 0),
      rightLowerLeg: makeRigEuler(Math.max(0, -sway) * 0.24, 0, 0),
      leftFoot: makeRigEuler(Math.max(0, -sway) * 0.14, 0, -0.03),
      rightFoot: makeRigEuler(Math.max(0, sway) * 0.14, 0, 0.03),
    };

    applySlotOffsets(slotOffsets, {
      x: sway * 0.028,
      y: -0.01 + bounce * 0.02,
      z: 0,
    });
  }

  function updateHammerFlourish(deltaSeconds) {
    hammerFlourishTime += deltaSeconds;
    const t = THREE.MathUtils.clamp(hammerFlourishTime / hammerFlourishDuration, 0, 1);
    const eio = (v) => v * v * (3 - 2 * v);
    // Piecewise keyframe lerp helpers
    function kf(frames) {
      for (let i = 0; i < frames.length - 1; i++) {
        const [t0, v0] = frames[i];
        const [t1, v1] = frames[i + 1];
        if (t <= t1) {
          const a = eio(THREE.MathUtils.clamp((t - t0) / (t1 - t0), 0, 1));
          return v0 + (v1 - v0) * a;
        }
      }
      return frames[frames.length - 1][1];
    }

    // Overhead strike: arms swing BACK/UP (negative X = backward arc overhead) then slam FORWARD/DOWN (positive X)
    // t=0: idle  t=0.30: arms swung back overhead (windup)  t=0.52: devastating downward slam  t=0.68: low follow-through  t=1.0: idle
    const armX      = kf([[0,0.035],[0.30,-1.55],[0.52,1.90],[0.68,0.45],[1.0,0.035]]); // back→overhead→slam down
    const armZ      = kf([[0,0.68],[0.30,0.10],[0.52,0.12],[0.68,0.35],[1.0,0.68]]);    // arms come in to centerline at top
    const elbowBend = kf([[0,0.14],[0.30,0.55],[0.52,0.35],[0.68,0.18],[1.0,0.14]]);
    const torsoFwd  = kf([[0,0],[0.30,-0.20],[0.52,0.32],[0.68,0.22],[1.0,0]]);          // lean back on windup, lurch forward on slam
    const hipDip    = kf([[0,0],[0.52,0.12],[0.68,0.08],[1.0,0]]);

    const slotOffsets = {
      hips:  makeRigEuler(hipDip, 0, 0),
      spine: makeRigEuler(torsoFwd * 0.55, 0, 0),
      chest: makeRigEuler(torsoFwd, 0, 0),
      head:  makeRigEuler(-torsoFwd * 0.3, 0, 0),
      // Both arms swing forward/up together — same values, mirrored on right
      leftUpperArm:  makeRigEuler(armX, 0, armZ),
      rightUpperArm: mirrorRigEuler(makeRigEuler(armX, 0, -armZ)),
      leftLowerArm:  makeRigEuler(elbowBend, 0, 0),
      rightLowerArm: mirrorRigEuler(makeRigEuler(elbowBend, 0, 0)),
      leftHand:      makeRigEuler(elbowBend * 0.2, 0, 0),
      rightHand:     mirrorRigEuler(makeRigEuler(elbowBend * 0.2, 0, 0)),
      // Legs stay planted
      leftUpperLeg:  makeRigEuler(-0.025, 0, -0.015),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.025, 0, -0.015)),
      leftLowerLeg:  makeRigEuler(0.04, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(0.04, 0, 0)),
      leftFoot:      makeRigEuler(-0.015, 0, 0),
      rightFoot:     mirrorRigEuler(makeRigEuler(-0.015, 0, 0)),
    };

    if (hasShoulderSlots) {
      const shX = kf([[0,0.02],[0.35,0.18],[0.55,-0.02],[0.70,0.02],[1.0,0.02]]);
      const shZ = kf([[0,-0.68],[0.35,-0.08],[0.55,-0.12],[0.70,-0.38],[1.0,-0.68]]);
      slotOffsets.leftShoulder  = makeRigEuler(shX, 0, -shZ);
      slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(shX, 0, shZ));
    }

    applySlotOffsets(slotOffsets, { x: 0, y: 0, z: 0 });

    // One-shot flourish: stop after a single full swing cycle.
    if (hammerFlourishTime >= hammerFlourishDuration) {
      hammerFlourishActive = false;
      hammerFlourishTime = 0;
      reset();
    }
  }

  function updateWorm(deltaSeconds) {
    wormTime += deltaSeconds;
    const phase = wormTime * 0.9 * Math.PI * 2;
    // Wave travels up the body chain with phase lag at each segment
    const legWave   = Math.sin(phase);
    const hipWave   = Math.sin(phase - Math.PI * 0.45);
    const spineWave = Math.sin(phase - Math.PI * 0.90);
    const chestWave = Math.sin(phase - Math.PI * 1.35);
    const headWave  = Math.sin(phase - Math.PI * 1.80);
    const footWave  = Math.sin(phase);
    const amp = 0.62;

    const slotOffsets = {
      // Prone forward lean as base; hips wave up/down
      hips:  makeRigEuler(1.22 + hipWave * amp, 0, 0),
      spine: makeRigEuler(spineWave * amp * 0.85, 0, 0),
      chest: makeRigEuler(chestWave * amp * 0.75, 0, 0),
      head:  makeRigEuler(-0.15 + headWave * amp * 0.25, 0, 0),
      // Arms in plank/push-up position
      leftUpperArm:  makeRigEuler(0.18, 0, 0.95),
      rightUpperArm: mirrorRigEuler(makeRigEuler(0.18, 0, -0.95)),
      leftLowerArm:  makeRigEuler(1.45, 0, 0),
      rightLowerArm: mirrorRigEuler(makeRigEuler(1.45, 0, 0)),
      leftHand:      makeRigEuler(0.28, 0, 0),
      rightHand:     mirrorRigEuler(makeRigEuler(0.28, 0, 0)),
      // Legs extended back, feet undulate up/down with aggressive lift
      leftUpperLeg:  makeRigEuler(-0.55 + legWave * amp * 0.5, 0, -0.05),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.55 + legWave * amp * 0.5, 0, -0.05)),
      leftLowerLeg:  makeRigEuler(0.12 + footWave * amp * 0.9, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(0.12 + footWave * amp * 0.9, 0, 0)),
      leftFoot:      makeRigEuler(0.55 + footWave * amp * 0.85, 0, 0),
      rightFoot:     mirrorRigEuler(makeRigEuler(0.55 + footWave * amp * 0.85, 0, 0)),
    };

    if (hasShoulderSlots) {
      slotOffsets.leftShoulder  = makeRigEuler(0.02, 0, 0.88);
      slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.02, 0, -0.88));
    }

    const groundY = -0.28 + Math.max(0, hipWave) * 0.18;
    applySlotOffsets(slotOffsets, { x: 0, y: groundY, z: 0 });
  }

  function updateHeadspin(deltaSeconds) {
    headspinTime += deltaSeconds;
    // Spin is applied to the model root in map3d.js so we only need the static tilted pose here.
    // Soft wobble in Z for a slight realistic sway.
    const wobble = Math.sin(headspinTime * 3.2) * 0.04;

    const slotOffsets = {
      // Hips pitched forward so body is nearly inverted (head near floor, legs up)
      hips:  makeRigEuler(2.28, 0, wobble),
      spine: makeRigEuler(-0.45, 0, 0),
      chest: makeRigEuler(-0.30, 0, 0),
      head:  makeRigEuler(0.90, 0, 0),
      // Arms spread wide for balance / flair
      leftUpperArm:  makeRigEuler(0.05, 0, 1.35),
      rightUpperArm: mirrorRigEuler(makeRigEuler(0.05, 0, -1.35)),
      leftLowerArm:  makeRigEuler(0.25, 0, 0),
      rightLowerArm: mirrorRigEuler(makeRigEuler(0.25, 0, 0)),
      leftHand:      makeRigEuler(0.10, 0, 0),
      rightHand:     mirrorRigEuler(makeRigEuler(0.10, 0, 0)),
      // Legs kicked up and spread
      leftUpperLeg:  makeRigEuler(-1.45, 0, -0.30),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(-1.45, 0, 0.30)),
      leftLowerLeg:  makeRigEuler(0.20, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(0.20, 0, 0)),
      leftFoot:      makeRigEuler(0.30, 0, 0),
      rightFoot:     mirrorRigEuler(makeRigEuler(0.30, 0, 0)),
    };

    if (hasShoulderSlots) {
      slotOffsets.leftShoulder  = makeRigEuler(0.02, 0, 1.05);
      slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.02, 0, -1.05));
    }

    // Head stays near Y=0 (on the floor) while hips/legs are up
    applySlotOffsets(slotOffsets, { x: 0, y: -0.55, z: 0 });
  }

  function updateFrontFlip(deltaSeconds) {
    frontFlipTime += deltaSeconds;
    const t = THREE.MathUtils.clamp(frontFlipTime / frontFlipDuration, 0, 1);
    const eio = (v) => v * v * (3 - 2 * v);

    // Phase boundaries
    const CROUCH_END  = 0.18;  // crouch/launch
    const LAND_START  = 0.82;  // start landing
    const AIR_RANGE   = LAND_START - CROUCH_END;

    // Vertical height: parabola only during airborne phase
    let hipsY = 0;
    if (t >= CROUCH_END && t < LAND_START) {
      const airT = (t - CROUCH_END) / AIR_RANGE;
      hipsY = Math.sin(airT * Math.PI) * 3.2; // peak ~3.2 units
    } else if (t < CROUCH_END) {
      // slight crouch dip before launch
      const crouchT = eio(t / CROUCH_END);
      hipsY = -0.18 * Math.sin(crouchT * Math.PI);
    }
    // landing: hipsY stays 0

    // Spin only happens during airborne phase
    let spin = 0;
    if (t >= CROUCH_END && t < LAND_START) {
      const airT = eio((t - CROUCH_END) / AIR_RANGE);
      spin = airT * Math.PI * 2;
    } else if (t >= LAND_START) {
      spin = Math.PI * 2; // finished — lands exactly upright
    }

    // Tuck: peak in the middle of air phase
    let tuck = 0;
    if (t >= CROUCH_END && t < LAND_START) {
      const airT = (t - CROUCH_END) / AIR_RANGE;
      tuck = Math.pow(Math.sin(airT * Math.PI), 1.35);
    }

    // Crouch: compress before jump, absorb on landing
    let crouch = 0;
    if (t < CROUCH_END) {
      crouch = eio(t / CROUCH_END);
    } else if (t >= LAND_START) {
      const landT = eio((t - LAND_START) / (1.0 - LAND_START));
      crouch = Math.sin(landT * Math.PI) * 0.6; // brief impact dip
    }

    const slotOffsets = {
      hips:       makeRigEuler(spin + crouch * 0.2, 0, 0),
      spine:      makeRigEuler(spin, 0, 0),
      chest:      makeRigEuler(spin, 0, 0),
      head:       makeRigEuler(spin - tuck * 0.2, 0, 0),
      leftUpperArm:  makeRigEuler(0.25 + tuck * 0.65, 0.05, -0.35),
      rightUpperArm: mirrorRigEuler(makeRigEuler(0.25 + tuck * 0.65, 0.05, -0.35)),
      leftLowerArm:  makeRigEuler(0.35 + tuck * 0.9, 0, 0),
      rightLowerArm: mirrorRigEuler(makeRigEuler(0.35 + tuck * 0.9, 0, 0)),
      leftHand:      makeRigEuler(tuck * 0.2, 0, -0.08),
      rightHand:     mirrorRigEuler(makeRigEuler(tuck * 0.2, 0, -0.08)),
      leftUpperLeg:  makeRigEuler(-0.1 + tuck * 1.05 + crouch * 0.55, 0, -0.05),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.1 + tuck * 1.05 + crouch * 0.55, 0, -0.05)),
      leftLowerLeg:  makeRigEuler(tuck * 1.1 + crouch * 0.65, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(tuck * 1.1 + crouch * 0.65, 0, 0)),
      leftFoot:      makeRigEuler(-0.1 + tuck * 0.25, 0, 0),
      rightFoot:     mirrorRigEuler(makeRigEuler(-0.1 + tuck * 0.25, 0, 0)),
    };

    applySlotOffsets(slotOffsets, { x: 0, y: hipsY, z: 0 });

    if (t >= 1) {
      frontFlipActive = false;
      frontFlipTime = 0;
      return false;
    }
    return true;
  }

  function updateIdle(deltaSeconds) {
    walkTime += deltaSeconds * 0.55;
    const breathe = Math.sin(walkTime * Math.PI * 1.2);
    const sway = Math.sin(walkTime * Math.PI * 0.6);

    const slotOffsets = {
      hips: makeRigEuler(0, sway * 0.02, sway * 0.01),
      spine: makeRigEuler(0.01 + breathe * 0.01, sway * 0.012, 0),
      chest: makeRigEuler(0.018 + breathe * 0.014, sway * 0.02, 0),
      head: makeRigEuler(-0.01 + breathe * 0.008, -sway * 0.018, 0),
      leftUpperLeg: makeRigEuler(-0.025, 0, -0.015),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.025, 0, -0.015)),
      leftLowerLeg: makeRigEuler(0.04, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(0.04, 0, 0)),
      leftFoot: makeRigEuler(-0.015, 0, 0),
      rightFoot: mirrorRigEuler(makeRigEuler(-0.015, 0, 0)),
    };

    if (useConservativeIdle) {
      // Source rigs keep a mild neutral arm drop to avoid rigid T-pose.
      if (hasShoulderSlots) {
        slotOffsets.leftShoulder = makeRigEuler(0.02, 0, -0.68);
        slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.02, 0, -0.68));
      }
      const upperArmDrop = hasShoulderSlots ? 0.68 : 1.04;
      slotOffsets.leftUpperArm = makeRigEuler(0.035, 0, upperArmDrop);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(0.035, 0, upperArmDrop));
      slotOffsets.leftLowerArm = makeRigEuler(0.14 + breathe * 0.015, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.14 + breathe * 0.015, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.045, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.045, 0, 0);
    } else {
      slotOffsets.leftUpperArm = makeRigEuler(0.04, 0, 1.42);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(0.04, 0, 1.42));
      slotOffsets.leftLowerArm = makeRigEuler(0.07 + breathe * 0.02, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.07 + breathe * 0.02, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.03, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.03, 0, 0);
    }

    applySlotOffsets(slotOffsets, { x: 0, y: breathe * 0.01 - 0.01, z: 0 });
  }

  function updateFlyingIdle(deltaSeconds) {
    walkTime += deltaSeconds * 0.35;
    const hover = Math.sin(walkTime * Math.PI * 0.8) * 0.04;
    const breathe = Math.sin(walkTime * Math.PI * 1.0);
    const sway = Math.sin(walkTime * Math.PI * 0.5);

    const slotOffsets = {
      hips: makeRigEuler(-0.35, sway * 0.02, 0),
      spine: makeRigEuler(breathe * 0.02, sway * 0.01, 0),
      chest: makeRigEuler(0.12 + breathe * 0.015, sway * 0.015, 0),
      head: makeRigEuler(0.05, -sway * 0.01, 0),
      leftUpperLeg: makeRigEuler(0.15, 0, -0.08),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(0.15, 0, -0.08)),
      leftLowerLeg: makeRigEuler(-0.2, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(-0.2, 0, 0)),
      leftFoot: makeRigEuler(0.05, 0, 0),
      rightFoot: mirrorRigEuler(makeRigEuler(0.05, 0, 0)),
    };

    if (useConservativeIdle) {
      if (hasShoulderSlots) {
        slotOffsets.leftShoulder = makeRigEuler(0.05, 0, -0.55);
        slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.05, 0, -0.55));
      }
      const upperArmDrop = hasShoulderSlots ? 0.55 : 1.1;
      slotOffsets.leftUpperArm = makeRigEuler(-0.05, 0, upperArmDrop);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(-0.05, 0, upperArmDrop));
      slotOffsets.leftLowerArm = makeRigEuler(0.25 + breathe * 0.02, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.25 + breathe * 0.02, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.08, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.08, 0, 0);
    } else {
      slotOffsets.leftUpperArm = makeRigEuler(-0.08, 0.25, 1.25);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(-0.08, 0.25, 1.25));
      slotOffsets.leftLowerArm = makeRigEuler(0.35 + breathe * 0.02, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.35 + breathe * 0.02, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.1, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.1, 0, 0);
    }

    applySlotOffsets(slotOffsets, { x: 0, y: hover, z: 0 });
  }

  function updateFlyingMoving(deltaSeconds, moveAlpha) {
    walkTime += deltaSeconds * (0.6 + moveAlpha * 1.2);
    const phase = walkTime * Math.PI * 2;
    const armFlap = Math.sin(phase) * 0.18;
    const bodyBob = Math.sin(phase * 0.5) * 0.08;
    const tilt = Math.sin(phase * 0.5) * 0.12 * moveAlpha;
    const legPedal = Math.sin(phase) * 0.12 * moveAlpha;

    const slotOffsets = {
      hips: makeRigEuler(-0.25 + tilt, Math.sin(phase) * 0.03, 0),
      spine: makeRigEuler(tilt * 0.5, 0, 0),
      chest: makeRigEuler(0.15 + tilt * 0.3, 0, 0),
      head: makeRigEuler(0.08 - tilt * 0.2, 0, 0),
      leftUpperLeg: makeRigEuler(0.08 + legPedal, 0, -0.06),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(0.08 - legPedal, 0, -0.06)),
      leftLowerLeg: makeRigEuler(-0.15 - legPedal * 0.5, 0, 0),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(-0.15 + legPedal * 0.5, 0, 0)),
      leftFoot: makeRigEuler(0.08, 0, 0),
      rightFoot: mirrorRigEuler(makeRigEuler(0.08, 0, 0)),
    };

    if (useConservativeIdle) {
      if (hasShoulderSlots) {
        slotOffsets.leftShoulder = makeRigEuler(0.08 + armFlap * 0.08, 0, -0.5);
        slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.08 - armFlap * 0.08, 0, -0.5));
      }
      const upperArmDrop = hasShoulderSlots ? 0.5 : 1.0;
      slotOffsets.leftUpperArm = makeRigEuler(armFlap * 0.25 - 0.08, 0, upperArmDrop - armFlap * 0.12);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(-armFlap * 0.25 - 0.08, 0, upperArmDrop + armFlap * 0.12));
      slotOffsets.leftLowerArm = makeRigEuler(0.2 + armFlap * 0.1, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.2 - armFlap * 0.1, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.1, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.1, 0, 0);
    } else {
      slotOffsets.leftUpperArm = makeRigEuler(armFlap * 0.3 - 0.1, 0.2, 1.1 - armFlap * 0.15);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(-armFlap * 0.3 - 0.1, 0.2, 1.1 + armFlap * 0.15));
      slotOffsets.leftLowerArm = makeRigEuler(0.3 + armFlap * 0.12, 0, 0);
      slotOffsets.rightLowerArm = makeRigEuler(0.3 - armFlap * 0.12, 0, 0);
      slotOffsets.leftHand = makeRigEuler(0.12, 0, 0);
      slotOffsets.rightHand = makeRigEuler(0.12, 0, 0);
    }

    applySlotOffsets(slotOffsets, { x: 0, y: bodyBob, z: 0 });
  }

  function update(deltaSeconds, movementSpeed = 0, motionState = null) {
    const isFlying = !!(motionState && motionState.isFlying);

    if (isFlying) {
      const moveAlpha = THREE.MathUtils.clamp(movementSpeed / 3.8, 0, 1);
      if (moveAlpha <= 0.001) {
        updateFlyingIdle(deltaSeconds);
      } else {
        updateFlyingMoving(deltaSeconds, moveAlpha);
      }
      return;
    }
    if (headspinActive) {
      updateHeadspin(deltaSeconds);
      return;
    }

    if (wormActive) {
      updateWorm(deltaSeconds);
      return;
    }

    if (hammerFlourishActive) {
      updateHammerFlourish(deltaSeconds);
      return;
    }

    if (frontFlipActive) {
      updateFrontFlip(deltaSeconds);
      return;
    }

    if (danceActive) {
      updateDance(deltaSeconds);
      return;
    }

    const isAirborne = !!(motionState && motionState.isAirborne);
    const verticalVelocity = Number.isFinite(motionState && motionState.verticalVelocity)
      ? motionState.verticalVelocity
      : 0;

    if (isAirborne) {
      jumpArmTime += deltaSeconds;
      const moveAlphaAir = THREE.MathUtils.clamp(movementSpeed / 3.8, 0, 1);
      const ascendBlend = THREE.MathUtils.clamp(verticalVelocity / 8, 0, 1);
      const descendBlend = THREE.MathUtils.clamp(-verticalVelocity / 9, 0, 1);
      const airBlend = THREE.MathUtils.clamp(0.45 + Math.abs(verticalVelocity) * 0.08, 0.45, 1);
      const armSwing = Math.sin(jumpArmTime * 8.5) * 0.28 * airBlend;
      const chestPitch = (-ascendBlend * 0.12) + (descendBlend * 0.16);
      const hipsPitch = (-ascendBlend * 0.1) + (descendBlend * 0.12);
      const kneeFold = THREE.MathUtils.clamp(0.22 + (descendBlend * 0.35), 0.18, 0.62);

      const slotOffsets = {
        hips: makeRigEuler(hipsPitch, 0, 0),
        spine: makeRigEuler(chestPitch * 0.72, 0, 0),
        chest: makeRigEuler(chestPitch, 0, 0),
        head: makeRigEuler(-chestPitch * 0.45, 0, 0),
        leftUpperLeg: makeRigEuler(-0.18 + kneeFold * 0.25, 0, -0.04),
        rightUpperLeg: mirrorRigEuler(makeRigEuler(-0.18 + kneeFold * 0.25, 0, -0.04)),
        leftLowerLeg: makeRigEuler(kneeFold, 0, 0),
        rightLowerLeg: mirrorRigEuler(makeRigEuler(kneeFold, 0, 0)),
        leftFoot: makeRigEuler(-0.08 + descendBlend * 0.08, 0, 0),
        rightFoot: mirrorRigEuler(makeRigEuler(-0.08 + descendBlend * 0.08, 0, 0)),
      };

      if (useConservativeIdle) {
        const upperArmBase = hasShoulderSlots ? 0.68 : 1.04;
        if (hasShoulderSlots) {
          slotOffsets.leftShoulder = makeRigEuler(0.03 + (ascendBlend * 0.05), 0, -0.7);
          slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.03 + (ascendBlend * 0.05), 0, -0.7));
        }
        slotOffsets.leftUpperArm = makeRigEuler(
          -0.12 + (ascendBlend * 0.28) - (descendBlend * 0.08) + armSwing,
          0,
          upperArmBase - 0.1,
        );
        slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(
          -0.12 + (ascendBlend * 0.28) - (descendBlend * 0.08) - armSwing,
          0,
          upperArmBase - 0.1,
        ));
        slotOffsets.leftLowerArm = makeRigEuler(0.2 + (descendBlend * 0.28), 0, 0);
        slotOffsets.rightLowerArm = mirrorRigEuler(makeRigEuler(0.2 + (descendBlend * 0.28), 0, 0));
        slotOffsets.leftHand = makeRigEuler(0.07 + moveAlphaAir * 0.04, 0, 0);
        slotOffsets.rightHand = mirrorRigEuler(makeRigEuler(0.07 + moveAlphaAir * 0.04, 0, 0));
      } else {
        slotOffsets.leftUpperArm = makeRigEuler(-0.18 + armSwing, 0, 1.26);
        slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(-0.18 - armSwing, 0, 1.26));
        slotOffsets.leftLowerArm = makeRigEuler(0.28 + (descendBlend * 0.2), 0, 0);
        slotOffsets.rightLowerArm = mirrorRigEuler(makeRigEuler(0.28 + (descendBlend * 0.2), 0, 0));
        slotOffsets.leftHand = makeRigEuler(0.08 + moveAlphaAir * 0.05, 0, 0);
        slotOffsets.rightHand = mirrorRigEuler(makeRigEuler(0.08 + moveAlphaAir * 0.05, 0, 0));
      }

      applySlotOffsets(slotOffsets, { x: 0, y: 0, z: 0 });
      return;
    }

    jumpArmTime = 0;

    const moveAlpha = THREE.MathUtils.clamp(movementSpeed / 3.8, 0, 1);
    if (moveAlpha <= 0.001) {
      updateIdle(deltaSeconds);
      return;
    }

    walkTime += deltaSeconds * THREE.MathUtils.lerp(0.75, 1.6, moveAlpha);
    const phase = walkTime * Math.PI * 2;
    const leftStride = Math.sin(phase);
    const rightStride = Math.sin(phase + Math.PI);
    const leftLift = Math.max(0, -leftStride);
    const rightLift = Math.max(0, -rightStride);
    const torsoTurn = Math.sin(phase) * 0.08 * moveAlpha;
    const hipBob = Math.cos(phase * 2) * 0.018 * moveAlpha;
    const slotOffsets = {
      hips: makeRigEuler(0, torsoTurn * 0.7, Math.sin(phase) * 0.05 * moveAlpha),
      spine: makeRigEuler(Math.cos(phase * 2) * 0.03 * moveAlpha, torsoTurn * 0.45, 0),
      chest: makeRigEuler(0, torsoTurn, Math.sin(phase) * 0.04 * moveAlpha),
      head: makeRigEuler(Math.cos(phase * 2) * 0.05 * moveAlpha, torsoTurn * 0.85, 0),
      leftUpperArm: makeRigEuler(rightStride * 0.65 * moveAlpha, 0, -0.12 * moveAlpha),
      rightUpperArm: mirrorRigEuler(makeRigEuler(leftStride * 0.65 * moveAlpha, 0, -0.12 * moveAlpha)),
      leftLowerArm: makeRigEuler((0.18 + rightLift * 0.28) * moveAlpha, 0, -0.04 * moveAlpha),
      rightLowerArm: mirrorRigEuler(makeRigEuler((0.18 + leftLift * 0.28) * moveAlpha, 0, -0.04 * moveAlpha)),
      leftHand: makeRigEuler(rightStride * 0.12 * moveAlpha, 0, -0.05 * moveAlpha),
      rightHand: mirrorRigEuler(makeRigEuler(leftStride * 0.12 * moveAlpha, 0, -0.05 * moveAlpha)),
      leftUpperLeg: makeRigEuler(leftStride * 0.78 * moveAlpha, 0, -0.05 * moveAlpha),
      rightUpperLeg: mirrorRigEuler(makeRigEuler(rightStride * 0.78 * moveAlpha, 0, -0.05 * moveAlpha)),
      leftLowerLeg: makeRigEuler(leftLift * 0.82 * moveAlpha, 0, 0.04 * moveAlpha),
      rightLowerLeg: mirrorRigEuler(makeRigEuler(rightLift * 0.82 * moveAlpha, 0, 0.04 * moveAlpha)),
      leftFoot: makeRigEuler((leftStride * 0.22 - leftLift * 0.25) * moveAlpha, 0, -0.03 * moveAlpha),
      rightFoot: mirrorRigEuler(makeRigEuler((rightStride * 0.22 - rightLift * 0.25) * moveAlpha, 0, -0.03 * moveAlpha)),
    };

    // For source rigs using conservative idle, layer walk swing on top of the idle resting arm pose.
    if (useConservativeIdle) {
      const upperArmBase = hasShoulderSlots ? 0.68 : 1.04;
      if (hasShoulderSlots) {
        slotOffsets.leftShoulder = makeRigEuler(0.02, 0, -0.68);
        slotOffsets.rightShoulder = mirrorRigEuler(makeRigEuler(0.02, 0, -0.68));
      }
      slotOffsets.leftUpperArm = makeRigEuler(rightStride * 0.65 * moveAlpha + 0.035, 0, -0.12 * moveAlpha + upperArmBase);
      slotOffsets.rightUpperArm = mirrorRigEuler(makeRigEuler(leftStride * 0.65 * moveAlpha + 0.035, 0, -0.12 * moveAlpha + upperArmBase));
      slotOffsets.leftLowerArm = makeRigEuler((0.18 + rightLift * 0.28) * moveAlpha + 0.14, 0, -0.04 * moveAlpha);
      slotOffsets.rightLowerArm = mirrorRigEuler(makeRigEuler((0.18 + leftLift * 0.28) * moveAlpha + 0.14, 0, -0.04 * moveAlpha));
      slotOffsets.leftHand = makeRigEuler(rightStride * 0.12 * moveAlpha + 0.045, 0, -0.05 * moveAlpha);
      slotOffsets.rightHand = mirrorRigEuler(makeRigEuler(leftStride * 0.12 * moveAlpha + 0.045, 0, -0.05 * moveAlpha));
    }

    applySlotOffsets(slotOffsets, { x: 0, y: hipBob, z: 0 });
  }

  function toggleDance() {
    // Interrupt any active emote and start dance
    if (hammerFlourishActive || wormActive || headspinActive) {
      hammerFlourishActive = false; hammerFlourishTime = 0;
      wormActive = false; wormTime = 0;
      headspinActive = false; headspinTime = 0;
      danceActive = true;
    } else {
      danceActive = !danceActive;
    }
    if (danceActive) {
      frontFlipActive = false;
      hammerFlourishActive = false;
      wormActive = false;
      headspinActive = false;
      walkTime = 0;
      danceTime = 0;
    } else {
      danceTime = 0;
      reset();
    }
    return danceActive;
  }

  function triggerFrontFlip() {
    frontFlipActive = true;
    danceActive = false; hammerFlourishActive = false;
    wormActive = false; wormTime = 0;
    headspinActive = false; headspinTime = 0;
    frontFlipTime = 0; walkTime = 0;
    return true;
  }

  function triggerHammerFlourish() {
    hammerFlourishActive = true; hammerFlourishTime = 0;
    danceActive = false; frontFlipActive = false;
    wormActive = false; wormTime = 0;
    headspinActive = false; headspinTime = 0;
    walkTime = 0;
    return true;
  }

  function toggleWorm() {
    wormActive = !wormActive;
    if (wormActive) {
      danceActive = false; frontFlipActive = false;
      hammerFlourishActive = false; hammerFlourishTime = 0;
      headspinActive = false; headspinTime = 0;
      wormTime = 0; walkTime = 0;
    } else {
      wormTime = 0;
      reset();
    }
    return wormActive;
  }

  function toggleHeadspin() {
    headspinActive = !headspinActive;
    if (headspinActive) {
      danceActive = false; frontFlipActive = false;
      hammerFlourishActive = false; hammerFlourishTime = 0;
      wormActive = false; wormTime = 0;
      headspinTime = 0; walkTime = 0;
    } else {
      headspinTime = 0;
      reset();
    }
    return headspinActive;
  }

  function getMode() {
    if (frontFlipActive) return 'frontflip';
    if (hammerFlourishActive) return 'hammerflourish';
    if (wormActive) return 'worm';
    if (headspinActive) return 'headspin';
    if (danceActive) return 'dance';
    return 'walk';
  }

  return { update, reset, toggleDance, triggerFrontFlip, triggerHammerFlourish, toggleWorm, toggleHeadspin, getMode };
}

function applyBoneRotationOverridesFallback(fallbackRigState, overrides) {
  if (!fallbackRigState || !overrides || typeof overrides !== 'object') return;

  for (const [boneName, rotation] of Object.entries(overrides)) {
    const bone = fallbackRigState.bones?.get?.(boneName);
    if (bone && rotation && typeof rotation === 'object') {
      bone.rotation.set(rotation.x || 0, rotation.y || 0, rotation.z || 0, 'XYZ');
    }
  }
}

export function sanitizeStoredRigSettings(rigSettings) {
  if (!rigSettings || typeof rigSettings !== 'object') {
    return {
      version: 2,
      useFallbackRig: false,
      mapping: {},
      slotTargetOverrides: {},
      controls: {},
      metricOverrides: {},
      boneRotationOverrides: {},
    };
  }

  return {
    version: typeof rigSettings.version === 'number' ? rigSettings.version : 2,
    useFallbackRig: !!rigSettings.useFallbackRig,
    mapping: rigSettings.mapping && typeof rigSettings.mapping === 'object' ? { ...rigSettings.mapping } : {},
    slotTargetOverrides: rigSettings.slotTargetOverrides && typeof rigSettings.slotTargetOverrides === 'object'
      ? { ...rigSettings.slotTargetOverrides }
      : {},
    controls: rigSettings.controls && typeof rigSettings.controls === 'object' ? { ...rigSettings.controls } : {},
    metricOverrides: rigSettings.metricOverrides && typeof rigSettings.metricOverrides === 'object'
      ? { ...rigSettings.metricOverrides }
      : {},
    boneRotationOverrides: rigSettings.boneRotationOverrides && typeof rigSettings.boneRotationOverrides === 'object'
      ? { ...rigSettings.boneRotationOverrides }
      : {},
  };
}

function createCanonicalRigPipeline(modelRoot, settings) {
  modelRoot.updateMatrixWorld(true);

  // Stage 1: Fit source mesh to a canonical runtime skeleton.
  const canonicalRigState = createFallbackRig(modelRoot, settings.mapping, settings.metricOverrides);
  applyBoneRotationOverridesFallback(canonicalRigState, settings.boneRotationOverrides);

  // Stage 2: Bind mesh influences to the canonical skeleton.
  const canonicalSkinningState = setupRuntimeMeshRebind(modelRoot, canonicalRigState, settings.mapping);

  // Stage 3: Drive all procedural animation on the canonical rig only.
  const canonicalAnimationController = createFallbackWalkController(canonicalRigState);

  return {
    active: canonicalSkinningState.active,
    stats: canonicalSkinningState.stats,
    update(deltaSeconds, movementSpeed, motionState) {
      canonicalAnimationController.update(deltaSeconds, movementSpeed, motionState);
    },
    toggleDance() {
      return canonicalAnimationController.toggleDance();
    },
    triggerFrontFlip() {
      return canonicalAnimationController.triggerFrontFlip();
    },
    triggerHammerFlourish() {
      return canonicalAnimationController.triggerHammerFlourish();
    },
    toggleWorm() {
      return canonicalAnimationController.toggleWorm();
    },
    toggleHeadspin() {
      return canonicalAnimationController.toggleHeadspin();
    },
    getMode() {
      return canonicalAnimationController.getMode();
    },
    dispose() {
      canonicalAnimationController.reset();
      restoreRuntimeMeshRebind(canonicalSkinningState);
      if (canonicalRigState.root && canonicalRigState.root.parent) {
        canonicalRigState.root.parent.remove(canonicalRigState.root);
      }
    },
  };
}

function autoMapSourceRigSlots(modelRoot, mapping = {}) {
  const slots = [
    'hips', 'spine', 'chest', 'head',
    'leftShoulder', 'rightShoulder',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];

  const resolved = {};
  const bones = [];
  modelRoot.traverse((obj) => {
    if (obj && obj.isBone) bones.push(obj);
  });

  function pickByPattern(patterns) {
    for (const bone of bones) {
      const name = (bone.name || '').toLowerCase();
      if (patterns.some((re) => re.test(name))) return bone;
    }
    return null;
  }

  function pickSide(patterns, side) {
    const sideMarkers = side === 'left'
      ? [/(^|[^a-z])(l|left)([^a-z]|$)/, /_l\b/, /\.l\b/]
      : [/(^|[^a-z])(r|right)([^a-z]|$)/, /_r\b/, /\.r\b/];

    for (const bone of bones) {
      const name = (bone.name || '').toLowerCase();
      if (!patterns.some((re) => re.test(name))) continue;
      if (sideMarkers.some((re) => re.test(name))) return bone;
    }

    // Fallback when side tags are missing: choose by X world position.
    const candidates = bones.filter((bone) => {
      const name = (bone.name || '').toLowerCase();
      return patterns.some((re) => re.test(name));
    });
    if (!candidates.length) return null;

    let best = candidates[0];
    let bestX = modelRoot.worldToLocal(best.getWorldPosition(new THREE.Vector3())).x;
    for (let i = 1; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const x = modelRoot.worldToLocal(candidate.getWorldPosition(new THREE.Vector3())).x;
      if ((side === 'left' && x < bestX) || (side === 'right' && x > bestX)) {
        best = candidate;
        bestX = x;
      }
    }
    return best;
  }

  const slotPatterns = {
    hips: [/(hip|pelvis|root)/],
    spine: [/(spine(1|_1|01)?|abdomen)/],
    chest: [/(chest|spine2|spine_2|upperchest|thorax)/],
    head: [/(head|skull)/],
    leftShoulder: [/(clavicle|collar|shoulder)/],
    rightShoulder: [/(clavicle|collar|shoulder)/],
    leftUpperArm: [/(upperarm|arm)/],
    rightUpperArm: [/(upperarm|arm)/],
    leftLowerArm: [/(lowerarm|forearm|elbow)/],
    rightLowerArm: [/(lowerarm|forearm|elbow)/],
    leftHand: [/(hand|wrist)/],
    rightHand: [/(hand|wrist)/],
    leftUpperLeg: [/(thigh|upleg|upperleg|leg)/],
    rightUpperLeg: [/(thigh|upleg|upperleg|leg)/],
    leftLowerLeg: [/(calf|shin|lowerleg|knee)/],
    rightLowerLeg: [/(calf|shin|lowerleg|knee)/],
    leftFoot: [/(foot|ankle)/],
    rightFoot: [/(foot|ankle)/],
  };

  slots.forEach((slot) => {
    const mappedName = mapping[slot];
    const mappedBone = mappedName ? getRigBone(modelRoot, mappedName) : null;
    if (mappedBone) {
      resolved[slot] = mappedBone.name;
      return;
    }

    if (slot.startsWith('left')) {
      const picked = pickSide(slotPatterns[slot], 'left');
      if (picked) resolved[slot] = picked.name;
      return;
    }
    if (slot.startsWith('right')) {
      const picked = pickSide(slotPatterns[slot], 'right');
      if (picked) resolved[slot] = picked.name;
      return;
    }

    const picked = pickByPattern(slotPatterns[slot]);
    if (picked) resolved[slot] = picked.name;
  });

  return resolved;
}

function createSourceRigAnimationPipeline(modelRoot, settings) {
  modelRoot.updateMatrixWorld(true);

  const slotNames = [
    'hips', 'spine', 'chest', 'head',
    'leftShoulder', 'rightShoulder',
    'leftUpperArm', 'rightUpperArm',
    'leftLowerArm', 'rightLowerArm',
    'leftHand', 'rightHand',
    'leftUpperLeg', 'rightUpperLeg',
    'leftLowerLeg', 'rightLowerLeg',
    'leftFoot', 'rightFoot',
  ];

  const bones = new Map();
  const mapping = autoMapSourceRigSlots(
    modelRoot,
    settings.mapping && typeof settings.mapping === 'object' ? settings.mapping : {}
  );
  slotNames.forEach((slot) => {
    const mappedName = mapping[slot] || slot;
    const bone = getRigBone(modelRoot, mappedName);
    if (bone) bones.set(slot, bone);
  });

  // Prefer animating the source skeleton whenever we can resolve a meaningful subset,
  // to preserve one-to-one appearance with character creation.
  const minimumSlots = ['hips', 'spine', 'chest', 'leftUpperLeg', 'rightUpperLeg'];
  const resolvedMinimum = minimumSlots.filter((slot) => bones.has(slot)).length;
  if (resolvedMinimum < 3 || bones.size < 6) return null;

  const sourceRigState = {
    root: modelRoot,
    bones,
  };

  const sourceAnimationController = createFallbackWalkController(sourceRigState, { useConservativeIdle: true });
  return {
    active: true,
    stats: { meshCount: 0, remappedInfluences: 0, autoWeightedMeshes: 0, convertedMeshes: 0 },
    update(deltaSeconds, movementSpeed, motionState) {
      sourceAnimationController.update(deltaSeconds, movementSpeed, motionState);
    },
    toggleDance() {
      return sourceAnimationController.toggleDance();
    },
    triggerFrontFlip() {
      return sourceAnimationController.triggerFrontFlip();
    },
    triggerHammerFlourish() {
      return sourceAnimationController.triggerHammerFlourish();
    },
    toggleWorm() {
      return sourceAnimationController.toggleWorm();
    },
    toggleHeadspin() {
      return sourceAnimationController.toggleHeadspin();
    },
    getMode() {
      return sourceAnimationController.getMode();
    },
    dispose() {
      sourceAnimationController.reset();
    },
  };
}

export function buildCanonicalRigPipeline(modelRoot, rigSettings) {
  const settings = sanitizeStoredRigSettings(rigSettings);
  if (!modelRoot) {
    return {
      active: false,
      update() {},
      dispose() {},
      stats: { meshCount: 0, remappedInfluences: 0, autoWeightedMeshes: 0, convertedMeshes: 0 },
      pipeline: {
        skeletonFit: false,
        skinningBound: false,
        animationBound: false,
      },
    };
  }

  if (settings.useFallbackRig) {
    const pipelineRuntime = createCanonicalRigPipeline(modelRoot, settings);
    return {
      ...pipelineRuntime,
      pipeline: {
        skeletonFit: true,
        skinningBound: true,
        animationBound: true,
      },
    };
  }

  const sourceRuntime = createSourceRigAnimationPipeline(modelRoot, settings);
  if (sourceRuntime) {
    return {
      ...sourceRuntime,
      pipeline: {
        skeletonFit: true,
        skinningBound: true,
        animationBound: true,
      },
    };
  }

  // Final fallback: canonical rig/rebind to keep map controls and animations functional.
  const fallbackRuntime = createCanonicalRigPipeline(modelRoot, settings);
  return {
    ...fallbackRuntime,
    pipeline: {
      skeletonFit: true,
      skinningBound: true,
      animationBound: true,
    },
  };
}

export function applyStoredAvatarRig(modelRoot, rigSettings) {
  const runtime = buildCanonicalRigPipeline(modelRoot, rigSettings);
  return {
    active: runtime.active,
    stats: runtime.stats,
    update: runtime.update,
    reset: runtime.reset,
    toggleDance: runtime.toggleDance,
    triggerFrontFlip: runtime.triggerFrontFlip,
    triggerHammerFlourish: runtime.triggerHammerFlourish,
    toggleWorm: runtime.toggleWorm,
    toggleHeadspin: runtime.toggleHeadspin,
    getMode: runtime.getMode,
    dispose: runtime.dispose,
  };
}

/**
 * Find the right-hand bone on a character model by checking the rig settings
 * mapping first, then falling back to bone name pattern matching.
 */
export function findRigHandBone(modelRoot, rigSettings) {
  if (!modelRoot) return null;
  const mapping = (rigSettings && typeof rigSettings === 'object' && rigSettings.mapping) || {};
  const rightHandName = mapping.rightHand;
  if (rightHandName) {
    let found = null;
    modelRoot.traverse((node) => { if (!found && node.name === rightHandName) found = node; });
    if (found) return found;
  }
  // Pattern fallback
  let found = null;
  modelRoot.traverse((node) => {
    if (found) return;
    const n = node.name.toLowerCase();
    if (/(right.*hand|r.*hand|hand.*right|hand.*r|r_hand|hand_r)\b/.test(n)) found = node;
  });
  return found;
}