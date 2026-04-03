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
from turn_manager import advance_and_resolve
from state_sync import broadcast_world, broadcast_lobby


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
        return deny("turn-advance-failed")

    print(f"[END-TURN] advanced to idx={turn_data.get('turnIndex')}", flush=True)
    socketio.emit("combat-turn", turn_data)
    broadcast_world(include_scene=False)
    return {"ok": True, "turnIndex": turn_data.get("turnIndex")}


# ---------------------------------------------------------------------------
# Combat actions
# ---------------------------------------------------------------------------

def handle_combat_action(sid: str, data: dict) -> None:
    """Validate and apply a player combat action to the server state."""
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

    _ALLOWED = {"attack", "move", "dodge", "dash", "help", "hide", "ready", "disengage"}
    action_type = str(data.get("type") or "").strip().lower()
    if action_type not in _ALLOWED:
        emit("combat-action-denied", {"reason": "unknown-action"})
        return

    current = order[idx]
    result: dict = {
        "attacker": current.get("id"),
        "actorType": current.get("type", "player"),
        "type": action_type,
    }

    if action_type == "attack":
        target_id = str(data.get("targetId") or "").strip()
        if not target_id:
            emit("combat-action-denied", {"reason": "missing-target"})
            return
        entities = gs.world_state.get("entities", {})
        if not isinstance(entities, dict) or not isinstance(entities.get(target_id), dict):
            emit("combat-action-denied", {"reason": "unknown-target"})
            return
        result.update({
            "targetId": target_id,
            "hitRoll": random.randint(1, 20),
            "damage": random.randint(1, 8),
        })

    socketio.emit("combat-action-result", result)
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
