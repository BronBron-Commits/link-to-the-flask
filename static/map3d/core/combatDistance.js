export const FEET_PER_UNIT = 5; // 1 Three.js unit = 5 feet (D&D standard)
export const FEET_PER_SQUARE = 5; // D&D uses 5 ft increments
export const COMBAT_TILE_FEET = 5; // 5-ft snap grid (D&D standard square)

// BG3-style zone colours
export const MOVE_ZONE_COLOR = 0x00e8ff;
export const MOVE_DEST_COLOR = 0x00ffcc;

// Combat distance tuning: values < 1 make actors effectively feel closer for checks.
export const COMBAT_DISTANCE_SCALE = 0.85;

export const DND_RANGES = {
    melee: 8, // widened melee range for smoother close combat feel
    shortbow: 80,
    longsword: 8,
    fireball: 150,
    spellRange30: 30,
    spellRange60: 60,
    spellRange120: 120,
    heavyCrossbow: 100,
};

export const OPPORTUNITY_ATTACK_TRIGGER_CHANCE = 0.55;
export const RETREAT_TRIP_TRIGGER_CHANCE = 0.2;
export const RETREAT_TRIP_MOVE_PENALTY_FEET = 5;

// Visual nudge so training dummies sit on the floor instead of hovering.
export const TRAINING_DUMMY_Y_OFFSET = -0.25;

export function unitsToFeet(units) {
    return Number(units) * FEET_PER_UNIT;
}

export function feetToUnits(feet) {
    return Number(feet) / FEET_PER_UNIT;
}

export function getDistance(a, b) {
    return a.distanceTo(b);
}

export function getDistanceFeet(a, b) {
    return unitsToFeet(getDistance(a, b));
}

// Flat (XZ-only) distance in feet, ignoring height delta for combat checks.
export function getFlatDistanceFeet(a, b) {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return unitsToFeet(Math.sqrt((dx * dx) + (dz * dz)));
}

// Edge-to-edge distance in feet.
// a: object with .position and optional .radius (in units)
// b: object with .position and optional .userData.radius (in units)
export function getEdgeDistanceFeet(a, b) {
    const flat = getFlatDistanceFeet(a.position, b.position);
    const rA = a.radius || 0;
    const rB = (b.userData && b.userData.radius) || 0;
    return Math.max(0, flat - unitsToFeet(rA + rB));
}

export function getEffectiveCombatDistanceFeet(a, b) {
    return getEdgeDistanceFeet(a, b) * COMBAT_DISTANCE_SCALE;
}

export function getDistanceInSquares(a, b) {
    return Math.ceil(getDistanceFeet(a, b) / FEET_PER_SQUARE);
}

export function worldToGrid(pos) {
    return {
        x: Math.round(pos.x / FEET_PER_UNIT),
        z: Math.round(pos.z / FEET_PER_UNIT),
        y: Math.round(pos.y / FEET_PER_UNIT),
    };
}

export function gridDistance(gridA, gridB) {
    const dx = Math.abs(gridA.x - gridB.x);
    const dz = Math.abs(gridA.z - gridB.z);
    return Math.max(dx, dz);
}

export function gridDistanceFromWorld(posA, posB) {
    const gridA = worldToGrid(posA);
    const gridB = worldToGrid(posB);
    return gridDistance(gridA, gridB);
}

export function canReachInFeet(entityPos, targetPos, rangeInFeet) {
    return getDistanceFeet(entityPos, targetPos) <= rangeInFeet;
}

export function canReachInSquares(entityPos, targetPos, rangeInSquares) {
    return gridDistanceFromWorld(entityPos, targetPos) <= rangeInSquares;
}
