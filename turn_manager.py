"""
TURN MANAGER — Turn cycle and enemy AI.

Single path for all turn advancement regardless of who calls it.
Both player end-turns and DM force-advances go through advance_and_resolve(),
which automatically resolves consecutive enemy turns so the caller always
gets back the next *player* turn (or None on an empty order).
"""
import random
import time

import gevent
from flask_socketio import emit

from extensions import socketio
import game_state as gs
import reaction_system
from state_sync import broadcast_world


# ---------------------------------------------------------------------------
# Core turn advancement
# ---------------------------------------------------------------------------

def evaluate_combat_end() -> str | None:
    """Return the authoritative combat outcome once one side can no longer act."""
    combat = gs.world_state.get("combat", {})
    state = combat.get("state", {}) if isinstance(combat, dict) else {}
    if not bool(state.get("inCombat")):
        return None

    players_alive = [
        sid for sid, entry in gs.players.items()
        if isinstance(entry, dict)
        and gs.normalize_role(entry.get("role")) == "player"
        and not gs.is_player_downed(entry)
    ]
    entities = gs.world_state.get("entities", {})
    enemies_alive = [
        eid for eid, entity in (entities.items() if isinstance(entities, dict) else [])
        if gs.is_enemy(entity) and not gs.is_enemy_downed(entity)
    ]
    print(f"[COMBAT-EVAL] players_alive={players_alive}", flush=True)
    print(f"[COMBAT-EVAL] enemies_alive={enemies_alive}", flush=True)

    if not players_alive:
        return "players_defeated"
    if not enemies_alive:
        return "players_victorious"
    return None


def conclude_combat_if_needed(initiator_sid: str | None = None) -> str | None:
    """Finalize combat immediately when the result is decided."""
    result = evaluate_combat_end()
    if not result:
        return None

    print(f"[COMBAT-END] conclude_combat_if_needed firing: result={result} initiator={initiator_sid}", flush=True)

    combat = gs.world_state.get("combat", {})
    state = combat.get("state", {}) if isinstance(combat, dict) else {}
    resolved_initiator = str(initiator_sid or state.get("initiator") or "").strip()
    rounds = max(1, int(gs.safe_float(state.get("roundNumber", 1), 1)))
    removed_enemy_ids = gs.prune_defeated_enemies() if result == "players_victorious" else []

    socketio.emit("combat-ended", {
        "result": result,
        "rounds": rounds,
        "winner": "players" if result == "players_victorious" else "enemies",
        "removedEnemyIds": removed_enemy_ids,
    })
    end_combat(resolved_initiator)
    return result

def _advance_turn() -> dict | None:
    """Increment the turn index by one. Returns the new turn payload or None."""
    combat = gs.world_state.setdefault("combat", {})
    state = combat.setdefault("state", {})
    order = combat.get("order") or []
    if not order:
        print("[TURN] advance called with empty order", flush=True)
        return None

    idx = int(combat.get("turn") if combat.get("turn") is not None else -1)
    rnd = max(1, int(gs.safe_float(state.get("roundNumber", 1))))

    idx += 1
    if idx >= len(order):
        idx = 0
        rnd += 1

    combat["turn"] = idx
    state["roundNumber"] = rnd
    actor = order[idx]
    if isinstance(actor, dict) and str(actor.get("type") or "").strip().lower() == "player":
        owner_sid = str(actor.get("ownerSid") or "").strip() or gs.sid_for_actor(str(actor.get("id") or ""))
        if owner_sid and isinstance(gs.players.get(owner_sid), dict):
            gs.set_player_dodge_active(gs.players[owner_sid], False)
    print(f"[TURN] idx={idx}/{len(order)-1} actor={actor.get('id')} round={rnd}", flush=True)
    return {
        "turnIndex": idx,
        "order": order,
        "roundNumber": rnd,
        "currentActor": actor,
    }


def advance_and_resolve() -> dict | None:
    """Advance the turn and auto-resolve any consecutive enemy turns.

    Returns the turn payload for the next *player* turn, or None if the order
    is empty or a resolution failure occurs.

    Must be called inside gs.turn_lock.
    """
    if conclude_combat_if_needed() is not None:
        return None

    while True:
        turn_data = _advance_turn()
        if turn_data is None:
            return None
        actor = turn_data.get("currentActor") or {}
        if not gs.is_combat_actor_active(actor):
            if conclude_combat_if_needed() is not None:
                return None
            continue
        if actor.get("type") != "enemy":
            # Next up is a player — return and let the caller broadcast.
            return turn_data
        # Show all clients that this enemy is the active actor, then resolve.
        socketio.emit("combat-turn", turn_data)
        run_enemy_turn(actor)
        if conclude_combat_if_needed() is not None:
            return None
        # Loop: continue advancing until we land on a player turn.


# ---------------------------------------------------------------------------
# Enemy AI
# ---------------------------------------------------------------------------

def run_enemy_turn(enemy_actor: dict) -> dict:
    """Resolve an enemy turn server-side and broadcast the result to all clients."""
    actor_id = str((enemy_actor or {}).get("id") or "enemy")
    print(f"[ENEMY TURN START] {actor_id}", flush=True)

    target_sid = _choose_enemy_target(enemy_actor)
    print(f"[ENEMY] target selection for {actor_id}: target_sid={target_sid}", flush=True)
    if not target_sid or not isinstance(gs.players.get(target_sid), dict):
        print(f"[ENEMY] no valid target for {actor_id} — looking for fallback", flush=True)
        # Fallback: find ANY player
        for sid, player in gs.players.items():
            if isinstance(player, dict) and gs.normalize_role(player.get("role")) == "player":
                target_sid = sid
                print(f"[ENEMY] fallback target selected: {sid}", flush=True)
                break
        if not target_sid or not isinstance(gs.players.get(target_sid), dict):
            print(f"[ENEMY] still no valid target for {actor_id} after fallback", flush=True)
            return {"attacker": actor_id, "type": "none", "reason": "no-target"}

    start_ms = int(time.time() * 1000)
    timeline_id = f"enemy-turn-{actor_id}-{start_ms}"

    target = gs.players[target_sid]
    # Use networkId as canonical player actor_id (consistent with entityId for enemies)
    target_actor_id = str(target.get("networkId") or target.get("actorId") or target_sid or "")
    player_pos = target.get("position") if isinstance(target.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
    print(f"[ENEMY] target actor_id={target_actor_id}", flush=True)

    entities = gs.world_state.setdefault("entities", {})
    enemy = entities.setdefault(actor_id, {
        "id": actor_id, "type": "enemy",
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
    })
    if gs.is_enemy_downed(enemy):
        print(f"[ENEMY] {actor_id} is downed; skipping turn", flush=True)
        return {"attacker": actor_id, "type": "none", "reason": "downed"}
    e_pos = enemy.get("position") if isinstance(enemy.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
    ex = gs.safe_float(e_pos.get("x"))
    ey = gs.safe_float(e_pos.get("y"))
    ez = gs.safe_float(e_pos.get("z"))
    px = gs.safe_float(player_pos.get("x"))
    pz = gs.safe_float(player_pos.get("z"))

    # Step 1: decide movement tactic.
    dx, dz = px - ex, pz - ez
    dist = max(0.001, (dx * dx + dz * dz) ** 0.5)
    enemy_hp = gs.safe_float(enemy.get("hp", enemy.get("maxHp", 1)), 1)
    enemy_max_hp = max(1.0, gs.safe_float(enemy.get("maxHp", enemy_hp), enemy_hp))
    low_hp = (enemy_hp / enemy_max_hp) <= 0.35

    # Threat detection: any player in melee range can provoke reaction.
    threatened = False
    closest_player_pos = None
    closest_player_dist = 1e9
    for _, p in gs.players.items():
        if not isinstance(p, dict):
            continue
        if gs.normalize_role(p.get("role")) != "player":
            continue
        if gs.safe_float(p.get("hp", p.get("max_hp", 0)), 0) <= 0:
            continue
        ppos = p.get("position") if isinstance(p.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
        pd = ((gs.safe_float(ppos.get("x", 0.0)) - ex) ** 2 + (gs.safe_float(ppos.get("z", 0.0)) - ez) ** 2) ** 0.5
        if pd <= 5.0:
            threatened = True
        if pd < closest_player_dist:
            closest_player_dist = pd
            closest_player_pos = ppos

    is_disengage_move = False
    used_dash = False
    if low_hp and threatened:
        # Retreat behavior: disengage if possible, otherwise dash away (can provoke).
        can_disengage = bool(enemy.get("canDisengage", True))
        is_disengage_move = can_disengage
        used_dash = not can_disengage
        retreat_step = 10.0 if used_dash else 5.0
        if closest_player_pos is not None:
            rx = ex - gs.safe_float(closest_player_pos.get("x", 0.0))
            rz = ez - gs.safe_float(closest_player_pos.get("z", 0.0))
            rdist = max(0.001, (rx * rx + rz * rz) ** 0.5)
            new_x = ex + (rx / rdist) * retreat_step
            new_z = ez + (rz / rdist) * retreat_step
        else:
            new_x = ex
            new_z = ez + retreat_step
        action_label = "DISENGAGE" if is_disengage_move else "DASH"
        print(f"[ENEMY] {actor_id} low HP retreat using {action_label}", flush=True)
    else:
        # Default behavior: close distance; use dash if very far.
        used_dash = dist > 12.0
        max_step = 10.0 if used_dash else 5.0
        step = min(max_step, dist)
        new_x = ex + (dx / dist) * step
        new_z = ez + (dz / dist) * step

    start_pos = {"x": ex, "y": ey, "z": ez}
    enemy["position"] = {"x": new_x, "y": ey, "z": new_z}
    print(f"[ENEMY] {actor_id} moved to ({new_x:.1f}, {new_z:.1f})", flush=True)
    socketio.emit("entity-move", {"id": actor_id, "position": enemy["position"]})

    # Trigger player reactions if enemy leaves melee range without disengage.
    reactions = reaction_system.trigger_reactions("leave_melee_range", {
        "moverActorId": actor_id,
        "moverActorType": "enemy",
        "startPos": start_pos,
        "endPos": enemy["position"],
        "isDisengage": is_disengage_move,
    })
    gevent.sleep(0.5)

    if gs.is_enemy_downed(enemy):
        print(f"[ENEMY] {actor_id} was downed by reactions; ending turn early", flush=True)
        return {
            "attacker": actor_id,
            "type": "none",
            "reason": "downed-by-reaction",
            "reactionCount": len(reactions),
        }

    if low_hp and threatened:
        socketio.emit("combat-action-record", {
            "record": {
                "type": "enemy-retreat",
                "actorId": actor_id,
                "targetId": target_actor_id or None,
                "attackType": "melee",
                "result": "RETREAT",
                "damage": 0,
                "disengage": is_disengage_move,
                "dash": used_dash,
                "reactionsTriggered": len(reactions),
            },
            "startTimeMs": start_ms,
            "timelineId": timeline_id,
        })
        print(f"[ENEMY TURN END] {actor_id} retreat", flush=True)
        return {
            "attacker": actor_id,
            "type": "retreat",
            "disengage": is_disengage_move,
            "dash": used_dash,
            "reactionCount": len(reactions),
        }

    # Step 2: only attack if now in melee range.
    remaining = ((px - new_x) ** 2 + (pz - new_z) ** 2) ** 0.5
    if remaining >= 6.0:
        print(f"[ENEMY] {actor_id} out of range ({remaining:.1f} ft), ending turn after move", flush=True)
        socketio.emit("combat-action-record", {
            "record": {
                "type": "enemy-move", "actorId": actor_id,
                "targetId": target_actor_id or None,
                "attackType": "melee", "result": "MOVE", "damage": 0,
            },
            "startTimeMs": start_ms, "timelineId": timeline_id,
        })
        print(f"[ENEMY TURN END] {actor_id}", flush=True)
        return {"attacker": actor_id, "type": "move", "hit": False, "damage": 0}

    # Step 3: resolve attack.
    entity_data = entities.get(actor_id) or {}
    atk_bonus = int(gs.safe_float(entity_data.get("attackBonus", 4), 4))
    dmg_die = max(1, int(gs.safe_float(entity_data.get("damageRoll", 6), 6)))
    dmg_bonus = int(gs.safe_float(entity_data.get("damageBonus", 0), 0))
    dmg_notation = f"1d{dmg_die}+{dmg_bonus}" if dmg_bonus > 0 else f"1d{dmg_die}"

    print(f"[ENEMY] {actor_id} in range, attacking target {target_actor_id}: AB={atk_bonus} DMG={dmg_notation}", flush=True)
    target_ac = int(gs.safe_float(target.get("ac", 10), 10))
    dodge_active = gs.is_player_dodge_active(target)
    first_roll = random.randint(1, 20)
    second_roll = random.randint(1, 20) if dodge_active else None
    hit_roll = min(first_roll, second_roll) if second_roll is not None else first_roll
    total = hit_roll + atk_bonus
    is_hit = hit_roll == 20 or (hit_roll != 1 and total >= target_ac)
    damage = max(0, random.randint(1, dmg_die) + dmg_bonus) if is_hit else 0

    print(f"[ENEMY] {actor_id} roll={hit_roll} vs AC={target_ac}: total={total} hit={is_hit} damage={damage}", flush=True)
    if is_hit:
        current_hp = gs.safe_float(target.get("hp", 100.0), 100.0)
        target["hp"] = max(0.0, current_hp - float(damage))
        if target["hp"] <= 0.0:
            gs.mark_player_downed(target)
        print(f"[ENEMY] {actor_id} HIT! target HP: {current_hp:.1f} -> {target['hp']:.1f}", flush=True)

    event = {
        "attacker": actor_id, "actorType": "enemy", "type": "attack",
        "targetId": target_actor_id or None,
        "hitRoll": hit_roll, "attackBonus": atk_bonus, "toHit": total,
        "targetAC": target_ac, "hit": is_hit, "damage": damage,
        "dodgeDisadvantage": dodge_active,
        "hitRolls": [first_roll, second_roll] if second_roll is not None else [first_roll],
        "targetHp": gs.safe_float(target.get("hp", 0.0), 0.0),
        "targetState": str(target.get("state") or "active"),
    }
    socketio.emit("combat-action-record", {
        "record": {
            "type": "enemy-attack", "actorId": actor_id,
            "targetId": target_actor_id or None, "attackType": "melee",
            "result": "HIT" if is_hit else "MISS", "damage": damage,
        },
        "startTimeMs": start_ms, "timelineId": timeline_id,
    })
    socketio.emit("combat-action-result", event)
    gevent.sleep(0.7)
    print(f"[ENEMY TURN END] {actor_id}", flush=True)
    return event


# ---------------------------------------------------------------------------
# Combat lifecycle
# ---------------------------------------------------------------------------

def start_combat(
    initiator_sid: str,
    target_id: str | None = None,
    approver: str | None = None,
) -> None:
    """Transition to combat mode and initialise the turn order."""
    for entry in gs.players.values():
        gs.clear_combatant_state(entry)
    entities = gs.world_state.get("entities", {})
    if isinstance(entities, dict):
        for entity in entities.values():
            gs.clear_combatant_state(entity)

    gs.world_state["mode"] = "combat"
    order = gs.build_turn_order(initiator_sid)
    combat_state: dict = {"inCombat": True, "initiator": initiator_sid, "roundNumber": 1}
    if approver:
        combat_state["approvedBy"] = approver
    if target_id:
        combat_state["targetId"] = target_id
    gs.world_state["combat"] = {"turn": 0, "order": order, "state": combat_state}

    # Log all entities available at combat start
    entities = gs.world_state.get("entities", {})
    print(f"[COMBAT START] combat_entities={list(entities.keys())}", flush=True)
    print(f"[COMBAT START] turn_order={[e.get('id') for e in order]}", flush=True)
    print(f"[COMBAT START] target_id={target_id}", flush=True)

    if target_id:
        if isinstance(entities, dict) and isinstance(entities.get(target_id), dict):
            print(f"[COMBAT] target {target_id} found in entities", flush=True)
            gs.ensure_enemy_registered(target_id)
        else:
            print(f"[COMBAT] target_id NOT in entities: {target_id}", flush=True)
            print(f"[COMBAT] ignoring unknown target_id at start: {target_id}", flush=True)

    socketio.emit("combat-state", {
        "serverSeq": gs.next_event_sequence(),
        "active": True, "initiator": initiator_sid,
        "targetId": target_id, "mode": "combat", "approvedBy": approver,
    })
    socketio.emit("combat-turn", gs.build_combat_turn_payload())
    socketio.emit("combat-full-state", gs.world_state.get("combat", {}))
    broadcast_world(include_scene=False)


def end_combat(initiator_sid: str) -> None:
    """Return to exploration mode and clear the turn order."""
    gs.world_state["mode"] = "exploration"
    gs.world_state["combat"] = {"turn": None, "order": [], "state": {"inCombat": False}}
    socketio.emit("combat-state", {
        "serverSeq": gs.next_event_sequence(),
        "active": False,
        "initiator": initiator_sid,
        "mode": "exploration",
    })
    socketio.emit("combat-full-state", gs.world_state.get("combat", {}))
    socketio.emit("combat-reset", {})
    broadcast_world(include_scene=False)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _choose_enemy_target(enemy_actor: dict) -> str | None:
    """Return the SID of the best target for an enemy this turn."""
    state = gs.world_state.get("combat", {}).get("state", {})
    initiator = str(state.get("initiator") or "").strip()
    if initiator and initiator in gs.players:
        entry = gs.players[initiator]
        if isinstance(entry, dict) and gs.normalize_role(entry.get("role")) == "player":
            return initiator
    order = gs.world_state.get("combat", {}).get("order") or []
    for e in order:
        if not isinstance(e, dict) or str(e.get("type") or "").strip().lower() != "player":
            continue
        owner = str(e.get("ownerSid") or "").strip()
        if owner in gs.players:
            return owner
        resolved = gs.sid_for_actor(str(e.get("id") or "").strip())
        if resolved:
            return resolved
    return None
