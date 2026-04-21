"""
ACTION HANDLER — Validate and apply every client action against server state.

All actions — whether from a player or a dummy — go through the same
validation gates before touching world_state. Nothing is applied without
a passing check.
"""
import random

from flask_socketio import emit

from extensions import socketio
import game_state as gs
import reaction_system
from turn_manager import advance_and_resolve, conclude_combat_if_needed
from state_sync import broadcast_world, broadcast_lobby


def _actor_position(actor_id: str, actor_type: str, sid: str | None = None) -> dict:
    if actor_type == "player":
        entry = gs.players.get(sid or "") if sid else None
        if not isinstance(entry, dict):
            resolved = gs.sid_for_actor(actor_id)
            entry = gs.players.get(resolved) if resolved else None
        if isinstance(entry, dict) and isinstance(entry.get("position"), dict):
            p = entry["position"]
            return {
                "x": gs.safe_float(p.get("x", 0.0)),
                "y": gs.safe_float(p.get("y", 0.0)),
                "z": gs.safe_float(p.get("z", 0.0)),
            }
        return {"x": 0.0, "y": 0.0, "z": 0.0}

    entities = gs.world_state.get("entities", {})
    row = entities.get(actor_id) if isinstance(entities, dict) else None
    if isinstance(row, dict) and isinstance(row.get("position"), dict):
        p = row["position"]
        return {
            "x": gs.safe_float(p.get("x", 0.0)),
            "y": gs.safe_float(p.get("y", 0.0)),
            "z": gs.safe_float(p.get("z", 0.0)),
        }
    return {"x": 0.0, "y": 0.0, "z": 0.0}


def _distance_2d(a: dict, b: dict) -> float:
    dx = gs.safe_float(a.get("x", 0.0)) - gs.safe_float(b.get("x", 0.0))
    dz = gs.safe_float(a.get("z", 0.0)) - gs.safe_float(b.get("z", 0.0))
    return (dx * dx + dz * dz) ** 0.5


def _movement_budget_for(action_type: str, entry: dict) -> float:
    base = max(5.0, gs.safe_float(entry.get("speed_ft", 30.0), 30.0))
    if action_type == "dash":
        return base * 2.0
    return base


def _attack_range_profile(weapon: dict, attacker_pos: dict, target_pos: dict) -> dict:
    attack_mode = str(weapon.get("attackMode") or "melee").strip().lower()
    reach_ft = max(5.0, gs.safe_float(weapon.get("reachFt", 5.0), 5.0))
    range_ft = max(0.0, gs.safe_float(weapon.get("rangeFt", 0.0), 0.0))
    long_range_ft = max(range_ft, gs.safe_float(weapon.get("longRangeFt", range_ft), range_ft))
    distance_ft = _distance_2d(attacker_pos, target_pos)

    if attack_mode == "melee":
        return {
            "distanceFt": distance_ft,
            "reachFt": reach_ft,
            "rangeFt": range_ft,
            "longRangeFt": long_range_ft,
            "rangeBand": "melee" if distance_ft <= reach_ft else "out-of-range",
            "allowed": distance_ft <= reach_ft,
            "disadvantage": False,
        }

    if attack_mode == "thrown":
        if distance_ft <= reach_ft:
            return {
                "distanceFt": distance_ft,
                "reachFt": reach_ft,
                "rangeFt": range_ft,
                "longRangeFt": long_range_ft,
                "rangeBand": "melee",
                "allowed": True,
                "disadvantage": False,
            }
        if range_ft > 0.0 and distance_ft <= range_ft:
            return {
                "distanceFt": distance_ft,
                "reachFt": reach_ft,
                "rangeFt": range_ft,
                "longRangeFt": long_range_ft,
                "rangeBand": "normal",
                "allowed": True,
                "disadvantage": False,
            }
        if long_range_ft > 0.0 and distance_ft <= long_range_ft:
            return {
                "distanceFt": distance_ft,
                "reachFt": reach_ft,
                "rangeFt": range_ft,
                "longRangeFt": long_range_ft,
                "rangeBand": "long",
                "allowed": True,
                "disadvantage": True,
            }

    return {
        "distanceFt": distance_ft,
        "reachFt": reach_ft,
        "rangeFt": range_ft,
        "longRangeFt": long_range_ft,
        "rangeBand": "out-of-range",
        "allowed": False,
        "disadvantage": False,
    }


# ---------------------------------------------------------------------------
# Turn actions
# ---------------------------------------------------------------------------

def handle_end_turn(sid: str, data: dict) -> dict:
    """Validate turn ownership, advance the server turn, sync all clients."""

    def deny(reason: str, detail: str | None = None) -> dict:
        payload: dict = {"reason": reason}
        if detail:
            payload["detail"] = detail
        emit("end-turn-denied", payload, to=sid)
        emit("combat-error", payload, to=sid)
        return {"ok": False, **payload}

    print(f"[END-TURN] from={sid[:6]}", flush=True)
    # Acknowledge receipt immediately so client doesn't time out.
    emit("end-turn-accepted", {"reason": "received"}, to=sid)

    # --- Gate 1: player must be registered ---
    if sid not in gs.players:
        return deny("player-not-registered")

    # --- Gate 2: combat must be active ---
    combat = gs.world_state.get("combat", {})
    if not combat.get("state", {}).get("inCombat"):
        return deny("combat-not-active")

    # Sync any entities that spawned mid-combat into the order.
    gs.sync_enemies_into_order()

    order = combat.get("order") or []
    if not order:
        return deny("no-turn-order")

    idx = int(combat.get("turn") if combat.get("turn") is not None else 0)
    if not (0 <= idx < len(order)):
        return deny("invalid-turn-index")

    current = order[idx]
    if not isinstance(current, dict):
        return deny("invalid-current-actor")

    role = gs.normalize_role(gs.client_roles.get(sid, "player"))
    actor_type = str(current.get("type") or "enemy").strip().lower()

    # --- Gate 3: role-based permission ---
    # DM and dev can always advance any turn.
    # Players may only end their own player-type turn.
    if role not in {"dm", "dev"}:
        if actor_type != "player":
            return deny("not-your-turn")
        if not gs.is_players_turn(sid):
            return deny("not-your-turn")

    # --- Advance ---
    with gs.turn_lock:
        turn_data = advance_and_resolve()

    if turn_data is None:
        if not gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
            return {"ok": True, "turnIndex": None, "combatEnded": True}
        return deny("turn-advance-failed")

    print(f"[END-TURN] advanced to idx={turn_data.get('turnIndex')}", flush=True)
    socketio.emit("combat-turn", turn_data)
    broadcast_world(include_scene=False)
    return {"ok": True, "turnIndex": turn_data.get("turnIndex")}


# ---------------------------------------------------------------------------
# Combat actions
# ---------------------------------------------------------------------------

def handle_combat_action_preview(sid: str, data: dict) -> None:
    """Build a server-authoritative action preview payload for the requesting player."""
    if sid not in gs.players:
        emit("combat-preview-denied", {"reason": "player-not-registered"}, to=sid)
        return

    payload = data if isinstance(data, dict) else {}
    action_type = str(payload.get("type") or "").strip().lower().replace("_", "-").replace(" ", "-")
    request_id = str(payload.get("requestId") or "").strip()
    if action_type != "attack":
        emit("combat-preview-denied", {"reason": "unsupported-preview", "type": action_type, "requestId": request_id or None}, to=sid)
        return

    combat = gs.world_state.get("combat", {})
    if not combat.get("state", {}).get("inCombat"):
        emit("combat-preview-denied", {"reason": "not-in-combat", "requestId": request_id or None}, to=sid)
        return

    order = combat.get("order") or []
    idx = int(combat.get("turn") if combat.get("turn") is not None else 0)
    if not order or not (0 <= idx < len(order)):
        emit("combat-preview-denied", {"reason": "no-active-turn", "requestId": request_id or None}, to=sid)
        return

    role = gs.normalize_role(gs.client_roles.get(sid, "player"))
    if role not in {"dm", "dev"} and not gs.is_players_turn(sid):
        emit("combat-preview-denied", {"reason": "not-your-turn", "requestId": request_id or None}, to=sid)
        return

    target_id = str(payload.get("targetId") or "").strip()
    if not target_id:
        emit("combat-preview-denied", {"reason": "missing-target", "requestId": request_id or None}, to=sid)
        return

    entities = gs.world_state.get("entities", {})
    target_entity = entities.get(target_id) if isinstance(entities, dict) else None
    if not isinstance(target_entity, dict):
        emit("combat-preview-denied", {"reason": "unknown-target", "requestId": request_id or None}, to=sid)
        return

    attacker_entry = gs.players.get(sid) if isinstance(gs.players.get(sid), dict) else {}
    weapon = gs.resolve_equipped_weapon(attacker_entry)
    attack_bonus = int(gs.safe_float(weapon.get("attackBonus", 0), 0))
    damage_roll = max(1, int(gs.safe_float(weapon.get("damageRoll", 3), 3)))
    damage_bonus = int(gs.safe_float(weapon.get("damageBonus", 0), 0))
    target_ac = int(gs.safe_float(target_entity.get("ac", 10), 10))
    attacker_pos = _actor_position(str(order[idx].get("id") or ""), "player", sid=sid)
    target_pos = _actor_position(target_id, "enemy")
    range_profile = _attack_range_profile(weapon, attacker_pos, target_pos)

    if not range_profile["allowed"]:
        emit("combat-preview-denied", {
            "reason": "target-out-of-range",
            "requestId": request_id or None,
            "targetId": target_id,
            "distanceFt": round(range_profile["distanceFt"], 3),
            "reachFt": range_profile["reachFt"],
            "rangeFt": range_profile["rangeFt"],
            "longRangeFt": range_profile["longRangeFt"],
        }, to=sid)
        return

    # Deterministic combat preview from authoritative server stats.
    if range_profile["disadvantage"]:
        success_count = 0
        for first_roll in range(1, 21):
            for second_roll in range(1, 21):
                hit_roll = min(first_roll, second_roll)
                if hit_roll == 1:
                    continue
                if hit_roll == 20 or (hit_roll + attack_bonus) >= target_ac:
                    success_count += 1
        hit_chance = success_count / 400.0
    else:
        success_count = 0
        for roll in range(1, 21):
            if roll == 1:
                continue
            if roll == 20 or (roll + attack_bonus) >= target_ac:
                success_count += 1
        hit_chance = success_count / 20.0

    emit("combat-action-preview", {
        "requestId": request_id or None,
        "type": "attack",
        "targetId": target_id,
        "preview": {
            "attackBonus": attack_bonus,
            "targetAC": target_ac,
            "hitChance": hit_chance,
            "hitChancePct": int(round(hit_chance * 100.0)),
            "damageMin": max(0, 1 + damage_bonus),
            "damageMax": max(0, damage_roll + damage_bonus),
            "distanceFt": round(range_profile["distanceFt"], 3),
            "reachFt": range_profile["reachFt"],
            "rangeFt": range_profile["rangeFt"],
            "longRangeFt": range_profile["longRangeFt"],
            "rangeBand": range_profile["rangeBand"],
            "disadvantage": bool(range_profile["disadvantage"]),
            "weapon": {
                "itemId": weapon.get("itemId"),
                "name": weapon.get("name"),
                "attackMode": weapon.get("attackMode"),
                "damageRoll": damage_roll,
                "damageBonus": damage_bonus,
                "damageType": weapon.get("damageType"),
            },
        },
    }, to=sid)


def handle_combat_action(sid: str, data: dict) -> None:
    """Validate and apply a player combat action to the server state."""
    if sid not in gs.players:
        emit("combat-action-denied", {"reason": "player-not-registered"})
        return

    payload = data if isinstance(data, dict) else {}
    action_id = str(payload.get("id") or "").strip()
    if action_id and gs.is_duplicate_combat_action(sid, action_id):
        emit("combat-action-denied", {"reason": "duplicate-action", "id": action_id})
        return
    if not gs.consume_combat_rate_token(sid):
        emit("combat-action-denied", {"reason": "rate-limited"})
        return

    combat = gs.world_state.get("combat", {})
    if not combat.get("state", {}).get("inCombat"):
        emit("combat-action-denied", {"reason": "not-in-combat"})
        return

    order = combat.get("order") or []
    idx = int(combat.get("turn") if combat.get("turn") is not None else 0)
    if not order or not (0 <= idx < len(order)):
        emit("combat-action-denied", {"reason": "no-active-turn"})
        return

    role = gs.normalize_role(gs.client_roles.get(sid, "player"))
    if role not in {"dm", "dev"} and not gs.is_players_turn(sid):
        emit("combat-action-denied", {"reason": "not-your-turn"})
        return

    _ALLOWED = {"attack", "move", "dodge", "dash", "help", "hide", "ready", "disengage", "use-object"}
    action_type = str(payload.get("type") or "").strip().lower().replace("_", "-").replace(" ", "-")
    if action_type not in _ALLOWED:
        emit("combat-action-denied", {"reason": "unknown-action"})
        return

    if action_id:
        gs.mark_combat_action_seen(sid, action_id)

    current = order[idx]
    result: dict = {
        "attacker": current.get("id"),
        "actorType": current.get("type", "player"),
        "type": action_type,
    }

    if action_type == "attack":
        target_id = str(payload.get("targetId") or "").strip()
        if not target_id:
            emit("combat-action-denied", {"reason": "missing-target"})
            return
        entities = gs.world_state.get("entities", {})
        if not isinstance(entities, dict) or not isinstance(entities.get(target_id), dict):
            emit("combat-action-denied", {"reason": "unknown-target"})
            return
        attacker_entry = gs.players.get(sid) if isinstance(gs.players.get(sid), dict) else {}
        weapon = gs.resolve_equipped_weapon(attacker_entry)
        atk_bonus = int(gs.safe_float(weapon.get("attackBonus", 0), 0))
        dmg_roll = max(1, int(gs.safe_float(weapon.get("damageRoll", 3), 3)))
        dmg_bonus = int(gs.safe_float(weapon.get("damageBonus", 0), 0))
        target_entity = entities[target_id]
        target_ac = int(gs.safe_float(target_entity.get("ac", 10), 10))
        attacker_pos = _actor_position(str(current.get("id") or ""), "player", sid=sid)
        target_pos = _actor_position(target_id, "enemy")
        range_profile = _attack_range_profile(weapon, attacker_pos, target_pos)

        if not range_profile["allowed"]:
            emit("combat-action-denied", {
                "reason": "target-out-of-range",
                "targetId": target_id,
                "distanceFt": round(range_profile["distanceFt"], 3),
                "reachFt": range_profile["reachFt"],
                "rangeFt": range_profile["rangeFt"],
                "longRangeFt": range_profile["longRangeFt"],
            })
            return

        _ = reaction_system.trigger_reactions("attack_declared", {
            "attackerActorId": str(current.get("id") or ""),
            "attackerActorType": str(current.get("type") or "player"),
            "targetId": target_id,
        })

        first_roll = random.randint(1, 20)
        second_roll = random.randint(1, 20) if range_profile["disadvantage"] else None
        hit_roll = min(first_roll, second_roll) if second_roll is not None else first_roll
        total = hit_roll + atk_bonus
        is_hit = hit_roll == 20 or (hit_roll != 1 and total >= target_ac)
        damage = max(0, random.randint(1, dmg_roll) + dmg_bonus) if is_hit else 0

        if is_hit:
            hp_before = gs.safe_float(target_entity.get("hp", target_entity.get("maxHp", 1)), 1)
            hp_after = max(0.0, hp_before - float(damage))
            target_entity["hp"] = hp_after
            if hp_after <= 0.0:
                gs.mark_enemy_downed(target_entity)

        result.update({
            "targetId": target_id,
            "hitRoll": hit_roll,
            "hitRolls": [first_roll, second_roll] if second_roll is not None else [first_roll],
            "attackBonus": atk_bonus,
            "toHit": total,
            "targetAC": target_ac,
            "hit": is_hit,
            "damage": damage,
            "distanceFt": round(range_profile["distanceFt"], 3),
            "reachFt": range_profile["reachFt"],
            "rangeFt": range_profile["rangeFt"],
            "longRangeFt": range_profile["longRangeFt"],
            "rangeBand": range_profile["rangeBand"],
            "attackDisadvantage": bool(range_profile["disadvantage"]),
            "weapon": {
                "itemId": weapon.get("itemId"),
                "name": weapon.get("name"),
                "attackMode": weapon.get("attackMode"),
                "damageRoll": dmg_roll,
                "damageBonus": dmg_bonus,
                "damageType": weapon.get("damageType"),
            },
            "targetHp": gs.safe_float(target_entity.get("hp", 0.0), 0.0),
            "targetState": str(target_entity.get("state") or "active"),
        })

    elif action_type == "dodge":
        entry = gs.players.get(sid)
        if not isinstance(entry, dict):
            emit("combat-action-denied", {"reason": "player-not-registered"})
            return
        if not gs.player_has_movement_capability(entry, "can_dodge"):
            emit("combat-action-denied", {"reason": "action-unavailable", "type": action_type})
            return

        gs.set_player_dodge_active(entry, True)
        gs.save_resume_snapshot(sid)
        result.update({
            "dodgeActive": True,
            "message": "Dodge active until your next turn",
        })

    elif action_type in {"move", "dash", "disengage"}:
        player_entry = gs.players.get(sid) if isinstance(gs.players.get(sid), dict) else None
        if not isinstance(player_entry, dict):
            emit("combat-action-denied", {"reason": "player-not-registered"})
            return
        required_capability = {
            "dash": "can_dash",
            "disengage": "can_disengage",
        }.get(action_type)
        if required_capability and not gs.player_has_movement_capability(player_entry, required_capability):
            emit("combat-action-denied", {"reason": "action-unavailable", "type": action_type})
            return

        old_pos = _actor_position(str(current.get("id") or ""), "player", sid=sid)
        desired_pos = payload.get("position") if isinstance(payload.get("position"), dict) else old_pos
        new_pos = {
            "x": gs.safe_float(desired_pos.get("x", old_pos["x"]), old_pos["x"]),
            "y": gs.safe_float(desired_pos.get("y", old_pos["y"]), old_pos["y"]),
            "z": gs.safe_float(desired_pos.get("z", old_pos["z"]), old_pos["z"]),
        }

        budget = _movement_budget_for(action_type, player_entry)
        requested = _distance_2d(old_pos, new_pos)
        if requested > budget:
            emit("combat-action-denied", {"reason": "move-too-far", "requested": requested, "budget": budget})
            return

        player_entry["position"] = new_pos
        socketio.emit("entity-move", {"id": str(current.get("id") or ""), "position": new_pos})

        reactions = reaction_system.trigger_reactions("leave_melee_range", {
            "moverActorId": str(current.get("id") or ""),
            "moverActorType": "player",
            "moverSid": sid,
            "startPos": old_pos,
            "endPos": new_pos,
            "isDisengage": (action_type == "disengage"),
        })
        result.update({
            "positionBefore": old_pos,
            "positionAfter": new_pos,
            "movementFt": round(requested, 3),
            "movementBudgetFt": budget,
            "reactionCount": len(reactions),
        })

    elif action_type == "use-object":
        entry = gs.players.get(sid)
        if not isinstance(entry, dict):
            emit("combat-action-denied", {"reason": "player-not-registered"})
            return

        instance_id = str(payload.get("instanceId") or payload.get("itemInstanceId") or "").strip()
        if not instance_id:
            emit("combat-action-denied", {"reason": "missing-item"})
            return

        idx_item, item = _find_inventory_item(entry, instance_id)
        if item is None or idx_item is None:
            emit("combat-action-denied", {"reason": "item-not-found"})
            return

        item_id = str(item.get("itemId") or "")
        definition = gs.resolve_item_def(item_id)
        item_type = str(definition.get("type") or "").strip().lower()
        if item_type != "consumable":
            emit("combat-action-denied", {"reason": "item-not-usable", "itemId": item_id})
            return

        heal_formula = definition.get("healDice")
        heal_flat = int(gs.safe_float(definition.get("healFlat", 0), 0))
        heal_amount = max(0, gs.roll_dice_formula(heal_formula, fallback=heal_flat))
        hp_before = gs.safe_float(entry.get("hp", entry.get("max_hp", 1)), 1)
        max_hp = gs.safe_float(entry.get("max_hp", hp_before), hp_before)
        hp_after = min(max_hp, hp_before + heal_amount)
        healed = max(0.0, hp_after - hp_before)
        entry["hp"] = hp_after

        qty_before = int(gs.safe_float(item.get("qty", 1), 1))
        qty_after = max(0, qty_before - 1)
        inventory = entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []}
        items = inventory.get("items") if isinstance(inventory.get("items"), list) else []
        if qty_after <= 0:
            items.pop(idx_item)
        else:
            item["qty"] = qty_after

        gs.save_resume_snapshot(sid)
        _emit_inventory_update(sid, entry, "use-object", {"instanceId": instance_id, "itemId": item_id, "qty": qty_after})
        result.update({
            "itemId": item_id,
            "instanceId": instance_id,
            "healFormula": heal_formula,
            "healed": healed,
            "hpBefore": hp_before,
            "hpAfter": hp_after,
            "qtyBefore": qty_before,
            "qtyAfter": qty_after,
        })

    socketio.emit("combat-action-result", result)
    if conclude_combat_if_needed(sid) is not None:
        return
    broadcast_world(include_scene=False)


# ---------------------------------------------------------------------------
# Inventory actions (server-authoritative)
# ---------------------------------------------------------------------------

def _find_inventory_item(entry: dict, instance_id: str) -> tuple[int, dict] | tuple[None, None]:
    inventory = entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {}
    items = inventory.get("items") if isinstance(inventory.get("items"), list) else []
    for idx, row in enumerate(items):
        if not isinstance(row, dict):
            continue
        if str(row.get("instanceId") or "").strip() == instance_id:
            return idx, row
    return None, None


def _emit_inventory_error(sid: str, reason: str) -> None:
    emit("inventory-error", {"reason": reason}, to=sid)


def _emit_inventory_update(sid: str, entry: dict, action: str, item: dict | None = None) -> None:
    payload = {
        "sid": sid,
        "action": action,
        "inventory": entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []},
        "equippedWeapon": entry.get("equipped_weapon"),
    }
    if isinstance(item, dict):
        payload["item"] = item
    socketio.emit("inventory-updated", payload)


def handle_inventory_equip_item(sid: str, data: dict) -> None:
    entry = gs.players.get(sid)
    if not isinstance(entry, dict):
        _emit_inventory_error(sid, "player-not-registered")
        return

    instance_id = str(data.get("instanceId") or "").strip()
    if not instance_id:
        _emit_inventory_error(sid, "missing-instance-id")
        return

    _, row = _find_inventory_item(entry, instance_id)
    if row is None:
        _emit_inventory_error(sid, "item-not-found")
        return

    definition = gs.resolve_item_def(str(row.get("itemId") or ""))
    slot = str(row.get("slot") or definition.get("slot") or "").strip() or None
    inventory = entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []}
    items = inventory.get("items") if isinstance(inventory.get("items"), list) else []

    if slot:
        for candidate in items:
            if not isinstance(candidate, dict):
                continue
            if str(candidate.get("instanceId") or "") == instance_id:
                continue
            if str(candidate.get("slot") or "").strip() == slot:
                candidate["equipped"] = False

    row["equipped"] = True
    if slot:
        row["slot"] = slot

    gs.apply_equipped_weapon_stats(entry)
    gs.save_resume_snapshot(sid)
    _emit_inventory_update(sid, entry, "equip-item", row)
    broadcast_world(include_scene=False)


def handle_inventory_unequip_item(sid: str, data: dict) -> None:
    entry = gs.players.get(sid)
    if not isinstance(entry, dict):
        _emit_inventory_error(sid, "player-not-registered")
        return

    instance_id = str(data.get("instanceId") or "").strip()
    if not instance_id:
        _emit_inventory_error(sid, "missing-instance-id")
        return

    _, row = _find_inventory_item(entry, instance_id)
    if row is None:
        _emit_inventory_error(sid, "item-not-found")
        return

    row["equipped"] = False
    gs.apply_equipped_weapon_stats(entry)
    gs.save_resume_snapshot(sid)
    _emit_inventory_update(sid, entry, "unequip-item", row)
    broadcast_world(include_scene=False)


def handle_inventory_use_item(sid: str, data: dict) -> None:
    entry = gs.players.get(sid)
    if not isinstance(entry, dict):
        _emit_inventory_error(sid, "player-not-registered")
        return

    instance_id = str(data.get("instanceId") or "").strip()
    if not instance_id:
        _emit_inventory_error(sid, "missing-instance-id")
        return

    idx, row = _find_inventory_item(entry, instance_id)
    if row is None or idx is None:
        _emit_inventory_error(sid, "item-not-found")
        return

    definition = gs.resolve_item_def(str(row.get("itemId") or ""))
    if str(definition.get("type") or "") != "consumable":
        _emit_inventory_error(sid, "item-not-usable")
        return

    qty = int(gs.safe_float(row.get("qty", 0), 0))
    if qty <= 0:
        _emit_inventory_error(sid, "item-empty")
        return

    healed = 0
    if str(definition.get("id") or "") == "health_potion":
        heal_flat = int(gs.safe_float(definition.get("healFlat", 10), 10))
        hp_now = gs.safe_float(entry.get("hp", entry.get("max_hp", 0)), 0)
        hp_cap = gs.safe_float(entry.get("max_hp", hp_now), hp_now)
        entry["hp"] = min(hp_cap, hp_now + heal_flat)
        healed = int(entry["hp"] - hp_now)

    row["qty"] = qty - 1
    inventory = entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []}
    items = inventory.get("items") if isinstance(inventory.get("items"), list) else []
    if row.get("qty", 0) <= 0:
        items.pop(idx)

    gs.apply_equipped_weapon_stats(entry)
    gs.save_resume_snapshot(sid)
    _emit_inventory_update(sid, entry, "use-item", {"instanceId": instance_id, "healed": healed})
    broadcast_world(include_scene=False)


def handle_inventory_loot_item(sid: str, data: dict) -> None:
    role = gs.normalize_role(gs.client_roles.get(sid, "player"))
    if role not in {"dm", "dev"}:
        _emit_inventory_error(sid, "requires-dm-or-dev")
        return

    payload = data if isinstance(data, dict) else {}
    target_sid = str(payload.get("targetSid") or "").strip()
    if target_sid not in gs.players:
        _emit_inventory_error(sid, "target-player-not-found")
        return

    target = gs.players[target_sid]
    if not isinstance(target, dict):
        _emit_inventory_error(sid, "target-player-invalid")
        return

    item_id = str(payload.get("itemId") or "").strip().lower()
    item_id = "_".join(part for part in "".join(ch if ch.isalnum() else "_" for ch in item_id).split("_") if part)
    if not item_id:
        _emit_inventory_error(sid, "missing-item-id")
        return

    qty = int(gs.safe_float(payload.get("qty", 1), 1))
    qty = max(1, qty)

    inventory = target.get("inventory") if isinstance(target.get("inventory"), dict) else {"items": [], "capacity": None, "weight": 0}
    items = inventory.setdefault("items", [])
    if not isinstance(items, list):
        items = []
        inventory["items"] = items

    # Stack if possible.
    stacked = False
    definition = gs.resolve_item_def(item_id)
    stackable = bool(definition.get("stackable", True))
    if stackable:
        for row in items:
            if not isinstance(row, dict):
                continue
            if str(row.get("itemId") or "") == item_id:
                row["qty"] = int(gs.safe_float(row.get("qty", 0), 0)) + qty
                stacked = True
                break

    if not stacked:
        items.append({
            "instanceId": f"inv_{len(items) + 1:03d}_{item_id}",
            "itemId": item_id,
            "qty": qty,
            "equipped": False,
        })

    target["inventory"] = gs.normalize_inventory_contract(inventory)
    gs.apply_equipped_weapon_stats(target)
    gs.save_resume_snapshot(target_sid)
    _emit_inventory_update(target_sid, target, "loot-item", {"itemId": item_id, "qty": qty})
    broadcast_world(include_scene=False)


# ---------------------------------------------------------------------------
# DM commands
# ---------------------------------------------------------------------------

def handle_dm_command(sid: str, data: dict) -> None:
    """Validate and execute a DM command against world_state."""
    if gs.normalize_role(gs.client_roles.get(sid, "player")) != "dm":
        emit("dm-command-denied", {"reason": "requires-dm-role"})
        return

    command = _sanitize_dm_command(data.get("command") if isinstance(data, dict) else None)
    if not command:
        emit("dm-command-denied", {"reason": "invalid-command"})
        return

    cmd_type = str(command.get("type") or "").strip().lower()
    payload = command.get("payload") if isinstance(command.get("payload"), dict) else {}

    if cmd_type in {"spawn-entity", "spawn-training-dummy"}:
        entity_type = str(payload.get("entityType") or "training-dummy").strip().lower()
        if cmd_type == "spawn-training-dummy":
            entity_type = "training-dummy"
        actor_id = gs.register_entity(
            entity_type=entity_type,
            position=payload.get("position") if isinstance(payload.get("position"), dict) else {},
            name=payload.get("name"),
        )
        payload["actorId"] = actor_id
        if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
            gs.sync_enemies_into_order()

    print(f"[DM-COMMAND] sid={sid[:6]} type={cmd_type}", flush=True)
    socketio.emit("dm-command", {"from": sid, "role": "dm", "command": command})

    if cmd_type in {"spawn-entity", "spawn-training-dummy"}:
        broadcast_world(include_scene=False)


# ---------------------------------------------------------------------------
# Internal: command sanitisation
# ---------------------------------------------------------------------------

def _sanitize_dm_command(raw: dict | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    cmd_type = str(raw.get("type") or "").strip().lower()
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else {}

    if cmd_type in {"spawn-entity", "spawn-training-dummy"}:
        entity_type = str(payload.get("entityType") or "").strip().lower()
        if cmd_type == "spawn-training-dummy":
            entity_type = "training-dummy"
        if entity_type not in {"training-dummy", "player-dummy", "elite-dummy"}:
            return None
        pos = payload.get("position") if isinstance(payload.get("position"), dict) else {}
        try:
            x, y, z = float(pos.get("x", 0)), float(pos.get("y", 0)), float(pos.get("z", 0))
        except (TypeError, ValueError):
            return None
        name = str(payload.get("name") or "Training Dummy").strip() or "Training Dummy"
        return {
            "type": cmd_type,
            "payload": {"entityType": entity_type, "position": {"x": x, "y": y, "z": z}, "name": name},
        }

    if cmd_type in {"step-turn", "rewind-turn", "replay-last-action", "release-possession", "end-turn"}:
        return {"type": cmd_type, "payload": {}}

    if cmd_type == "possess-actor":
        actor_id = str(payload.get("actorId") or "").strip()
        if not actor_id:
            return None
        return {"type": "possess-actor", "payload": {"actorId": actor_id}}

    return None
