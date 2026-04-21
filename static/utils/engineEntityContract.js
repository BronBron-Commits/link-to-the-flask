const DEFAULT_SCHEMA_URL = '/static/engine_entity.schema.json';

let cachedValidator = null;
let cachedSchemaSignature = '';

export const ITEM_DB = {
    shield: {
        id: 'shield',
        name: 'Shield',
        type: 'armor',
        slot: 'off_hand',
        acBonus: 2,
        weight: 6,
        stackable: false,
    },
    chain_mail: {
        id: 'chain_mail',
        name: 'Chain Mail',
        type: 'armor',
        slot: 'armor',
        weight: 55,
        stackable: false,
    },
    longsword: {
        id: 'longsword',
        name: 'Longsword',
        type: 'weapon',
        slot: 'main_hand',
        damage: '1d8',
        damageType: 'slashing',
        weight: 3,
        stackable: false,
    },
    javelin: {
        id: 'javelin',
        name: 'Javelin',
        type: 'weapon',
        slot: 'main_hand',
        damage: '1d6',
        damageType: 'piercing',
        weight: 2,
        stackable: true,
    },
    rations: {
        id: 'rations',
        name: 'Rations',
        type: 'consumable',
        slot: null,
        weight: 2,
        stackable: true,
    },
    health_potion: {
        id: 'health_potion',
        name: 'Health Potion',
        type: 'consumable',
        slot: null,
        weight: 1,
        stackable: true,
        healDice: '2d4+2',
        healFlat: 7,
    },
};

function toItemKey(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function resolveItemDefinition(itemId) {
    const key = toItemKey(itemId);
    if (ITEM_DB[key]) return ITEM_DB[key];
    return {
        id: key || 'unknown_item',
        name: String(itemId || 'Unknown Item'),
        type: 'misc',
        slot: null,
        weight: 0,
        stackable: true,
    };
}

function computeInventoryWeight(items = []) {
    let total = 0;
    for (const item of items) {
        const def = resolveItemDefinition(item.itemId);
        const qty = asNumber(item.qty, 0);
        const unitWeight = Number.isFinite(Number(def.weight)) ? Number(def.weight) : 0;
        total += unitWeight * qty;
    }
    return total;
}

function asNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function d20() {
    return 1 + Math.floor(Math.random() * 20);
}

function rollDice(formula) {
    const text = String(formula || '').trim();
    const m = text.match(/^(\d+)d(\d+)([+-]\d+)?$/i);
    if (!m) return 0;

    const count = Number(m[1]);
    const sides = Number(m[2]);
    const bonus = m[3] ? Number(m[3]) : 0;
    if (!Number.isFinite(count) || !Number.isFinite(sides) || count <= 0 || sides <= 0) return 0;

    let total = 0;
    for (let i = 0; i < count; i++) {
        total += 1 + Math.floor(Math.random() * sides);
    }
    return total + bonus;
}

function rollDamage(damage) {
    if (!damage || typeof damage !== 'object') return 0;
    if (Number.isFinite(Number(damage.flat))) return Number(damage.flat);
    if (typeof damage.dice === 'string') return rollDice(damage.dice);
    return 0;
}

function fallbackValidateEntitySchema(entity) {
    const errors = [];

    const isNumber = (value) => Number.isFinite(Number(value));
    const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

    if (!isObject(entity)) {
        return [{ message: 'entity must be an object' }];
    }

    if (typeof entity.id !== 'string') errors.push({ message: 'id must be string' });
    if (typeof entity.name !== 'string') errors.push({ message: 'name must be string' });
    if (!isObject(entity.inventory)) errors.push({ message: 'inventory must be object' });

    if (!isObject(entity.combat)) {
        errors.push({ message: 'combat must be object' });
    } else {
        ['hp', 'maxHp', 'ac', 'initiative', 'speed'].forEach((key) => {
            if (!isNumber(entity.combat[key])) {
                errors.push({ message: `combat.${key} must be number` });
            }
        });
    }

    if (!isObject(entity.stats)) {
        errors.push({ message: 'stats must be object' });
    } else {
        ['str', 'dex', 'con', 'int', 'wis', 'cha'].forEach((key) => {
            if (!isNumber(entity.stats[key])) {
                errors.push({ message: `stats.${key} must be number` });
            }
        });
    }

    if (entity.skills != null) {
        if (!isObject(entity.skills)) {
            errors.push({ message: 'skills must be object' });
        } else {
            Object.entries(entity.skills).forEach(([skillKey, skill]) => {
                if (!isObject(skill)) {
                    errors.push({ message: `skills.${skillKey} must be object` });
                    return;
                }
                if (!isNumber(skill.value)) {
                    errors.push({ message: `skills.${skillKey}.value must be number` });
                }
                if (typeof skill.proficient !== 'boolean') {
                    errors.push({ message: `skills.${skillKey}.proficient must be boolean` });
                }
            });
        }
    }

    if (entity.inventory != null) {
        if (!isObject(entity.inventory)) {
            errors.push({ message: 'inventory must be object' });
        } else {
            if (entity.inventory.capacity != null && !isNumber(entity.inventory.capacity)) {
                errors.push({ message: 'inventory.capacity must be number' });
            }
            if (entity.inventory.weight != null && !isNumber(entity.inventory.weight)) {
                errors.push({ message: 'inventory.weight must be number' });
            }
            if (!Array.isArray(entity.inventory.items)) {
                errors.push({ message: 'inventory.items must be array' });
            } else {
                entity.inventory.items.forEach((row, idx) => {
                    if (!isObject(row)) {
                        errors.push({ message: `inventory.items[${idx}] must be object` });
                        return;
                    }
                    if (typeof row.instanceId !== 'string') {
                        errors.push({ message: `inventory.items[${idx}].instanceId must be string` });
                    }
                    if (typeof row.itemId !== 'string') {
                        errors.push({ message: `inventory.items[${idx}].itemId must be string` });
                    }
                    if (!isNumber(row.qty)) {
                        errors.push({ message: `inventory.items[${idx}].qty must be number` });
                    }
                    if (row.equipped != null && typeof row.equipped !== 'boolean') {
                        errors.push({ message: `inventory.items[${idx}].equipped must be boolean` });
                    }
                    if (row.slot != null && typeof row.slot !== 'string') {
                        errors.push({ message: `inventory.items[${idx}].slot must be string` });
                    }
                });
            }
        }
    }

    return errors;
}

function resolveWeaponFromInventory(entity, itemInstance) {
    const def = resolveItemDefinition(itemInstance?.itemId);
    if (def.type !== 'weapon') return null;

    const keyedWeapons = Array.isArray(entity?.weapons) ? entity.weapons : [];
    const key = toItemKey(def.id);
    const match = keyedWeapons.find((w) => toItemKey(w?.name) === key || toItemKey(w?.itemId) === key) || null;

    const resolvedDamage = match?.damage || {
        dice: typeof def.damage === 'string' ? def.damage : null,
        flat: Number.isFinite(Number(def.damageFlat)) ? Number(def.damageFlat) : null,
        type: def.damageType || null,
    };

    return {
        itemId: def.id,
        name: def.name,
        attackBonus: asNumber(match?.attackBonus, 0),
        damage: resolvedDamage,
    };
}

export function equipItem(entity, itemRef) {
    if (!entity || !entity.inventory || !Array.isArray(entity.inventory.items)) return false;

    const items = entity.inventory.items;
    const instance = typeof itemRef === 'string'
        ? items.find((i) => i.instanceId === itemRef) || null
        : itemRef;
    if (!instance) return false;

    const def = resolveItemDefinition(instance.itemId);
    const slot = instance.slot || def.slot || null;

    if (slot) {
        for (const item of items) {
            if (item !== instance && item.slot === slot) {
                item.equipped = false;
            }
        }
    }

    instance.equipped = true;
    if (slot) instance.slot = slot;

    const weapon = resolveWeaponFromInventory(entity, instance);
    if (weapon) {
        entity.combat.weapon = weapon;
    }
    return true;
}

export function useItem(entity, itemRef) {
    if (!entity || !entity.inventory || !Array.isArray(entity.inventory.items)) return false;

    const items = entity.inventory.items;
    const instance = typeof itemRef === 'string'
        ? items.find((i) => i.instanceId === itemRef) || null
        : itemRef;
    if (!instance) return false;

    const def = resolveItemDefinition(instance.itemId);
    if (def.id === 'health_potion') {
        const heal = typeof def.healDice === 'string'
            ? Math.max(0, rollDice(def.healDice))
            : asNumber(def.healFlat, 7);
        entity.combat.hp = Math.min(entity.combat.maxHp, asNumber(entity.combat.hp, 0) + heal);
        instance.qty = Math.max(0, asNumber(instance.qty, 0) - 1);
        return true;
    }

    return false;
}

async function resolveAjvConstructor() {
    if (typeof globalThis !== 'undefined' && typeof globalThis.Ajv === 'function') {
        return globalThis.Ajv;
    }

    try {
        const nodeMod = await import('ajv');
        if (typeof nodeMod.default === 'function') return nodeMod.default;
    } catch (_err) {
        // Browser/no-package path fallback.
    }

    try {
        const webMod = await import('https://esm.sh/ajv@8');
        if (typeof webMod.default === 'function') return webMod.default;
    } catch (_err) {
        // Final fallback to structural validator.
    }

    return null;
}

export async function createEntityValidator(schema) {
    const signature = JSON.stringify(schema || {});
    if (cachedValidator && cachedSchemaSignature === signature) {
        return cachedValidator;
    }

    const AjvCtor = await resolveAjvConstructor();
    if (!AjvCtor) {
        cachedValidator = {
            backend: 'fallback',
            validate: (entity) => {
                const errors = fallbackValidateEntitySchema(entity);
                return {
                    valid: errors.length === 0,
                    errors,
                };
            },
        };
        cachedSchemaSignature = signature;
        return cachedValidator;
    }

    const ajv = new AjvCtor({ allErrors: true, strict: false });
    const validateFn = ajv.compile(schema);

    cachedValidator = {
        backend: 'ajv',
        validate: (entity) => {
            const valid = validateFn(entity);
            return {
                valid: !!valid,
                errors: validateFn.errors || [],
            };
        },
    };
    cachedSchemaSignature = signature;
    return cachedValidator;
}

export async function fetchSchema(schemaUrl = DEFAULT_SCHEMA_URL) {
    const res = await fetch(schemaUrl, { cache: 'no-cache' });
    if (!res.ok) {
        throw new Error(`Failed to fetch schema: ${schemaUrl} (${res.status})`);
    }
    return await res.json();
}

export async function validateEntity(entity, options = {}) {
    const schema = options.schema || await fetchSchema(options.schemaUrl || DEFAULT_SCHEMA_URL);
    const validator = await createEntityValidator(schema);
    const result = validator.validate(entity);

    if (!result.valid) {
        console.error('Entity validation failed:', result.errors);
        throw new Error('Invalid engine_entity contract');
    }

    return {
        ok: true,
        backend: validator.backend,
    };
}

export const FEATURE_RULES = {
    divine_smite: (_entity) => ({
        onHit: (ctx) => {
            if (!ctx || typeof ctx !== 'object') return;
            const extra = rollDice('2d8');
            ctx.damage = asNumber(ctx.damage, 0) + extra;
        },
    }),
    basic_attack: (_entity) => ({
        attack: ({ attackBonus = 0, damage = null } = {}) => ({
            roll: d20() + asNumber(attackBonus, 0),
            damage: rollDamage(damage),
        }),
    }),
    spell_casting: (_entity) => ({
        cast: ({ spellName = 'Spell' } = {}) => ({
            ok: true,
            spellName,
            timestamp: Date.now(),
        }),
    }),
};

export function bindFeatures(features = [], entity = null) {
    return (Array.isArray(features) ? features : []).map((feature) => {
        const ruleId = feature && typeof feature.ruleId === 'string' ? feature.ruleId : null;
        if (!ruleId) return { ...feature };

        const ruleFactory = FEATURE_RULES[ruleId];
        if (typeof ruleFactory !== 'function') return { ...feature };

        return {
            ...feature,
            runtime: ruleFactory(entity),
        };
    });
}

export async function loadEntity(data, options = {}) {
    await validateEntity(data, options);

    const entity = {
        id: data.id,
        name: data.name,
        combat: {
            hp: asNumber(data.combat?.hp, 0),
            maxHp: asNumber(data.combat?.maxHp, asNumber(data.combat?.hp, 0)),
            ac: asNumber(data.combat?.ac, 10),
            initiative: asNumber(data.combat?.initiative, 0),
            speed: asNumber(data.combat?.speed, 30),
            turnState: 'idle',
        },
        stats: {
            str: asNumber(data.stats?.str, 10),
            dex: asNumber(data.stats?.dex, 10),
            con: asNumber(data.stats?.con, 10),
            int: asNumber(data.stats?.int, 10),
            wis: asNumber(data.stats?.wis, 10),
            cha: asNumber(data.stats?.cha, 10),
        },
        skills: data.skills && typeof data.skills === 'object' ? structuredClone(data.skills) : {},
        inventory: {
            capacity: asNumber(data.inventory?.capacity, 0),
            weight: asNumber(data.inventory?.weight, 0),
            items: (Array.isArray(data.inventory?.items) ? data.inventory.items : []).map((item) => {
                const def = resolveItemDefinition(item.itemId);
                return {
                    instanceId: String(item.instanceId || ''),
                    itemId: String(item.itemId || ''),
                    qty: asNumber(item.qty, 0),
                    equipped: !!item.equipped,
                    slot: item.slot || def.slot || null,
                };
            }),
        },
        weapons: (Array.isArray(data.weapons) ? data.weapons : []).map((weapon) => ({
            ...weapon,
            itemId: toItemKey(weapon.itemId || weapon.name),
            attack: () => ({
                roll: d20() + asNumber(weapon.attackBonus, 0),
                damage: rollDamage(weapon.damage),
            }),
        })),
        spells: Array.isArray(data.spells) ? structuredClone(data.spells) : [],
        features: bindFeatures(Array.isArray(data.features) ? data.features : [], data),
    };

    if (!entity.inventory.weight || entity.inventory.weight <= 0) {
        entity.inventory.weight = computeInventoryWeight(entity.inventory.items);
    }

    let equippedWeapon = null;
    for (const item of entity.inventory.items) {
        if (!item.equipped) continue;
        equippedWeapon = resolveWeaponFromInventory(entity, item);
        if (equippedWeapon) break;
    }
    if (!equippedWeapon) {
        const firstWeaponInstance = entity.inventory.items.find((item) => resolveItemDefinition(item.itemId).type === 'weapon') || null;
        if (firstWeaponInstance) {
            equipItem(entity, firstWeaponInstance);
            equippedWeapon = resolveWeaponFromInventory(entity, firstWeaponInstance);
        }
    }
    if (equippedWeapon) {
        entity.combat.weapon = equippedWeapon;
    }

    return entity;
}

export async function loadEngineEntityFromUrls(urls, options = {}) {
    for (const url of urls) {
        try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (!res.ok) continue;
            const json = await res.json();
            const entity = await loadEntity(json, options);
            return {
                entity,
                sourceUrl: url,
            };
        } catch (_err) {
            // Try next contract path.
        }
    }
    throw new Error('No valid engine_entity contract found at provided URLs.');
}
