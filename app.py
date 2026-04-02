from pathlib import Path
from copy import deepcopy
from uuid import uuid4
from time import perf_counter

from flask import Flask, request, jsonify, render_template, send_file, send_from_directory
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

from scripts.pdf_to_tidy_data import parse_character_tables, write_outputs

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='threading')

LOBBY_ROLE_CAPACITY: dict[str, int] = {
    "player": 4,
    "dm": 1,
    "dev": 1,
}

CONTRACTS_DIR = Path("data") / "character_tidy"
STATIC_DIR = Path("static")
UPLOADS_DIR = Path("data") / "uploads"
CHARACTER_MODELS_DIR = STATIC_DIR / "user_models"

players: dict[str, dict] = {}
client_roles: dict[str, str] = {}
player_update_last_seen: dict[str, float] = {}
PLAYER_UPDATE_MIN_INTERVAL_SEC = 1.0 / 20.0  # 20Hz cap per client
game_session_state: str = "in_game"
player_slot_owner: list[str | None] = [None] * int(LOBBY_ROLE_CAPACITY.get("player", 4))
pending_combat_start_requests: dict[str, dict] = {}
latest_scene_state: dict = {"objects": []}
world_state: dict = {
    "players": {},
    "entities": {},
    "mode": "exploration",
    "combat": {
        "turn": None,
        "order": [],
        "state": {"inCombat": False},
    },
    "scene": latest_scene_state,
}

player = {"x": 0, "y": 0}


def _normalize_role(role_value: str | None) -> str:
    role = str(role_value or "player").strip().lower()
    if role not in {"player", "dm", "dev"}:
        return "player"
    return role


def _build_lobby_state() -> dict:
    counts = {"player": 0, "dm": 0, "dev": 0}
    occupants: dict[str, list[dict]] = {"player": [], "dm": [], "dev": []}

    for sid, role in client_roles.items():
        normalized = _normalize_role(role)
        if normalized not in counts:
            continue
        counts[normalized] += 1
        occupants[normalized].append(
            {
                "id": sid,
                "label": f"{normalized.upper()}-{sid[:6]}",
            }
        )

    slots = {}
    for role in ("player", "dm", "dev"):
        capacity = max(1, int(LOBBY_ROLE_CAPACITY.get(role, 1)))
        used = counts.get(role, 0)
        slots[role] = {
            "capacity": capacity,
            "occupied": used,
            "open": max(0, capacity - used),
            "isFull": used >= capacity,
            "occupants": occupants.get(role, []),
        }

    player_slots: list[dict] = []
    for idx, owner_sid in enumerate(player_slot_owner, start=1):
        occupied = bool(owner_sid)
        player_slots.append(
            {
                "slot": idx,
                "occupied": occupied,
                "sid": owner_sid,
                "actorId": f"player_{idx}" if occupied else None,
            }
        )

    authoritative_sid = _get_authoritative_player_sid()

    return {
        "slots": slots,
        "playerSlots": player_slots,
        "gameState": game_session_state,
        "rolesLocked": False,
        "authoritativePlayerId": authoritative_sid,
        "totalConnected": len(players),
    }


def _can_assign_role(role: str, sid: str | None = None) -> bool:
    normalized = _normalize_role(role)

    if normalized == "player":
        # Keep current player assignment valid even when all slots are full.
        if sid and _get_player_slot_index(sid) is not None:
            return True
        return _find_open_player_slot_index() is not None

    capacity = int(LOBBY_ROLE_CAPACITY.get(normalized, 1))
    used = 0
    for existing_sid, existing_role in client_roles.items():
        if sid and existing_sid == sid:
            continue
        if _normalize_role(existing_role) == normalized:
            used += 1
    return used < max(1, capacity)


def _find_open_player_slot_index() -> int | None:
    for idx, owner_sid in enumerate(player_slot_owner):
        if owner_sid is None:
            return idx
    return None


def _get_player_slot_index(sid: str) -> int | None:
    for idx, owner_sid in enumerate(player_slot_owner):
        if owner_sid == sid:
            return idx
    return None


def _release_player_slot(sid: str):
    idx = _get_player_slot_index(sid)
    if idx is None:
        return
    player_slot_owner[idx] = None


def _claim_player_slot(sid: str) -> int | None:
    existing_idx = _get_player_slot_index(sid)
    if existing_idx is not None:
        return existing_idx
    open_idx = _find_open_player_slot_index()
    if open_idx is None:
        return None
    player_slot_owner[open_idx] = sid
    return open_idx


def _get_authoritative_player_sid() -> str | None:
    for owner_sid in player_slot_owner:
        if owner_sid:
            return owner_sid
    return None


def _refresh_player_authority_flags():
    authoritative_sid = _get_authoritative_player_sid()
    for sid, data in players.items():
        if not isinstance(data, dict):
            continue
        data["isAuthoritative"] = bool(authoritative_sid and sid == authoritative_sid)


def _apply_role_assignment(sid: str, role: str) -> bool:
    normalized = _normalize_role(role)
    previous = _normalize_role(client_roles.get(sid, "player")) if sid in client_roles else None

    if previous == "player" and normalized != "player":
        _release_player_slot(sid)

    slot_index = None
    if normalized == "player":
        slot_index = _claim_player_slot(sid)
        if slot_index is None:
            return False

    client_roles[sid] = normalized
    player_entry = players.setdefault(
        sid,
        {
            "id": sid,
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        },
    )
    player_entry["role"] = normalized
    player_entry["slot"] = (slot_index + 1) if slot_index is not None else None
    if normalized == "player" and slot_index is not None:
        player_entry["actorId"] = f"player_{slot_index + 1}"
    elif normalized == "dm":
        player_entry["actorId"] = "dm_1"
    else:
        player_entry["actorId"] = "dev_1"

    _refresh_player_authority_flags()
    return True


def _broadcast_lobby_state():
    socketio.emit("lobby-state", _build_lobby_state())


def _safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _sanitize_dm_command(raw_command: dict | None) -> dict | None:
    if not isinstance(raw_command, dict):
        return None

    command_type = str(raw_command.get("type") or "").strip().lower()
    payload = raw_command.get("payload") if isinstance(raw_command.get("payload"), dict) else {}

    # Handle generic spawn-entity command (training-dummy, player-dummy, elite-dummy)
    if command_type == "spawn-entity":
        entity_type = str(payload.get("entityType") or "").strip().lower()
        if entity_type not in {"training-dummy", "player-dummy", "elite-dummy"}:
            return None

        position = payload.get("position") if isinstance(payload.get("position"), dict) else {}

        try:
            x = float(position.get("x", 0.0))
            y = float(position.get("y", 0.0))
            z = float(position.get("z", 0.0))
        except (TypeError, ValueError):
            return None

        return {
            "type": "spawn-entity",
            "payload": {
                "entityType": entity_type,
                "position": {"x": x, "y": y, "z": z},
            },
        }

    if command_type == "spawn-training-dummy":
        position = payload.get("position") if isinstance(payload.get("position"), dict) else {}

        try:
            x = float(position.get("x", 0.0))
            y = float(position.get("y", 0.0))
            z = float(position.get("z", 0.0))
        except (TypeError, ValueError):
            return None

        name = str(payload.get("name") or "Training Dummy").strip() or "Training Dummy"

        return {
            "type": "spawn-training-dummy",
            "payload": {
                "position": {"x": x, "y": y, "z": z},
                "name": name,
            },
        }

    if command_type in {"step-turn", "rewind-turn", "replay-last-action", "release-possession", "end-turn"}:
        return {
            "type": command_type,
            "payload": {},
        }

    if command_type == "possess-actor":
        actor_id = str(payload.get("actorId") or "").strip()
        if not actor_id:
            return None
        return {
            "type": "possess-actor",
            "payload": {"actorId": actor_id},
        }

    return None


def _build_world_payload(include_scene: bool = True) -> dict:
    payload = {
        "players": deepcopy(players),
        "entities": deepcopy(world_state.get("entities", {})),
        "mode": str(world_state.get("mode", "exploration")),
        "combat": deepcopy(world_state.get("combat", {"turn": None, "order": [], "state": {}})),
        "session": {
            "gameState": game_session_state,
            "rolesLocked": False,
            "authoritativePlayerId": _get_authoritative_player_sid(),
        },
    }

    if include_scene:
        scene_state = deepcopy(latest_scene_state)
        payload["scene"] = scene_state
        # Keep backward compatibility for clients that expect root-level scene keys.
        payload["objects"] = scene_state.get("objects", {})
        payload["lights"] = scene_state.get("lights", {})

    return payload


def _broadcast_world_update(include_scene: bool = False):
    socketio.emit("world-update", _build_world_payload(include_scene=include_scene))


@socketio.on("connect")
def socket_connect():
    try:
        sid = request.sid
        role = _normalize_role(client_roles.get(sid, "player"))
        players[sid] = {
            "id": sid,
            "role": role,
            "slot": None,
            "actorId": None,
            "isAuthoritative": False,
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        }
        player_update_last_seen[sid] = 0.0

        # Ensure connect-time default role goes through normal assignment flow so player slot ownership
        # and authoritative player selection are initialized immediately.
        if not _apply_role_assignment(sid, role):
            fallback_role = "dev" if _can_assign_role("dev", sid=sid) else "player"
            _apply_role_assignment(sid, fallback_role)

        emit("player-id", {"id": sid})
        emit("world-init", _build_world_payload(include_scene=True))
        emit("players-state", players)
        emit("scene-state", latest_scene_state)
        emit("lobby-state", _build_lobby_state())
        emit("player-joined", players[sid], broadcast=True, include_self=False)
        socketio.emit("players-state", players)
        _broadcast_world_update(include_scene=False)
        _broadcast_lobby_state()
    except Exception as e:
        print(f"[ERROR] socket_connect exception: {e}", flush=True)
        import traceback
        traceback.print_exc()
        raise


@socketio.on("disconnect")
def socket_disconnect():
    sid = request.sid
    was_authoritative = sid == _get_authoritative_player_sid()
    _release_player_slot(sid)
    player_update_last_seen.pop(sid, None)
    players.pop(sid, None)
    client_roles.pop(sid, None)
    if was_authoritative:
        world_state["mode"] = "exploration"
        world_state.setdefault("combat", {}).setdefault("state", {})["inCombat"] = False
    _refresh_player_authority_flags()
    emit("player-left", {"id": sid}, broadcast=True)
    socketio.emit("players-state", players)
    _broadcast_world_update(include_scene=False)
    _broadcast_lobby_state()


@socketio.on("register-role")
def socket_register_role(data):
    sid = request.sid
    role = _normalize_role(data.get("role") if isinstance(data, dict) else None)

    if not _can_assign_role(role, sid=sid):
        emit(
            "role-ack",
            {
                "id": sid,
                "role": players.get(sid, {}).get("role", "player"),
                "accepted": False,
                "reason": "slot-full",
                "requestedRole": role,
            },
        )
        emit("lobby-state", _build_lobby_state())
        return

    if not _apply_role_assignment(sid, role):
        emit(
            "role-ack",
            {
                "id": sid,
                "role": players.get(sid, {}).get("role", "player"),
                "accepted": False,
                "reason": "slot-assign-failed",
                "requestedRole": role,
            },
        )
        emit("lobby-state", _build_lobby_state())
        return

    if sid in players:
        emit("player-update", players[sid], broadcast=True, include_self=False)
        socketio.emit("players-state", players)
        _broadcast_world_update(include_scene=False)
    emit("role-ack", {"id": sid, "role": role, "accepted": True})
    _broadcast_lobby_state()


@socketio.on("start-game")
def socket_start_game(data=None):
    # Session is always live; this endpoint remains as a harmless compatibility no-op.
    _refresh_player_authority_flags()
    state_payload = {
        "gameState": game_session_state,
        "rolesLocked": False,
        "authoritativePlayerId": _get_authoritative_player_sid(),
    }
    emit("start-game-ack", {"ok": True, "state": state_payload})
    _broadcast_lobby_state()
    _broadcast_world_update(include_scene=False)

@socketio.on("player-update")
def socket_player_update(data):
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return

    now = perf_counter()
    last_seen = player_update_last_seen.get(sid, 0.0)
    if (now - last_seen) < PLAYER_UPDATE_MIN_INTERVAL_SEC:
        return
    player_update_last_seen[sid] = now

    position = data.get("position") if isinstance(data.get("position"), dict) else None
    rotation = data.get("rotation") if isinstance(data.get("rotation"), dict) else None

    if position:
        players[sid]["position"] = {
            "x": float(position.get("x", 0.0)),
            "y": float(position.get("y", 0.0)),
            "z": float(position.get("z", 0.0)),
        }
    if rotation:
        players[sid]["rotation"] = {
            "x": float(rotation.get("x", 0.0)),
            "y": float(rotation.get("y", 0.0)),
            "z": float(rotation.get("z", 0.0)),
        }

    avatar = data.get("avatar") if isinstance(data.get("avatar"), dict) else None
    if avatar:
        model_url = avatar.get("modelUrl")
        bone_poses = avatar.get("bonePoses") if isinstance(avatar.get("bonePoses"), dict) else {}
        scale_raw = avatar.get("scale", 1.0)
        try:
            scale = float(scale_raw)
        except (TypeError, ValueError):
            scale = 1.0

        players[sid]["avatar"] = {
            "modelUrl": str(model_url) if model_url is not None else "fallback",
            "bonePoses": bone_poses,
            "scale": scale,
        }
    else:
        players[sid].pop("avatar", None)

    movement_preview = data.get("movementPreview") if isinstance(data.get("movementPreview"), dict) else None
    if movement_preview:
        cursor = movement_preview.get("cursor") if isinstance(movement_preview.get("cursor"), dict) else None
        sanitized_cursor = None
        if cursor:
            try:
                sanitized_cursor = {
                    "x": float(cursor.get("x", 0.0)),
                    "y": float(cursor.get("y", 0.0)),
                    "z": float(cursor.get("z", 0.0)),
                    "kind": str(cursor.get("kind", "hover")),
                }
            except (TypeError, ValueError):
                sanitized_cursor = None

        try:
            movement_remaining = float(movement_preview.get("movementRemaining", 0.0))
        except (TypeError, ValueError):
            movement_remaining = 0.0

        players[sid]["movementPreview"] = {
            "showZone": bool(movement_preview.get("showZone", False)),
            "movementRemaining": max(0.0, movement_remaining),
            "cursor": sanitized_cursor,
        }
    else:
        players[sid].pop("movementPreview", None)

    combat_sync = data.get("combatSync") if isinstance(data.get("combatSync"), dict) else None
    authoritative_sid = _get_authoritative_player_sid()
    if combat_sync and sid == authoritative_sid:
        phase_raw = str(combat_sync.get("phase", "PLAYER")).strip().upper()
        phase = phase_raw if phase_raw in {"PLAYER", "ENEMY", "TRANSITION"} else "PLAYER"

        turn_queue_raw = combat_sync.get("turnQueue") if isinstance(combat_sync.get("turnQueue"), list) else []
        turn_queue = []
        for entry in turn_queue_raw[:32]:
            if not isinstance(entry, dict):
                continue
            entry_id = str(entry.get("id") or "").strip()
            if not entry_id:
                continue
            entry_type = str(entry.get("type") or "enemy").strip().lower()
            if entry_type not in {"player", "enemy"}:
                entry_type = "enemy"
            turn_queue.append(
                {
                    "id": entry_id,
                    "type": entry_type,
                    "name": str(entry.get("name") or ("Player" if entry_type == "player" else "Enemy")),
                }
            )

        enemies_raw = combat_sync.get("enemies") if isinstance(combat_sync.get("enemies"), list) else []
        enemies = []
        for enemy in enemies_raw[:64]:
            if not isinstance(enemy, dict):
                continue
            actor_id = str(enemy.get("actorId") or "").strip()
            if not actor_id:
                continue
            position = enemy.get("position") if isinstance(enemy.get("position"), dict) else {}
            enemies.append(
                {
                    "actorId": actor_id,
                    "name": str(enemy.get("name") or "Training Dummy"),
                    "position": {
                        "x": _safe_float(position.get("x", 0.0)),
                        "y": _safe_float(position.get("y", 0.0)),
                        "z": _safe_float(position.get("z", 0.0)),
                    },
                    "rotationY": _safe_float(enemy.get("rotationY", 0.0)),
                    "hp": max(0.0, _safe_float(enemy.get("hp", 0.0))),
                    "maxHp": max(1.0, _safe_float(enemy.get("maxHp", 50.0), 50.0)),
                    "radius": max(0.1, _safe_float(enemy.get("radius", 0.5), 0.5)),
                    "movementRemaining": max(0.0, _safe_float(enemy.get("movementRemaining", 30.0), 30.0)),
                    "actionAvailable": bool(enemy.get("actionAvailable", True)),
                    "playerSpotted": bool(enemy.get("playerSpotted", False)),
                    "ac": max(1.0, _safe_float(enemy.get("ac", 12.0), 12.0)),
                    "attackBonus": _safe_float(enemy.get("attackBonus", 4.0), 4.0),
                    "damageRoll": max(1.0, _safe_float(enemy.get("damageRoll", 1.0), 1.0)),
                    "damageBonus": _safe_float(enemy.get("damageBonus", 0.0), 0.0),
                }
            )

        player_sync_raw = combat_sync.get("player") if isinstance(combat_sync.get("player"), dict) else {}
        player_position = player_sync_raw.get("position") if isinstance(player_sync_raw.get("position"), dict) else {}
        player_sync = {
            "hp": max(0.0, _safe_float(player_sync_raw.get("hp", players[sid].get("hp", 100.0)), 100.0)),
            "maxHp": max(1.0, _safe_float(player_sync_raw.get("maxHp", players[sid].get("maxHp", 100.0)), 100.0)),
            "movementRemaining": max(0.0, _safe_float(player_sync_raw.get("movementRemaining", 30.0), 30.0)),
            "actionUsed": bool(player_sync_raw.get("actionUsed", False)),
            "bonusUsed": bool(player_sync_raw.get("bonusUsed", False)),
            "hasActed": bool(player_sync_raw.get("hasActed", False)),
            "position": {
                "x": _safe_float(player_position.get("x", players[sid]["position"].get("x", 0.0))),
                "y": _safe_float(player_position.get("y", players[sid]["position"].get("y", 0.0))),
                "z": _safe_float(player_position.get("z", players[sid]["position"].get("z", 0.0))),
            },
        }

        players[sid]["combatSync"] = {
            "inCombat": bool(combat_sync.get("inCombat", False)),
            "phase": phase,
            "currentTurnIndex": max(0, int(_safe_float(combat_sync.get("currentTurnIndex", 0)))),
            "roundNumber": max(0, int(_safe_float(combat_sync.get("roundNumber", 0)))),
            "turnQueue": turn_queue,
            "player": player_sync,
            "enemies": enemies,
            "timestamp": int(_safe_float(combat_sync.get("timestamp", 0))),
        }
    else:
        players[sid].pop("combatSync", None)

    emit("player-update", players[sid], broadcast=True, include_self=False)
    _broadcast_world_update(include_scene=False)


@socketio.on("scene-update")
def socket_scene_update(data):
    global latest_scene_state
    if not isinstance(data, dict):
        return

    if "objects" in data and isinstance(data.get("objects"), (list, dict)):
        latest_scene_state = data
        world_state["scene"] = latest_scene_state
    emit("scene-update", data, broadcast=True, include_self=False)
    _broadcast_world_update(include_scene=True)


@socketio.on("dm-command")
def socket_dm_command(data):
    try:
        sid = request.sid
        role = client_roles.get(sid, "player")
        if role != "dm":
            emit("dm-command-denied", {"reason": "requires-dm-role"})
            return

        command = _sanitize_dm_command(data.get("command") if isinstance(data, dict) else None)
        if not command:
            emit("dm-command-denied", {"reason": "invalid-command"})
            return

        print(f"[DM-COMMAND] sid={sid[:6]} type={command.get('type')}", flush=True)
        emit(
            "dm-command",
            {
                "from": sid,
                "role": role,
                "command": command,
            },
            broadcast=True,
        )
    except Exception as e:
        print(f"[ERROR] socket_dm_command exception: {e}", flush=True)
        import traceback
        traceback.print_exc()


@socketio.on("combat-action-record")
def socket_combat_action_record(data):
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return

    if players[sid].get("role", "player") != "player":
        return

    record = data.get("record") if isinstance(data.get("record"), dict) else None
    if not record:
        return

    start_time_ms_raw = data.get("startTimeMs")
    try:
        start_time_ms = int(float(start_time_ms_raw))
    except (TypeError, ValueError):
        start_time_ms = None

    timeline_id_raw = data.get("timelineId")
    timeline_id = str(timeline_id_raw).strip() if timeline_id_raw is not None else ""
    if not timeline_id:
        timeline_id = None

    payload = {
        "from": sid,
        "role": players[sid].get("role", "player"),
        "record": record,
    }
    if start_time_ms is not None:
        payload["startTimeMs"] = start_time_ms
    if timeline_id is not None:
        payload["timelineId"] = timeline_id

    emit(
        "combat-action-record",
        payload,
        broadcast=True,
        include_self=False,
    )


def _get_dm_sids() -> list[str]:
    return [sid for sid, role in client_roles.items() if _normalize_role(role) == "dm"]


def _broadcast_combat_state(active: bool, initiator: str, target_id: str | None = None, approver: str | None = None):
    if active:
        world_state["mode"] = "combat"
        world_state.setdefault("combat", {}).setdefault("state", {})["inCombat"] = True
        world_state["combat"]["state"]["initiator"] = initiator
        if approver:
            world_state["combat"]["state"]["approvedBy"] = approver
        if target_id:
            world_state["combat"]["state"]["targetId"] = target_id
        socketio.emit(
            "combat-state",
            {
                "active": True,
                "initiator": initiator,
                "targetId": target_id or None,
                "mode": "combat",
                "approvedBy": approver,
            },
        )
    else:
        world_state["mode"] = "exploration"
        world_state.setdefault("combat", {}).setdefault("state", {})["inCombat"] = False
        world_state["combat"]["state"].pop("targetId", None)
        world_state["combat"]["state"].pop("approvedBy", None)
        socketio.emit(
            "combat-state",
            {
                "active": False,
                "initiator": initiator,
                "mode": "exploration",
            },
        )
    _broadcast_world_update(include_scene=False)


@socketio.on("combat-start-request")
def socket_combat_start_request(data):
    sid = request.sid
    if sid not in players:
        return

    payload = data if isinstance(data, dict) else {}
    target_id = str(payload.get("targetId") or "").strip()
    request_id = str(payload.get("requestId") or uuid4().hex).strip() or uuid4().hex
    dm_sids = _get_dm_sids()

    if not dm_sids:
        _broadcast_combat_state(True, initiator=sid, target_id=target_id or None)
        emit("combat-start-result", {
            "requestId": request_id,
            "approved": True,
            "targetId": target_id or None,
            "status": "auto-approved-no-dm",
        }, to=sid)
        return

    pending_combat_start_requests[request_id] = {
        "requesterSid": sid,
        "targetId": target_id,
    }

    emit("combat-start-result", {
        "requestId": request_id,
        "approved": False,
        "targetId": target_id or None,
        "status": "pending",
    }, to=sid)

    for dm_sid in dm_sids:
        emit("combat-start-request", {
            "requestId": request_id,
            "from": sid,
            "targetId": target_id or None,
        }, to=dm_sid)


@socketio.on("combat-start-decision")
def socket_combat_start_decision(data):
    sid = request.sid
    role = _normalize_role(client_roles.get(sid, players.get(sid, {}).get("role", "player")))
    if role != "dm":
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return

    payload = data if isinstance(data, dict) else {}
    request_id = str(payload.get("requestId") or "").strip()
    if not request_id:
        emit("combat-state-denied", {"reason": "missing-request-id"})
        return

    pending = pending_combat_start_requests.pop(request_id, None)
    if not pending:
        emit("combat-state-denied", {"reason": "unknown-request"})
        return

    requester_sid = str(pending.get("requesterSid") or "").strip()
    target_id = str(pending.get("targetId") or "").strip()
    approved = bool(payload.get("approved", False))

    emit("combat-start-result", {
        "requestId": request_id,
        "approved": approved,
        "targetId": target_id or None,
        "status": "approved" if approved else "rejected",
    }, to=requester_sid)

    if approved:
        _broadcast_combat_state(True, initiator=requester_sid or sid, target_id=target_id or None, approver=sid)


@socketio.on("combat-start")
def socket_combat_start(data):
    sid = request.sid
    if sid not in players:
        return

    role = _normalize_role(client_roles.get(sid, players[sid].get("role", "player")))
    has_dm = len(_get_dm_sids()) > 0
    if role != "dm" and has_dm:
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return

    payload = data if isinstance(data, dict) else {}
    target_id = str(payload.get("targetId") or "").strip()
    print(f"[COMBAT] start sid={sid[:6]} target={target_id or '-'}")
    _broadcast_combat_state(True, initiator=sid, target_id=target_id or None)


@socketio.on("combat-end")
def socket_combat_end(data=None):
    sid = request.sid
    if sid not in players:
        return

    role = _normalize_role(client_roles.get(sid, players[sid].get("role", "player")))
    has_dm = len(_get_dm_sids()) > 0
    if role != "dm" and has_dm:
        emit("combat-state-denied", {"reason": "requires-dm-role"})
        return

    print(f"[COMBAT] end sid={sid[:6]}")
    _broadcast_combat_state(False, initiator=sid)

@socketio.on("timeline-start")
def socket_timeline_start(data):
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return

    if players[sid].get("role", "player") != "player":
        return

    timeline_id = str(data.get("timelineId") or "").strip()
    if not timeline_id:
        return

    start_time_ms_raw = data.get("startTimeMs")
    try:
        start_time_ms = int(float(start_time_ms_raw))
    except (TypeError, ValueError):
        return

    emit(
        "timeline-start",
        {
            "from": sid,
            "role": players[sid].get("role", "player"),
            "timelineId": timeline_id,
            "startTimeMs": start_time_ms,
        },
        broadcast=True,
        include_self=False,
    )


@socketio.on("dice-roll-event")
def socket_dice_roll_event(data):
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return

    if players[sid].get("role", "player") != "player":
        return

    roll = data.get("roll") if isinstance(data.get("roll"), dict) else None
    if not roll:
        return

    emit(
        "dice-roll-event",
        {
            "from": sid,
            "role": players[sid].get("role", "player"),
            "roll": roll,
        },
        broadcast=True,
        include_self=False,
    )

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/map3d")
def map3d_page():
    return send_from_directory(STATIC_DIR, "map3d.html")

@app.route("/move", methods=["POST"])
def move():
    data = request.get_json()
    player["x"] += int(data.get("x",0))
    player["y"] += int(data.get("y",0))
    return jsonify(ok=True)

@app.route("/state")
def state():
    return jsonify(player)


@app.route("/scene_state", methods=["GET"])
def scene_state_get():
    return jsonify(_build_world_payload(include_scene=True))


@app.route("/scene_state", methods=["POST"])
def scene_state_post():
    global latest_scene_state
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, error="invalid scene payload"), 400

    incoming_scene = data.get("scene") if isinstance(data.get("scene"), dict) else data
    if not isinstance(incoming_scene, dict):
        return jsonify(ok=False, error="invalid scene state"), 400

    latest_scene_state = {
        "objects": incoming_scene.get("objects", {}),
        "lights": incoming_scene.get("lights", {}),
    }
    world_state["scene"] = latest_scene_state

    if isinstance(data.get("entities"), dict):
        world_state["entities"] = data.get("entities", {})
    if isinstance(data.get("combat"), dict):
        world_state["combat"] = data.get("combat", world_state["combat"])

    _broadcast_world_update(include_scene=True)
    return jsonify(ok=True, state=latest_scene_state)


def _resolve_contract_file(filename: str) -> Path | None:
    candidates = [
        CONTRACTS_DIR / filename,
        STATIC_DIR / filename,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


@app.route("/character_template.json")
def character_template_contract():
    path = _resolve_contract_file("character_template.json")
    if not path:
        return jsonify(ok=False, error="character_template.json not found"), 404
    return send_file(path, mimetype="application/json")


@app.route("/combat_instance.json")
def combat_instance_contract():
    path = _resolve_contract_file("combat_instance.json")
    if not path:
        return jsonify(ok=False, error="combat_instance.json not found"), 404
    return send_file(path, mimetype="application/json")


@app.route("/character_master.json")
def character_master_contract():
    path = _resolve_contract_file("character_master.json")
    if not path:
        return jsonify(ok=False, error="character_master.json not found"), 404
    return send_file(path, mimetype="application/json")


@app.route("/data/character_tidy/<path:filename>")
def character_tidy_data_files(filename: str):
    if not CONTRACTS_DIR.exists():
        return jsonify(ok=False, error="data/character_tidy not found"), 404
    return send_from_directory(CONTRACTS_DIR, filename)


@app.route("/api/import-pdf", methods=["POST"])
def import_pdf_api():
    pdf_file = request.files.get("pdf")
    if not pdf_file or not pdf_file.filename:
        return jsonify(ok=False, error="missing pdf file"), 400

    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify(ok=False, error="file must be a .pdf"), 400

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    filename = secure_filename(pdf_file.filename)
    source_pdf_path = UPLOADS_DIR / filename
    pdf_file.save(source_pdf_path)

    CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    tables = parse_character_tables(source_pdf_path)
    write_outputs(CONTRACTS_DIR, tables)

    return jsonify(
        ok=True,
        source_file=filename,
        character=tables.get("character", {}),
        out_dir=str(CONTRACTS_DIR),
    )


@app.route("/api/player-info")
def player_info_api():
    path = _resolve_contract_file("character_master.json")
    if not path:
        return jsonify(ok=False, error="character_master.json not found"), 404

    import json

    master = json.loads(path.read_text(encoding="utf-8"))
    identity = master.get("identity", {})
    core = master.get("core_stats", {})
    hp = master.get("hit_points", {})

    max_hp = hp.get("max_hp")
    try:
        current_hp = int(hp.get("current_hp"))
    except (TypeError, ValueError):
        current_hp = max_hp  # treat missing/unparsed current HP as full health

    return jsonify(
        ok=True,
        summary={
            "name": identity.get("character_name"),
            "class_level": identity.get("class_level"),
            "species": identity.get("species"),
            "background": identity.get("background"),
            "armor_class": core.get("armor_class"),
            "max_hp": max_hp,
            "current_hp": current_hp,
            "speed_ft": core.get("speed_ft"),
            "proficiency_bonus": core.get("proficiency_bonus"),
            "initiative_bonus": core.get("initiative_bonus"),
        },
        master=master,
    )


@app.route("/lobby_state", methods=["GET"])
def lobby_state_api():
    return jsonify(ok=True, lobby=_build_lobby_state())


@app.route("/api/upload-character-model", methods=["POST"])
def upload_character_model_api():
    files = [f for f in request.files.getlist("model_files") if f and f.filename]
    # Backward-compatible fallback for old single-file clients.
    single = request.files.get("model")
    if not files and single and single.filename:
        files = [single]

    if not files:
        return jsonify(ok=False, error="missing model file(s)"), 400

    CHARACTER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    bundle_id = uuid4().hex
    bundle_dir = CHARACTER_MODELS_DIR / bundle_id
    bundle_dir.mkdir(parents=True, exist_ok=True)

    saved_names: list[str] = []
    for uploaded in files:
        safe_name = secure_filename(uploaded.filename)
        if not safe_name:
            continue
        (bundle_dir / safe_name).parent.mkdir(parents=True, exist_ok=True)
        uploaded.save(bundle_dir / safe_name)
        saved_names.append(safe_name)

    if not saved_names:
        return jsonify(ok=False, error="no valid files uploaded"), 400

    model_entry = secure_filename(request.form.get("model_entry", ""))
    allowed_primary = (".glb", ".gltf")

    if not model_entry or model_entry not in saved_names:
        glb_candidates = [n for n in saved_names if n.lower().endswith(".glb")]
        gltf_candidates = [n for n in saved_names if n.lower().endswith(".gltf")]
        model_entry = (glb_candidates or gltf_candidates or [""])[0]

    if not model_entry or not model_entry.lower().endswith(allowed_primary):
        return jsonify(ok=False, error="primary model must be .glb or .gltf"), 400

    return jsonify(
        ok=True,
        model_url=f"/static/user_models/{bundle_id}/{model_entry}",
        file_name=model_entry,
        uploaded_files=saved_names,
    )

if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=True)
