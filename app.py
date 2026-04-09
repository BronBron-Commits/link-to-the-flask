"""
APP â€” Server entry point.

Bootstraps gevent, wires together the five modules, and registers all
SocketIO event handlers. The five clear blocks are:

  1. connection_manager  â€” who's connected (connect / disconnect / resume)
  2. game_state          â€” single source of truth (all mutable state)
  3. turn_manager        â€” turn cycle (advance, enemy AI, start/end combat)
  4. action_handler      â€” validate & apply every client action
  5. state_sync          â€” broadcast authoritative state back to all clients

HTTP routes are in routes.py (imported below to register them via @app.route).
"""
# gevent monkey-patch MUST happen before any other imports.
from gevent import monkey
monkey.patch_all()
import gevent  # noqa: F401 â€” imported after patch so gevent primitives work

from time import perf_counter
from uuid import uuid4

from flask import request
from flask_socketio import emit

# Core instances (app + socketio created once here, shared everywhere).
from extensions import app, socketio  # noqa: F401

# State â€” imports after this point are safe because patch_all() is done.
import game_state as gs

# Register HTTP routes via @app.route decorators in routes.py.
import routes  # noqa: F401

# Module-level handlers.
from connection_manager import on_connect, on_disconnect
from turn_manager import advance_and_resolve, start_combat, end_combat
from action_handler import (
    handle_end_turn,
    handle_combat_action,
    handle_combat_action_preview,
    handle_dm_command,
    handle_inventory_equip_item,
    handle_inventory_unequip_item,
    handle_inventory_use_item,
    handle_inventory_loot_item,
)
from state_sync import broadcast_world, broadcast_lobby, emit_combat_turn_to


# Register HTTP routes via @app.route decorators in routes.py.
import routes  # noqa: F401

# Module-level handlers.
from connection_manager import on_connect, on_disconnect
from turn_manager import advance_and_resolve, start_combat, end_combat
from action_handler import handle_end_turn, handle_combat_action, handle_combat_action_preview, handle_dm_command
from state_sync import broadcast_world, broadcast_lobby, emit_combat_turn_to

# ---------------------------------------------------------------------------
# BLOCK 1 -- CONNECTION HANDLERS
# ---------------------------------------------------------------------------

@socketio.on("connect")
def socket_connect(payload=None):
    on_connect(payload)


@socketio.on("disconnect")
def socket_disconnect():
    on_disconnect()


# ---------------------------------------------------------------------------
# BLOCK 2 -- ROLE / LOBBY
# ---------------------------------------------------------------------------

@socketio.on("register-role")
def socket_register_role(data):
    sid = request.sid
    role = gs.normalize_role(data.get("role") if isinstance(data, dict) else None)
    if not gs.can_assign_role(role, sid=sid):
        emit("role-ack", {"id": sid, "role": gs.players.get(sid, {}).get("role", "player"),
                          "accepted": False, "reason": "slot-full"})
        emit("lobby-state", gs.build_lobby_state())
        return
    if not gs.apply_role(sid, role):
        emit("role-ack", {"id": sid, "role": gs.players.get(sid, {}).get("role", "player"),
                          "accepted": False, "reason": "slot-assign-failed"})
        emit("lobby-state", gs.build_lobby_state())
        return
    if sid in gs.players:
        gs.save_resume_snapshot(sid)
        emit("player-update", gs.players[sid], broadcast=True, include_self=False)
        socketio.emit("players-state", gs.players)
        broadcast_world(include_scene=False)
    emit("role-ack", {"id": sid, "role": role, "accepted": True})
    broadcast_lobby()


@socketio.on("start-game")
def socket_start_game(data=None):
    gs.refresh_authority()
    emit("start-game-ack", {"ok": True, "state": {
        "gameState": gs.game_session_state,
        "rolesLocked": False,
        "authoritativePlayerId": gs.authoritative_player_sid(),
    }})
    broadcast_lobby()
    broadcast_world(include_scene=False)


# ---------------------------------------------------------------------------
# BLOCK 3 -- PLAYER UPDATES
# ---------------------------------------------------------------------------

@socketio.on("player-update")
def socket_player_update(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    has_metadata_update = any(key in data for key in ("name", "side", "avatar"))
    now = perf_counter()
    if (not has_metadata_update
            and (now - gs.player_update_last_seen.get(sid, 0.0)) < gs.PLAYER_UPDATE_MIN_INTERVAL_SEC):
        return
    gs.player_update_last_seen[sid] = now
    entry = gs.players[sid]
    pos = data.get("position") if isinstance(data.get("position"), dict) else None
    rot = data.get("rotation") if isinstance(data.get("rotation"), dict) else None
    if pos:
        entry["position"] = {k: float(pos.get(k, 0.0)) for k in ("x", "y", "z")}
    if rot:
        entry["rotation"] = {k: float(rot.get(k, 0.0)) for k in ("x", "y", "z")}
    avatar = data.get("avatar") if isinstance(data.get("avatar"), dict) else None
    if avatar:
        try:
            scale = float(avatar.get("scale", 1.0))
        except (TypeError, ValueError):
            scale = 1.0
        entry["avatar"] = {
            "modelUrl": str(avatar.get("modelUrl") or "fallback"),
            "bonePoses": avatar.get("bonePoses") if isinstance(avatar.get("bonePoses"), dict) else {},
            "scale": scale,
        }
    else:
        entry.pop("avatar", None)
    social = data.get("social") if isinstance(data.get("social"), dict) else None
    if social:
        entry["social"] = {
            "voiceEnabled": bool(social.get("voiceEnabled", False)),
            "voiceSpeaking": bool(social.get("voiceSpeaking", False)),
        }
    else:
        entry.pop("social", None)
    mp = data.get("movementPreview") if isinstance(data.get("movementPreview"), dict) else None
    if mp:
        cursor = mp.get("cursor") if isinstance(mp.get("cursor"), dict) else None
        sanitized_cursor = None
        if cursor:
            try:
                sanitized_cursor = {k: float(cursor.get(k, 0.0)) for k in ("x", "y", "z")}
                sanitized_cursor["kind"] = str(cursor.get("kind", "hover"))
            except (TypeError, ValueError):
                sanitized_cursor = None
        try:
            mr = max(0.0, float(mp.get("movementRemaining", 0.0)))
        except (TypeError, ValueError):
            mr = 0.0
        entry["movementPreview"] = {
            "showZone": bool(mp.get("showZone", False)),
            "movementRemaining": mr,
            "cursor": sanitized_cursor,
        }
    else:
        entry.pop("movementPreview", None)
    raw_name = data.get("name")
    if isinstance(raw_name, str) and raw_name.strip():
        entry["name"] = raw_name.strip()[:32]
    raw_side = data.get("side")
    if isinstance(raw_side, str) and raw_side.strip():
        requested_side = raw_side.strip().lower()
        requested_side = "villains" if requested_side == "villains" else "heroes"
        team_capacity = 4
        hero_count = 0
        villain_count = 0
        for other_sid, other_entry in gs.players.items():
            if other_sid == sid or not isinstance(other_entry, dict):
                continue
            other_side = str(other_entry.get("side") or "heroes").strip().lower()
            if other_side == "villains":
                villain_count += 1
            else:
                hero_count += 1
        if requested_side == "heroes" and hero_count >= team_capacity and villain_count < team_capacity:
            requested_side = "villains"
        entry["side"] = requested_side
    gs.save_resume_snapshot(sid)
    emit("player-update", entry)
    emit("player-update", entry, broadcast=True, include_self=False)
    # During combat, player positions are covered by the player-update broadcast above.
    # Skip the full world broadcast to prevent stale exploration-mode world-updates
    # from racing with the combat-state event and incorrectly evicting clients from combat.
    if not gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
        broadcast_world(include_scene=False)


@socketio.on("player-character-stats")
def socket_player_character_stats(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    if gs.normalize_role(gs.client_roles.get(sid, "player")) != "player":
        return
    entry = gs.players[sid]

    def coerce_int(key):
        raw = data.get(key)
        try:
            return int(float(raw)) if raw is not None else None
        except (TypeError, ValueError):
            return None

    ac = coerce_int("ac")
    max_hp = coerce_int("maxHp")
    current_hp = coerce_int("currentHp")
    init_bonus = coerce_int("initiativeBonus")
    speed_ft = coerce_int("speedFt")
    movement_caps = data.get("movementCapabilities") if isinstance(data.get("movementCapabilities"), dict) else data.get("movement_capabilities")
    
    # Validate stats before accepting
    player_stats = {}
    if ac is not None:
        player_stats["ac"] = ac
    if max_hp is not None:
        player_stats["hp"] = float(max_hp)
    if init_bonus is not None:
        player_stats["initiativeBonus"] = init_bonus
    if speed_ft is not None:
        player_stats["speedFt"] = speed_ft
    
    # Validate and clamp
    validated = gs.validate_player_stats(player_stats)
    
    # Apply validated stats
    if "ac" in validated:
        entry["ac"] = validated["ac"]
    if max_hp is not None and "hp" in validated:
        entry["max_hp"] = validated["hp"]
        in_combat = bool(gs.world_state.get("combat", {}).get("state", {}).get("inCombat"))
        if current_hp is not None and in_combat:
            entry["hp"] = max(0.0, min(float(validated["hp"]), float(current_hp)))
        elif not in_combat:
            entry["hp"] = float(validated["hp"])
        elif "hp" not in entry:
            entry["hp"] = float(validated["hp"])
    if "initiativeBonus" in validated:
        entry["initiative_bonus"] = validated["initiativeBonus"]
    if "speedFt" in validated:
        entry["speed_ft"] = validated["speedFt"]
    if isinstance(movement_caps, dict):
        gs.set_player_movement_capabilities(entry, movement_caps)
    else:
        # Keep baseline tactical actions enabled even when capability payload is omitted.
        gs.set_player_movement_capabilities(entry, {})

    # Hydrate inventory contract for this player (prefer explicit payload, else latest engine contract).
    inventory_payload = data.get("inventory") if isinstance(data.get("inventory"), dict) else None
    if inventory_payload is not None:
        gs.set_player_inventory(sid, inventory_payload)
    elif not isinstance(entry.get("inventory"), dict):
        engine_entity = gs.load_engine_entity_contract()
        if isinstance(engine_entity, dict):
            gs.apply_inventory_from_engine_entity(sid, engine_entity)
    else:
        gs.apply_equipped_weapon_stats(entry)
    
    gs.save_resume_snapshot(sid)
    print(f"[PLAYER] {sid[:6]} stats loaded: AC={entry.get('ac')}, HP={entry.get('max_hp')}", flush=True)
    emit("player-character-stats-ack", {
        "ok": True,
        "ac": entry.get("ac"),
        "maxHp": entry.get("max_hp"),
        "movementCapabilities": entry.get("movement_capabilities") if isinstance(entry.get("movement_capabilities"), dict) else None,
        "inventory": entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []},
        "equippedWeapon": entry.get("equipped_weapon"),
    })


@socketio.on("scene-update")
def socket_scene_update(data):
    if not isinstance(data, dict):
        return
    if "objects" in data and isinstance(data.get("objects"), (list, dict)):
        gs.latest_scene_state = data
        gs.world_state["scene"] = gs.latest_scene_state
    emit("scene-update", data, broadcast=True, include_self=False)
    broadcast_world(include_scene=True)


@socketio.on("social-chat-message")
def socket_social_chat_message(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return

    message = str(data.get("message") or "").strip()
    if not message:
        return

    sender = str(data.get("name") or gs.players[sid].get("name") or "Traveler").strip()[:24] or "Traveler"
    socketio.emit("social-chat-message", {
        "sid": sid,
        "name": sender,
        "message": message[:300],
    })


# ---------------------------------------------------------------------------
# BLOCK 4 -- TURN MANAGEMENT
# ---------------------------------------------------------------------------

@socketio.on("end-turn")
def socket_end_turn(data=None):
    handle_end_turn(request.sid, data if isinstance(data, dict) else {})


@socketio.on("advance-combat-turn")
def socket_advance_combat_turn(data=None):
    sid = request.sid
    if sid not in gs.players:
        return
    if gs.normalize_role(gs.client_roles.get(sid, "player")) not in {"dm", "dev"}:
        return
    gs.sync_enemies_into_order()
    with gs.turn_lock:
        turn_data = advance_and_resolve()
    if turn_data is None:
        return
    socketio.emit("combat-turn", turn_data)
    broadcast_world(include_scene=False)


@socketio.on("request-combat-state")
def socket_request_combat_state(data=None):
    sid = request.sid
    if sid not in gs.players:
        return
    emit_combat_turn_to(sid)
    emit("combat-full-state", gs.world_state.get("combat", {}))


# ---------------------------------------------------------------------------
# BLOCK 5 -- COMBAT LIFECYCLE
# ---------------------------------------------------------------------------

@socketio.on("combat-start-request")
def socket_combat_start_request(data):
    sid = request.sid
    if sid not in gs.players:
        return
    payload = data if isinstance(data, dict) else {}
    target_id = str(payload.get("targetId") or "").strip()
    request_id = str(payload.get("requestId") or uuid4().hex).strip() or uuid4().hex
    if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
        emit("combat-start-result", {
            "requestId": request_id, "approved": False,
            "targetId": target_id or None, "status": "already-in-combat",
        }, to=sid)
        return
    dm_sids = gs.get_dm_sids()
    if not dm_sids:
        start_combat(sid, target_id or None)
        emit("combat-start-result", {
            "requestId": request_id, "approved": True,
            "targetId": target_id or None, "status": "auto-approved-no-dm",
        }, to=sid)
        return
    gs.pending_combat_start_requests[request_id] = {
        "requesterSid": sid, "targetId": target_id, "createdAt": perf_counter(),
    }
    emit("combat-start-result", {
        "requestId": request_id, "approved": False,
        "targetId": target_id or None, "status": "pending",
    }, to=sid)
    for dm_sid in dm_sids:
        emit("combat-start-request", {
            "requestId": request_id, "from": sid, "targetId": target_id or None,
        }, to=dm_sid)


@socketio.on("combat-start-decision")
def socket_combat_start_decision(data):
    sid = request.sid
    if gs.normalize_role(gs.client_roles.get(sid, "player")) != "dm":
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return
    payload = data if isinstance(data, dict) else {}
    request_id = str(payload.get("requestId") or "").strip()
    if not request_id:
        emit("combat-state-denied", {"reason": "missing-request-id"})
        return
    pending = gs.pending_combat_start_requests.pop(request_id, None)
    if not pending:
        emit("combat-state-denied", {"reason": "unknown-request"})
        return
    if perf_counter() - float(pending.get("createdAt", 0.0)) > 30.0:
        emit("combat-state-denied", {"reason": "request-expired"})
        return
    requester = str(pending.get("requesterSid") or "").strip()
    target_id = str(pending.get("targetId") or "").strip()
    approved = bool(payload.get("approved", False))
    emit("combat-start-result", {
        "requestId": request_id, "approved": approved,
        "targetId": target_id or None,
        "status": "approved" if approved else "rejected",
    }, to=requester)
    if approved:
        start_combat(requester or sid, target_id or None, approver=sid)


@socketio.on("combat-start")
def socket_combat_start(data):
    sid = request.sid
    if sid not in gs.players:
        return
    role = gs.normalize_role(gs.client_roles.get(sid, gs.players[sid].get("role", "player")))
    if role != "dm" and gs.get_dm_sids():
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return
    if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
        return
    payload = data if isinstance(data, dict) else {}
    target_id = str(payload.get("targetId") or "").strip()
    start_combat(sid, target_id or None)


@socketio.on("combat-end")
def socket_combat_end(data=None):
    sid = request.sid
    if sid not in gs.players:
        return
    role = gs.normalize_role(gs.client_roles.get(sid, gs.players[sid].get("role", "player")))
    if role != "dm" and gs.get_dm_sids():
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return
    end_combat(sid)
    for player_sid in list(gs.players.keys()):
        gs.save_resume_snapshot(player_sid)


# ---------------------------------------------------------------------------
# BLOCK 5 (continued) -- ACTION HANDLERS
# ---------------------------------------------------------------------------

@socketio.on("combat-action")
def socket_combat_action(data):
    if request.sid in gs.players and isinstance(data, dict):
        handle_combat_action(request.sid, data)


@socketio.on("combat-action-preview")
def socket_combat_action_preview(data):
    if request.sid in gs.players and isinstance(data, dict):
        handle_combat_action_preview(request.sid, data)


@socketio.on("dm-command")
def socket_dm_command(data):
    try:
        handle_dm_command(request.sid, data if isinstance(data, dict) else {})
    except Exception as exc:
        import traceback
        print(f"[ERROR] dm-command: {exc}", flush=True)
        traceback.print_exc()


@socketio.on("equip-item")
def socket_inventory_equip_item(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    handle_inventory_equip_item(sid, data)


@socketio.on("unequip-item")
def socket_inventory_unequip_item(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    handle_inventory_unequip_item(sid, data)


@socketio.on("use-item")
def socket_inventory_use_item(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    handle_inventory_use_item(sid, data)


@socketio.on("loot-item")
def socket_inventory_loot_item(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    handle_inventory_loot_item(sid, data)


@socketio.on("combat-action-record")
def socket_combat_action_record(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    if gs.players[sid].get("role", "player") != "player":
        return
    record = data.get("record") if isinstance(data.get("record"), dict) else None
    if not record:
        return
    try:
        start_ms = int(float(data.get("startTimeMs")))
    except (TypeError, ValueError):
        start_ms = None
    timeline_id = str(data.get("timelineId") or "").strip() or None
    payload = {"from": sid, "role": "player", "record": record}
    if start_ms is not None:
        payload["startTimeMs"] = start_ms
    if timeline_id:
        payload["timelineId"] = timeline_id
    emit("combat-action-record", payload, broadcast=True, include_self=False)


@socketio.on("timeline-start")
def socket_timeline_start(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    if gs.players[sid].get("role") != "player":
        return
    timeline_id = str(data.get("timelineId") or "").strip()
    if not timeline_id:
        return
    try:
        start_ms = int(float(data.get("startTimeMs")))
    except (TypeError, ValueError):
        return
    emit("timeline-start", {
        "from": sid, "role": "player",
        "timelineId": timeline_id, "startTimeMs": start_ms,
    }, broadcast=True, include_self=False)


@socketio.on("dice-roll-event")
def socket_dice_roll_event(data):
    sid = request.sid
    if sid not in gs.players or not isinstance(data, dict):
        return
    if gs.players[sid].get("role") != "player":
        return
    roll = data.get("roll") if isinstance(data.get("roll"), dict) else None
    if not roll:
        return
    emit("dice-roll-event", {"from": sid, "role": "player", "roll": roll},
         broadcast=True, include_self=False)


# ---------------------------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    print(f"[BOOT] Python {sys.version}", flush=True)
    print(f"[BOOT] Flask-SocketIO async_mode={socketio.async_mode}", flush=True)
    if socketio.async_mode != "gevent":
        raise RuntimeError(
            f"async_mode is {socketio.async_mode!r}, expected 'gevent'. "
            "Run: pip install gevent gevent-websocket"
        )
    try:
        import geventwebsocket
        version = getattr(geventwebsocket, "__version__", None) or "unknown"
        print(f"[BOOT] gevent-websocket OK: {version}", flush=True)
    except ImportError as exc:
        raise RuntimeError("gevent-websocket not installed. Fix: pip install gevent-websocket") from exc
    print("[BOOT] Starting on http://0.0.0.0:5000 with gevent WebSocket support", flush=True)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
