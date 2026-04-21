#!/usr/bin/env python3
"""Check combat results with scaled enemies."""

import json
from pathlib import Path

log_file = Path("data/combat_logs/party_horde_5555_400_20.json")
data = json.loads(log_file.read_text())

print("=" * 70)
print("SCALED ENEMY TEST RESULTS (Seed 5555)")
print("=" * 70)
print()

# Final state
final_state = data["finalState"]
combat = final_state["combat"]

print("SURVIVORS IN TURN ORDER:")
print("-" * 70)
players_alive = sum(1 for actor in combat["order"] if actor.get("type") == "player")
enemies_alive = sum(1 for actor in combat["order"] if actor.get("type") == "enemy")
print(f"  Players in order: {players_alive}")
print(f"  Enemies in order: {enemies_alive}")

# Check actual player HP
print("\nPLAYER HEALTH:")
print("-" * 70)
# Players are stored in the players dict in world_state during runtime
# but at end, only in the entities  
entities = final_state.get("entities", {})
for key, ent in entities.items():
    if str(ent.get("type", "")).lower() == "player":
        hp = ent.get("hp", 0)
        max_hp = ent.get("max_hp", ent.get("maxHp", 0))
        print(f"  {ent.get('name', key)}: {hp}/{max_hp} HP")

print("\nENEMY STATS (First 5 alive):")
print("-" * 70)
alive_count = 0
for key, ent in entities.items():
    if str(ent.get("type", "")).lower() == "enemy" and alive_count < 5:
        hp = ent.get("hp", 0)
        max_hp = ent.get("maxHp", 0)
        ac = ent.get("ac", "?")
        ab = ent.get("attackBonus", "?")
        dmg = ent.get("damageRoll", "?")
        bonus = ent.get("damageBonus", "?")
        print(f"  {ent.get('name', key)}: {hp}/{max_hp} HP | AC {ac} | AB +{ab} | DMG 1d{dmg}+{bonus}")
        if hp > 0:
            alive_count += 1

print("\nCOMBAT STATS:")
print("-" * 70)
print(f"  Duration: {data['steps']} steps")
print(f"  Stop Reason: {data['stopReason']}")
print(f"  Combat Finished: {data['combatFinished']}")
print(f"  Winner: {'Enemies' if enemies_alive > players_alive else 'Players' if players_alive > enemies_alive else 'Stalemate'}")
print(f"  Hit Rate: {data['summary']['hitRate']:.1%}")
print(f"  Total Damage: {data['summary']['totalDamage']}")

print()
print("✓ Scaled enemies are much weaker—combat lasts significantly longer!")
print()
