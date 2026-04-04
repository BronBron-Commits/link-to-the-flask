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
from state_sync import broadcast_world


# ---------------------------------------------------------------------------
# Core turn advancement
# ---------------------------------------------------------------------------

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
    while True:
        turn_data = _advance_turn()
        if turn_data is None:
            return None
        actor = turn_data.get("currentActor") or {}
        if actor.get("type") != "enemy":
            # Next up is a player — return and let the caller broadcast.
            return turn_data
        # Show all clients that this enemy is the active actor, then resolve.
        socketio.emit("combat-turn", turn_data)
        run_enemy_turn(actor)
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
    target_actor_id = str(target.get("networkId") or target.get("actorId") or "")
    player_pos = target.get("position") if isinstance(target.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}

    entities = gs.world_state.setdefault("entities", {})
    enemy = entities.setdefault(actor_id, {
        "id": actor_id, "type": "enemy",
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
    })
    e_pos = enemy.get("position") if isinstance(enemy.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
    ex = gs.safe_float(e_pos.get("x"))
    ey = gs.safe_float(e_pos.get("y"))
    ez = gs.safe_float(e_pos.get("z"))
    px = gs.safe_float(player_pos.get("x"))
    pz = gs.safe_float(player_pos.get("z"))

    # Step 1: move toward the player.
    dx, dz = px - ex, pz - ez
    dist = max(0.001, (dx * dx + dz * dz) ** 0.5)
    step = min(5.0, dist)
    new_x = ex + (dx / dist) * step
    new_z = ez + (dz / dist) * step
    enemy["position"] = {"x": new_x, "y": ey, "z": new_z}
    print(f"[ENEMY] {actor_id} moving toward {target_sid}: dist={dist:.1f}, step={step:.1f} to ({new_x:.1f}, {new_z:.1f})", flush=True)
    socketio.emit("entity-move", {"id": actor_id, "position": enemy["position"]})
    gevent.sleep(0.5)

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

    print(f"[ENEMY] {actor_id} in range, attacking target {target_actor_id}: AB={atk_bonus} DMG={dmg_die}d+{dmg_bonus}", flush=True)
    hit_roll = random.randint(1, 20)
    total = hit_roll + atk_bonus
    target_ac = int(gs.safe_float(target.get("ac", 10), 10))
    is_hit = hit_roll == 20 or (hit_roll != 1 and total >= target_ac)
    damage = max(0, random.randint(1, dmg_die) + dmg_bonus) if is_hit else 0

    print(f"[ENEMY] {actor_id} roll={hit_roll} vs AC={target_ac}: total={total} hit={is_hit} damage={damage}", flush=True)
    if is_hit:
        current_hp = gs.safe_float(target.get("hp", 100.0), 100.0)
        target["hp"] = max(0.0, current_hp - float(damage))
        print(f"[ENEMY] {actor_id} HIT! target HP: {current_hp:.1f} -> {target['hp']:.1f}", flush=True)

    event = {
        "attacker": actor_id, "actorType": "enemy", "type": "attack",
        "targetId": target_actor_id or None,
        "hitRoll": hit_roll, "attackBonus": atk_bonus, "toHit": total,
        "targetAC": target_ac, "hit": is_hit, "damage": damage,
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
    socketio.emit("combat-state", {"active": False, "initiator": initiator_sid, "mode": "exploration"})
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
