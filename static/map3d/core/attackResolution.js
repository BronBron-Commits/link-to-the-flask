export function createAttackResolutionService(options = {}) {
    const consumeDmOverride = typeof options.consumeDmOverride === 'function'
        ? options.consumeDmOverride
        : (resolution) => resolution;
    const trainingDummyDamage = Number(options.trainingDummyDamage) || 1;
    const getFallbackTargetAc = typeof options.getFallbackTargetAc === 'function'
        ? options.getFallbackTargetAc
        : () => 12;

    function getAttackConfig(attackType = 'melee') {
        const configs = {
            melee: { attackBonus: 5, damageDie: 8, damageBonus: 2 },
            ranged: { attackBonus: 4, damageDie: 6, damageBonus: 1 },
        };
        return configs[attackType] || configs.melee;
    }

    function getAttackPreview(_attacker, target, attackType = 'melee') {
        const config = getAttackConfig(attackType);
        const targetAC = Number(target?.userData?.ac) || 12;
        let successCount = 0;

        // Deterministic preview only. No RNG in UI hover/preview paths.
        for (let roll = 1; roll <= 20; roll += 1) {
            if (roll === 1) continue;
            if (roll === 20 || (roll + config.attackBonus) >= targetAC) {
                successCount += 1;
            }
        }

        const hitChance = successCount / 20;
        return {
            attackType,
            attackBonus: config.attackBonus,
            targetAC,
            hitChance,
            hitChancePct: Math.round(hitChance * 100),
            damageMin: 1 + config.damageBonus,
            damageMax: config.damageDie + config.damageBonus,
        };
    }

    function resolveAttack(_attacker, target, attackType = 'melee') {
        const roll = Math.floor(Math.random() * 20) + 1;
        const config = getAttackConfig(attackType);
        const attackBonus = config.attackBonus;
        const total = roll + attackBonus;
        const targetAC = Number(target?.userData?.ac) || 12;
        const hit = total >= targetAC;
        let damageRoll = 0;
        const damageBonus = config.damageBonus;

        if (hit) {
            damageRoll = Math.floor(Math.random() * config.damageDie) + 1;
        }

        let resultType = 'normal';
        if (roll === 20) resultType = 'crit';
        if (roll === 1) resultType = 'fumble';

        return consumeDmOverride({
            roll,
            attackBonus,
            total,
            targetAC,
            hit,
            damageRoll,
            damageBonus,
            totalDamage: damageRoll + damageBonus,
            resultType,
            attackType,
        });
    }

    function resolveEnemyAttack(enemy, target) {
        const roll = Math.floor(Math.random() * 20) + 1;
        const attackBonus = Number.isFinite(enemy?.userData?.attackBonus)
            ? enemy.userData.attackBonus
            : 4;
        const targetAC = Number.isFinite(target?.ac)
            ? target.ac
            : (Number(getFallbackTargetAc(target)) || 12);
        const total = roll + attackBonus;
        const hit = total >= targetAC;
        const damageRoll = hit ? Math.max(1, Number(enemy?.userData?.damageRoll) || trainingDummyDamage) : 0;
        const damageBonus = hit ? Math.max(0, Number(enemy?.userData?.damageBonus) || 0) : 0;
        let resultType = 'normal';
        if (roll === 20) resultType = 'crit';
        if (roll === 1) resultType = 'fumble';

        return consumeDmOverride({
            roll,
            attackBonus,
            total,
            targetAC,
            hit,
            damageRoll,
            damageBonus,
            totalDamage: damageRoll + damageBonus,
            resultType,
            attackType: 'melee',
        });
    }

    return {
        getAttackConfig,
        getAttackPreview,
        resolveAttack,
        resolveEnemyAttack,
    };
}
