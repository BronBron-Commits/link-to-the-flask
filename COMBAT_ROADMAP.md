# Combat System Completeness Roadmap

## Current State (✅ Complete)
- Deterministic combat loop with seeded RNG
- Multi-actor turn order management
- State hashing and replay
- Dead entity pruning
- Combat end state finalization
- Basic attack/dodge actions
- JSON timeline export

## Current Gaps (❌ Missing)

### TIER 1: Must-Have Next (Foundation for deeper systems)

#### 1️⃣ Reactions System
**Why**: Enables opportunity attacks, shield spell, counterspell (later)
- Interrupt hooks (movement, being attacked)
- Reaction resource per turn
- Opportunity attack triggers on melee range exit

**Data model**:
```json
{
  "reactions": {
    "available": 1,
    "used": 0
  }
}
```

**Mechanics needed**:
- Movement tracking (position before/after)
- Melee range detection (5ft typical)
- Reaction resolution during action

---

#### 2️⃣ Inventory + Use Object Action
**Why**: Makes items matter; enables potion usage, weapon switching
- Each entity has inventory array
- Equipped slots (weapon, armor, offhand)
- Use Object action to consume/equip

**Data model**:
```json
{
  "inventory": [
    {"id": "potion_1", "type": "consumable", "effect": "heal", "value": 20},
    {"id": "sword_1", "type": "weapon", "damage": "1d8", "properties": ["finesse"]}
  ],
  "equipped": {
    "weapon": "sword_1",
    "armor": "leather",
    "offhand": null
  }
}
```

**Mechanics needed**:
- Item consumption/depletion
- Effect application (healing, buffs)
- Inventory mutation during combat

---

#### 3️⃣ Additional Movement Actions
**Why**: Expands tactical options; required for opportunity attacks
- **Disengage**: Move without triggering opportunity attacks
- **Dash**: Double movement (uses action)

**Implementation**:
- Track previous position each turn
- Check melee distance on move completion
- Allow reaction only if not disengaged

---

#### 4️⃣ Death Saves / Downed System
**Why**: Dramatically improves pacing; enables rescue mechanics
- At 0 HP: Enter downed state (unconscious)
- Each turn: Make death save (DC 10)
  - 10+: Success (1 toward stabilization)
  - <10: Failure (1 toward death, 3 = dead)
- 3 successes → stabilize (stable unconscious)
- 3 failures → death
- Healing while downed → conscious at low HP

**Data model**:
```json
{
  "state": {
    "downed": false,
    "deathSaves": {"successes": 0, "failures": 0}
  }
}
```

**Mechanics needed**:
- DC 10 roll during downed turn
- Failure on critical hit (18-20 from enemy attack)
- Success on critical success (death save is 20)
- State machine: alive → downed → dead/stable/recovered

---

### TIER 2: Deep Polish (After Tier 1)

#### 5️⃣ Conditions System
**Minimum conditions for 5e parity**:
- Prone (disadvantage on ranged attacks, melee attacks within 5ft have advantage)
- Stunned (can't move or take actions)
- Poisoned (disadvantage on attack rolls)
- Restrained (speed 0, disadvantage on Dex saves)
- Unconscious (can't move/act, automatically fail Str/Dex saves)

**Data model**:
```json
{
  "conditions": [
    {"name": "prone", "duration": -1},  // -1 = until cured
    {"name": "poisoned", "duration": 3}  // 3 rounds
  ]
}
```

---

#### 6️⃣ Advantage/Disadvantage Full Integration
**Currently hints at this; needs full**:
- Attack rolls: roll 2d20, take higher (advantage) or lower (disadvantage)
- When triggered:
  - Advantage: Help action, some spells, positioning (optional)
  - Disadvantage: Prone (ranged), conditions, status effects
- Display in logs as `[ROLL 1d20+5 with advantage: 18+5=23]`

---

#### 7️⃣ Multi-Attack Support
**Why**: Enemies feel stronger without being tank-ier
```json
{
  "multiAttack": {
    "attacks": 2,
    "used": 0
  }
}
```

**Each entity can define**:
- Number of attacks per turn
- Sequence (e.g., 2 weapon-1, 1 weapon-2)

---

### TIER 3: Advanced (Nice-to-Have)

#### 8️⃣ AI Behavior Improvements
- **Target selection**: Lowest HP < closest < random
- **Position awareness**: Melee vs ranged positioning
- **Resource management**: Use disengage when low HP
- **Focus fire**: Priority targeting

---

#### 9️⃣ Damage Types & Resistances
```json
{
  "damage": {
    "type": "slashing",
    "value": 8
  },
  "resistances": ["fire", "cold"],
  "vulnerabilities": ["radiant"],
  "immunities": []
}
```

---

#### 🔟 Spell System (Phase 2)
- Resource system (spell slots or mana)
- Spell list with:
  - Attack spell (single target, ranged damage)
  - AoE spell (area effect)
  - Utility (healing, buffs)
- Targeting types: single/area/self

---

## Implementation Plan

### Phase 1: Reactions + Opportunity Attacks (Tier 1.1)
**Files to modify**:
- `game_state.py` - Add reaction tracking
- `action_handler.py` - Add opportunity attack triggering
- `combat_harness.py` - Add movement tracking hooks

**Tests needed**:
- Entity moves out of melee range → opportunity attack triggered
- Entity disengages → no opportunity attack
- Reaction already used → opportunity attack denied

---

### Phase 2: Inventory + Items (Tier 1.2)
**Files to create**:
- `item_system.py` - Item definitions, effects
- `inventory_manager.py` - Inventory queries, mutations

**Files to modify**:
- `game_state.py` - Add inventory/equipped to entity
- `action_handler.py` - Add USE_OBJECT action

**Tests needed**:
- Use potion from inventory → healing applied
- Inventory depletes when consumed
- Invalid items → action denied

---

### Phase 3: Additional Actions (Tier 1.3)
**Files to modify**:
- `action_handler.py` - Add DISENGAGE, DASH actions
- `turn_manager.py` - Update action validation

---

### Phase 4: Death Saves (Tier 1.4)
**Files to modify**:
- `game_state.py` - Add downed state
- `turn_manager.py` - Add death save roll logic
- `combat_harness.py` - Update finish condition (3 failures → actual death)

---

## Integration Points

Each Tier 1 item enhances the deterministic harness:

✅ **Reactions**: Movement tracking in per-step diff
✅ **Inventory**: Item state changes in entity diffs
✅ **New actions**: Action denial reasons in step records
✅ **Death saves**: New turn actions during downed state

All replay-compatible via existing JSON timeline.

---

## Success Metrics

After Tier 1:
- Combat lasts 50-100% longer (tactical choices)
- Encounters feel more D&D-like
- Player decisions matter beyond "attack or dodge"
- Replay shows rich action variety

After Tier 2:
- Conditions add environmental/status puzzle-solving
- Advantage/disadvantage create tactics around positioning
- Multi-attack makes enemy variety visible

After Tier 3:
- Full 5e mechanics coverage
- Custom encounters feasible
- Balance tuning via resistance/damage types

---

## Questions for Implementation

1. **Inventory implementation**: 
   - Should items be defined in entity JSON at start?
   - Or loaded from item database?

2. **Opportunity attacks**:
   - Always triggered, or does entity "choose" to take reaction?
   - For now: automatic (simpler for AI)

3. **Death saves**:
   - Should they happen automatically each turn?
   - Or do they count as an action?
   - For now: automatic, separate from action economy

4. **Conditions**:
   - Should they auto-expire after duration?
   - Who can apply/remove them?
   - For now: auto-expire, manually applied by action effects

5. **Priority**:
   - All Tier 1 at once, or staggered?
   - Suggestions: Disengage/Dash first (isolated), then Death Saves, then Inventory, then Reactions (interdependent)
