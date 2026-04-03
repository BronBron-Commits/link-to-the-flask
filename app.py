from gevent import monkey
monkey.patch_all()
import gevent

from pathlib import Path
from copy import deepcopy
from uuid import uuid4
from time import perf_counter
from threading import Lock
import os
import random as _random

from flask import Flask, request, jsonify, render_template, send_file, send_from_directory, Response
from flask_socketio import SocketIO, emit
from werkzeug.utils import secure_filename

from scripts.pdf_to_tidy_data import parse_character_tables, write_outputs, build_master_character_record

app = Flask(__name__)
socketio = SocketIO(app, cors_allowed_origins='*', async_mode='gevent', 
                   ping_timeout=60, ping_interval=25)

LOBBY_ROLE_CAPACITY: dict[str, int] = {
    "player": 4,
    "dm": 1,
    "dev": 1,
}

CONTRACTS_DIR = Path("data") / "character_tidy"
STATIC_DIR = Path("static")
UPLOADS_DIR = Path("data") / "uploads"
CHARACTER_MODELS_DIR = STATIC_DIR / "user_models"
SERVER_BUILD_TAG = "combat-debug-2026-04-02c"


def _resolve_training_dummy_fallback_model_url() -> str:
    return "/static/untitled.glb"


TRAINING_DUMMY_FALLBACK_MODEL_URL = _resolve_training_dummy_fallback_model_url()

players: dict[str, dict] = {}
client_roles: dict[str, str] = {}
client_resume_keys: dict[str, str] = {}
player_update_last_seen: dict[str, float] = {}
PLAYER_UPDATE_MIN_INTERVAL_SEC = 1.0 / 20.0  # 20Hz cap per client
RESUME_SESSION_TTL_SEC = 300.0
turn_lock = Lock()
resume_sessions: dict[str, dict] = {}
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


def _sanitize_resume_key(value: str | None) -> str | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    if len(raw) > 96:
        raw = raw[:96]
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    cleaned = "".join(ch for ch in raw if ch in allowed)
    return cleaned or None


def _extract_resume_key(connect_payload: dict | None = None) -> str | None:
    if isinstance(connect_payload, dict):
        from_payload = _sanitize_resume_key(connect_payload.get("resumeKey"))
        if from_payload:
            return from_payload
    return _sanitize_resume_key(request.args.get("resumeKey"))


def _cleanup_resume_sessions(now: float | None = None):
    current = now if now is not None else perf_counter()
    expired: list[str] = []
    for key, session in resume_sessions.items():
        expires_at = float(session.get("expiresAt", 0.0))
        if expires_at <= current:
            expired.append(key)
    for key in expired:
        resume_sessions.pop(key, None)


def _save_resume_snapshot_for_sid(sid: str, now: float | None = None):
    resume_key = client_resume_keys.get(sid)
    if not resume_key:
        return

    player_data = players.get(sid)
    if not isinstance(player_data, dict):
        return

    current = now if now is not None else perf_counter()
    role = _normalize_role(client_roles.get(sid, player_data.get("role", "player")))
    slot_index = _get_player_slot_index(sid)

    snapshot = {
        "sid": sid,
        "role": role,
        "slotIndex": slot_index,
        "actorId": player_data.get("actorId"),
        "isAuthoritative": bool(player_data.get("isAuthoritative", False)),
        "position": deepcopy(player_data.get("position", {"x": 0.0, "y": 0.0, "z": 0.0})),
        "rotation": deepcopy(player_data.get("rotation", {"x": 0.0, "y": 0.0, "z": 0.0})),
        "avatar": deepcopy(player_data.get("avatar")) if isinstance(player_data.get("avatar"), dict) else None,
        "movementPreview": deepcopy(player_data.get("movementPreview")) if isinstance(player_data.get("movementPreview"), dict) else None,
        "ac": player_data.get("ac"),
        "max_hp": player_data.get("max_hp"),
        "hp": player_data.get("hp"),
        "initiative_bonus": player_data.get("initiative_bonus"),
        "speed_ft": player_data.get("speed_ft"),
        "expiresAt": current + RESUME_SESSION_TTL_SEC,
        "lastSeen": current,
    }
    resume_sessions[resume_key] = snapshot


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
        "serverBuild": SERVER_BUILD_TAG,
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


def _is_enemy_entity(entity: dict) -> bool:
    if not isinstance(entity, dict):
        return False
    entity_type = str(entity.get("type") or entity.get("entityType") or "").strip().lower()
    return entity_type in {"enemy", "training-dummy", "player-dummy", "elite-dummy"}


def _apply_training_dummy_avatar_fallbacks(entities: dict) -> dict:
    if not isinstance(entities, dict):
        return {}

    for entity in entities.values():
        if not isinstance(entity, dict):
            continue

        entity_type = str(entity.get("type") or entity.get("entityType") or "").strip().lower()
        if entity_type != "training-dummy":
            continue

        avatar = entity.get("avatar") if isinstance(entity.get("avatar"), dict) else {}
        model_url = str(avatar.get("modelUrl") or entity.get("modelUrl") or "").strip()
        if not model_url:
            avatar["modelUrl"] = TRAINING_DUMMY_FALLBACK_MODEL_URL
            entity["modelUrl"] = TRAINING_DUMMY_FALLBACK_MODEL_URL
            entity["avatar"] = avatar

    return entities


def _build_turn_order(initiator_sid: str | None = None) -> list[dict]:
    order: list[dict] = []

    for sid, player_entry in players.items():
        if not isinstance(player_entry, dict):
            continue
        if _normalize_role(player_entry.get("role")) != "player":
            continue
        actor_id = str(player_entry.get("actorId") or "").strip()
        if not actor_id:
            continue
        order.append({
            "id": actor_id,
            "type": "player",
            "ownerSid": sid,
            "name": str(player_entry.get("name") or actor_id),
        })

    if initiator_sid:
        for idx, entry in enumerate(order):
            if entry.get("ownerSid") == initiator_sid:
                if idx > 0:
                    order.insert(0, order.pop(idx))
                break

    entities = world_state.get("entities", {})
    if isinstance(entities, dict):
        for entity_id, entity in entities.items():
            if not _is_enemy_entity(entity):
                continue
            actor_id = str(entity_id or "").strip()
            if not actor_id:
                continue
            order.append({
                "id": actor_id,
                "type": "enemy",
                "name": str((entity or {}).get("name") or actor_id),
            })

    return order


def _is_players_turn(sid: str) -> bool:
    """Check whether the active turn belongs to the player identified by sid.

    Validates by actorId (slot-stable) rather than ownerSid (connection-volatile)
    so that brief disconnects and reconnects do not invalidate turn ownership.
    """
    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    turn = combat.get("turn", 0)
    turn_index = int(turn) if turn is not None else 0

    if not order or not (0 <= turn_index < len(order)):
        return False

    current = order[turn_index]
    if not isinstance(current, dict):
        return False
    if current.get("type") != "player":
        return False

    # Primary: match by actorId (slot-based, survives reconnect)
    actor_id = str(players.get(sid, {}).get("actorId") or "").strip()
    if actor_id and current.get("id") == actor_id:
        return True

    # Fallback: ownerSid for initial connection before resume restores slot
    return str(current.get("ownerSid") or "") == sid


def _update_turn_order_owner(previous_sid: str, new_sid: str):
    """Repoint ownerSid in the live combat order when a player reconnects."""
    combat = world_state.get("combat", {})
    order = combat.get("order")
    if not isinstance(order, list):
        return
    for entry in order:
        if isinstance(entry, dict) and entry.get("ownerSid") == previous_sid:
            entry["ownerSid"] = new_sid


def _emit_current_combat_state(to_sid: str):
    combat_state = world_state.setdefault("combat", {}).setdefault("state", {})
    in_combat = bool(combat_state.get("inCombat", False))
    if in_combat:
        emit(
            "combat-state",
            {
                "active": True,
                "initiator": combat_state.get("initiator"),
                "targetId": combat_state.get("targetId"),
                "mode": "combat",
                "approvedBy": combat_state.get("approvedBy"),
            },
            to=to_sid,
        )
    else:
        emit(
            "combat-state",
            {
                "active": False,
                "initiator": combat_state.get("initiator"),
                "mode": "exploration",
            },
            to=to_sid,
        )


@socketio.on("connect")
def socket_connect(connect_payload=None):
    try:
        _cleanup_resume_sessions()
        sid = request.sid

        resume_key = _extract_resume_key(connect_payload)
        if resume_key:
            client_resume_keys[sid] = resume_key

        resumed = False
        resumed_snapshot = None
        if resume_key:
            snapshot = resume_sessions.get(resume_key)
            if isinstance(snapshot, dict):
                previous_sid = str(snapshot.get("sid") or "").strip()
                if previous_sid and previous_sid != sid:
                    previous_slot_index = _get_player_slot_index(previous_sid)
                    if previous_slot_index is not None:
                        player_slot_owner[previous_slot_index] = None
                    player_update_last_seen.pop(previous_sid, None)
                    players.pop(previous_sid, None)
                    client_roles.pop(previous_sid, None)
                    client_resume_keys.pop(previous_sid, None)
                resumed_snapshot = snapshot
                resumed = True
                # Repoint ownerSid in live combat order so turn ownership survives reconnect.
                if previous_sid and previous_sid != sid:
                    _update_turn_order_owner(previous_sid, sid)

        role = _normalize_role((resumed_snapshot or {}).get("role") if resumed_snapshot else client_roles.get(sid, "player"))

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

        if resumed_snapshot and isinstance(resumed_snapshot.get("slotIndex"), int):
            slot_index = int(resumed_snapshot.get("slotIndex"))
            if 0 <= slot_index < len(player_slot_owner):
                player_slot_owner[slot_index] = sid

        # Ensure connect-time default role goes through normal assignment flow so player slot ownership
        # and authoritative player selection are initialized immediately.
        if not _apply_role_assignment(sid, role):
            fallback_role = "dev" if _can_assign_role("dev", sid=sid) else "player"
            _apply_role_assignment(sid, fallback_role)

        if resumed and resumed_snapshot:
            player_entry = players.get(sid)
            if isinstance(player_entry, dict):
                if isinstance(resumed_snapshot.get("position"), dict):
                    player_entry["position"] = resumed_snapshot["position"]
                if isinstance(resumed_snapshot.get("rotation"), dict):
                    player_entry["rotation"] = resumed_snapshot["rotation"]
                if isinstance(resumed_snapshot.get("avatar"), dict):
                    player_entry["avatar"] = resumed_snapshot["avatar"]
                if isinstance(resumed_snapshot.get("movementPreview"), dict):
                    player_entry["movementPreview"] = resumed_snapshot["movementPreview"]
                # Restore character combat stats saved from prior PDF import.
                if resumed_snapshot.get("ac") is not None:
                    player_entry["ac"] = int(_safe_float(resumed_snapshot["ac"]))
                if resumed_snapshot.get("max_hp") is not None:
                    player_entry["max_hp"] = int(_safe_float(resumed_snapshot["max_hp"]))
                if resumed_snapshot.get("hp") is not None:
                    player_entry["hp"] = _safe_float(resumed_snapshot["hp"])
                elif player_entry.get("max_hp") is not None:
                    player_entry["hp"] = float(player_entry["max_hp"])
                if resumed_snapshot.get("initiative_bonus") is not None:
                    player_entry["initiative_bonus"] = int(_safe_float(resumed_snapshot["initiative_bonus"]))
                if resumed_snapshot.get("speed_ft") is not None:
                    player_entry["speed_ft"] = int(_safe_float(resumed_snapshot["speed_ft"]))

            _save_resume_snapshot_for_sid(sid)

        emit("player-id", {"id": sid})
        emit("server-build", {"build": SERVER_BUILD_TAG})
        emit("world-init", _build_world_payload(include_scene=True))
        emit("players-state", players)
        emit("scene-state", latest_scene_state)
        emit("lobby-state", _build_lobby_state())
        _emit_current_combat_state(sid)
        _emit_combat_turn_to_sid(sid)
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
    _save_resume_snapshot_for_sid(sid)
    # Release slot so reconnect resume can reclaim it, but DO NOT touch combat state.
    # Combat must survive transient disconnects; the resume system restores authority.
    _release_player_slot(sid)
    player_update_last_seen.pop(sid, None)
    players.pop(sid, None)
    client_roles.pop(sid, None)
    client_resume_keys.pop(sid, None)
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
        _save_resume_snapshot_for_sid(sid)
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

    _save_resume_snapshot_for_sid(sid)

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
        combat_order = _build_turn_order(initiator_sid=initiator)
        combat_state = {
            "inCombat": True,
            "initiator": initiator,
            "roundNumber": 1,
        }
        if approver:
            combat_state["approvedBy"] = approver
        if target_id:
            combat_state["targetId"] = target_id
        world_state["combat"] = {
            "turn": 0,
            "order": combat_order,
            "state": combat_state,
        }
        if target_id:
            _ensure_enemy_actor_registered(target_id)
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
        # Emit turn payload immediately so late-joiners get the current state.
        socketio.emit("combat-turn", _build_combat_turn_payload())
        socketio.emit("combat-full-state", world_state.get("combat", {}))
    else:
        world_state["mode"] = "exploration"
        world_state["combat"] = {
            "turn": None,
            "order": [],
            "state": {"inCombat": False},
        }
        socketio.emit(
            "combat-state",
            {
                "active": False,
                "initiator": initiator,
                "mode": "exploration",
            },
        )
        socketio.emit("combat-full-state", world_state.get("combat", {}))
        socketio.emit("combat-reset", {})
    _broadcast_world_update(include_scene=False)


@socketio.on("combat-start-request")
def socket_combat_start_request(data):
    sid = request.sid
    if sid not in players:
        return

    payload = data if isinstance(data, dict) else {}
    target_id = str(payload.get("targetId") or "").strip()
    request_id = str(payload.get("requestId") or uuid4().hex).strip() or uuid4().hex

    if world_state.get("combat", {}).get("state", {}).get("inCombat"):
        emit("combat-start-result", {
            "requestId": request_id,
            "approved": False,
            "targetId": target_id or None,
            "status": "already-in-combat",
        }, to=sid)
        return

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
        "createdAt": perf_counter(),
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

    if perf_counter() - float(pending.get("createdAt", 0.0)) > 30.0:
        emit("combat-state-denied", {"reason": "request-expired"})
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

    if world_state.get("combat", {}).get("state", {}).get("inCombat"):
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
    for player_sid in list(players.keys()):
        _save_resume_snapshot_for_sid(player_sid)

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


@socketio.on("player-character-stats")
def socket_player_character_stats(data):
    """Client pushes key character stats (AC, max HP, etc.) to the server so
    combat calculations use real values from the imported character sheet."""
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return
    if _normalize_role(client_roles.get(sid, "player")) != "player":
        return

    player_entry = players[sid]

    def _coerce_int(key: str):
        raw = data.get(key)
        if raw is None:
            return None
        try:
            return int(float(raw))
        except (TypeError, ValueError):
            return None

    ac = _coerce_int("ac")
    max_hp = _coerce_int("maxHp")
    initiative_bonus = _coerce_int("initiativeBonus")
    speed_ft = _coerce_int("speedFt")

    if ac is not None:
        player_entry["ac"] = ac
    if max_hp is not None:
        player_entry["max_hp"] = max_hp
        # Only set current hp from max if not already tracking damage.
        if "hp" not in player_entry:
            player_entry["hp"] = float(max_hp)
    if initiative_bonus is not None:
        player_entry["initiative_bonus"] = initiative_bonus
    if speed_ft is not None:
        player_entry["speed_ft"] = speed_ft

    _save_resume_snapshot_for_sid(sid)
    print(f"[CHAR-STATS] sid={sid[:6]} ac={ac} max_hp={max_hp} init={initiative_bonus} spd={speed_ft}", flush=True)
    emit("player-character-stats-ack", {"ok": True, "ac": ac, "maxHp": max_hp})


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


def _advance_server_turn() -> dict | None:
    combat = world_state.setdefault("combat", {})
    combat_state = combat.setdefault("state", {})
    order = combat.get("order") or []

    if not order:
        print("[TURN] ERROR: empty order", flush=True)
        return None

    # Keep compatibility with existing schema (`turn`) while exposing turnIndex in payload.
    current = combat.get("turn")
    idx = int(current) if current is not None else -1
    round_number = max(1, int(_safe_float(combat_state.get("roundNumber", 1))))

    print("ORDER:", order, flush=True)
    print("TURN INDEX:", idx, flush=True)
    print(f"[TURN] BEFORE idx={idx}, order_len={len(order)}", flush=True)

    idx += 1
    if idx >= len(order):
        idx = 0
        round_number += 1

    combat["turn"] = idx
    combat_state["roundNumber"] = round_number

    current_actor = order[idx]
    print(f"[TURN] AFTER idx={idx}, actor={current_actor.get('id')}", flush=True)

    return {
        "turnIndex": idx,
        "order": order,
        "roundNumber": round_number,
        "currentActor": current_actor,
    }


def _build_combat_turn_payload() -> dict:
    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    turn = combat.get("turn")
    turn_index = int(turn) if turn is not None else 0
    if order:
        turn_index = max(0, min(turn_index, len(order) - 1))
    else:
        turn_index = 0
    round_number = max(1, int(_safe_float(combat.get("state", {}).get("roundNumber", 1))))
    return {
        "turnIndex": turn_index,
        "order": order,
        "roundNumber": round_number,
        "currentActor": order[turn_index] if order and 0 <= turn_index < len(order) else None,
    }


def _emit_combat_turn_to_sid(to_sid: str):
    emit("combat-turn", _build_combat_turn_payload(), to=to_sid)


def _sync_enemy_entries_into_combat_order() -> bool:
    combat = world_state.setdefault("combat", {})
    order = combat.get("order")
    if not isinstance(order, list):
        return False

    existing_ids: set[str] = set()
    for entry in order:
        if not isinstance(entry, dict):
            continue
        entry_id = str(entry.get("id") or "").strip()
        if entry_id:
            existing_ids.add(entry_id)

    entities = world_state.get("entities", {})
    if not isinstance(entities, dict):
        return False

    changed = False
    for entity_id, entity in entities.items():
        if not _is_enemy_entity(entity):
            continue
        actor_id = str(entity_id or "").strip()
        if not actor_id or actor_id in existing_ids:
            continue
        order.append(
            {
                "id": actor_id,
                "type": "enemy",
                "name": str((entity or {}).get("name") or actor_id),
            }
        )
        existing_ids.add(actor_id)
        changed = True

    return changed


def _ensure_enemy_actor_registered(actor_id: str, name: str | None = None) -> bool:
    enemy_id = str(actor_id or "").strip()
    if not enemy_id:
        return False

    entities = world_state.setdefault("entities", {})
    if not isinstance(entities, dict):
        world_state["entities"] = {}
        entities = world_state["entities"]

    entity = entities.get(enemy_id)
    if not isinstance(entity, dict):
        entity = {
            "id": enemy_id,
            "type": "training-dummy",
            "name": str(name or enemy_id),
            "attackBonus": 4,
            "damageRoll": 6,
            "damageBonus": 0,
        }
        entities[enemy_id] = entity
    else:
        entity.setdefault("type", "training-dummy")
        entity.setdefault("name", str(name or enemy_id))
        entity.setdefault("attackBonus", 4)
        entity.setdefault("damageRoll", 6)
        entity.setdefault("damageBonus", 0)

    combat = world_state.setdefault("combat", {})
    order = combat.get("order")
    if not isinstance(order, list):
        return False

    for entry in order:
        if isinstance(entry, dict) and str(entry.get("id") or "").strip() == enemy_id:
            return True

    order.append(
        {
            "id": enemy_id,
            "type": "enemy",
            "name": str(entity.get("name") or name or enemy_id),
        }
    )
    return True


def _sid_for_actor_id(actor_id: str) -> str | None:
    for sid, player_entry in players.items():
        if not isinstance(player_entry, dict):
            continue
        if str(player_entry.get("actorId") or "").strip() == actor_id:
            return sid
    return None


def _choose_enemy_target_sid(enemy_actor: dict) -> str | None:
    combat_state = world_state.get("combat", {}).get("state", {})
    initiator_sid = str(combat_state.get("initiator") or "").strip()
    if initiator_sid and initiator_sid in players:
        player_entry = players.get(initiator_sid)
        if isinstance(player_entry, dict) and _normalize_role(player_entry.get("role")) == "player":
            return initiator_sid

    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    for entry in order:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("type") or "").strip().lower() != "player":
            continue
        entry_sid = str(entry.get("ownerSid") or "").strip()
        if entry_sid in players:
            return entry_sid
        actor_id = str(entry.get("id") or "").strip()
        resolved_sid = _sid_for_actor_id(actor_id)
        if resolved_sid:
            return resolved_sid

    return None


def _resolve_enemy_attack_stats(enemy_actor: dict) -> tuple[int, int, int]:
    enemy_id = str(enemy_actor.get("id") or "").strip()
    entities = world_state.get("entities", {})
    entity = entities.get(enemy_id) if isinstance(entities, dict) else None
    attack_bonus = int(_safe_float((entity or {}).get("attackBonus", 4), 4))
    damage_die = int(_safe_float((entity or {}).get("damageRoll", 6), 6))
    damage_bonus = int(_safe_float((entity or {}).get("damageBonus", 0), 0))
    damage_die = max(1, damage_die)
    return attack_bonus, damage_die, damage_bonus


# Seconds the client has to display an enemy action before the turn advances.
_ENEMY_TURN_DISPLAY_DELAY_SEC = 1.5


def _run_enemy_turn_resolution_until_player() -> tuple[list[dict], dict | None]:
    """Resolve consecutive enemy turns, emitting each action immediately with a
    display delay so the client can animate the sequence before the player turn
    is announced.  Returns an empty events list because results are emitted
    inline; callers should not re-emit them."""
    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    if not order:
        return [], None

    turn_data = _build_combat_turn_payload()
    max_steps = len(order)
    for _ in range(max_steps):
        current = turn_data.get("currentActor") if isinstance(turn_data, dict) else None
        current_type = str((current or {}).get("type") or "").strip().lower()
        if current_type != "enemy":
            break

        # Announce the enemy's turn so the client highlights it in the initiative list.
        socketio.emit("combat-turn", turn_data)

        enemy_actor = current if isinstance(current, dict) else {}
        target_sid = _choose_enemy_target_sid(enemy_actor)
        target_actor_id = str(players.get(target_sid, {}).get("actorId") or "") if target_sid else ""

        attack_bonus, damage_die, damage_bonus = _resolve_enemy_attack_stats(enemy_actor)
        hit_roll = _random.randint(1, 20)
        total_to_hit = hit_roll + attack_bonus

        target_ac = int(_safe_float(players.get(target_sid, {}).get("ac", 10), 10)) if target_sid else 10
        is_hit = hit_roll == 20 or (hit_roll != 1 and total_to_hit >= target_ac)

        damage = 0
        if is_hit:
            damage = max(0, _random.randint(1, damage_die) + damage_bonus)
            if target_sid and isinstance(players.get(target_sid), dict):
                current_hp = _safe_float(players[target_sid].get("hp", 100.0), 100.0)
                players[target_sid]["hp"] = max(0.0, current_hp - float(damage))

        event = {
            "attacker": str(enemy_actor.get("id") or "enemy"),
            "actorType": "enemy",
            "type": "attack",
            "targetId": target_actor_id or None,
            "hitRoll": hit_roll,
            "attackBonus": attack_bonus,
            "toHit": total_to_hit,
            "targetAC": target_ac,
            "hit": is_hit,
            "damage": damage,
        }
        # Emit the attack result immediately, before advancing the turn, so the
        # client sees it while the enemy is still the active actor.
        socketio.emit("combat-action-result", event)

        # Pause so the client can display the enemy action sequence.
        gevent.sleep(_ENEMY_TURN_DISPLAY_DELAY_SEC)

        next_turn = _advance_server_turn()
        if next_turn is None:
            return [], None
        turn_data = next_turn

    return [], turn_data


@socketio.on("end-turn")
def socket_end_turn(data=None):
    """Player ends their turn; server validates ownership before advancing."""
    sid = request.sid
    try:
        def _deny(reason: str, detail: str | None = None) -> dict:
            payload = {"reason": reason}
            if detail:
                payload["detail"] = detail
            emit("end-turn-denied", payload, to=sid)
            emit("combat-error", payload, to=sid)
            return {"ok": False, **payload}

        payload = data if isinstance(data, dict) else {}
        print(f"[END-TURN] Received from {sid} payload={payload}")
        emit("end-turn-accepted", {"reason": "received"}, to=sid)

        if sid not in players:
            print(f"[END-TURN] {sid} not in players dict")
            return _deny("player-not-registered")

        combat = world_state.get("combat", {})
        if not combat.get("state", {}).get("inCombat"):
            print(f"[END-TURN] Combat not active")
            return _deny("combat-not-active")

        _sync_enemy_entries_into_combat_order()

        order = combat.get("order") or []
        if not order:
            print(f"[END-TURN] No turn order")
            return _deny("no-turn-order")

        turn = combat.get("turn", 0)
        turn_index = int(turn) if turn is not None else 0
        if not (0 <= turn_index < len(order)):
            print(f"[END-TURN] Invalid turn_index {turn_index}/{len(order)}")
            return _deny("invalid-turn-index")

        current_actor = order[turn_index]
        if not isinstance(current_actor, dict):
            print(f"[END-TURN] Invalid current actor payload: {current_actor}")
            return _deny("invalid-current-actor")

        actor_type = str(current_actor.get("type") or "enemy").strip().lower()
        role = _normalize_role(client_roles.get(sid, "player"))
        print(f"[END-TURN] Current actor: {current_actor.get('id')} type={actor_type} role={role}")

        if actor_type == "enemy" and role not in {"dm", "dev"}:
            print(f"[END-TURN] Is enemy turn, running enemy resolution")
            with turn_lock:
                enemy_events, turn_data = _run_enemy_turn_resolution_until_player()
            if turn_data is None:
                print(f"[END-TURN] Enemy resolution returned None")
                return _deny("enemy-resolution-failed")

            for event in enemy_events:
                socketio.emit("combat-action-result", event)

            print(f"[END-TURN] Emitting combat-turn after enemy: {turn_data}")
            socketio.emit("combat-turn", turn_data)
            _broadcast_world_update(include_scene=False)
            return {"ok": True, "reason": "enemy-advanced", "turnIndex": turn_data.get("turnIndex")}

        # DM and dev may always advance. For players, validate ownership based on actor type.
        if role not in {"dm", "dev"}:
            if not _is_players_turn(sid):
                print(f"[END-TURN] {sid} is not the player's turn (actor {current_actor.get('id')})")
                return _deny("not-your-turn")

        print(f"[END-TURN] Advancing turn")
        with turn_lock:
            turn_data = _advance_server_turn()
            enemy_events: list[dict] = []
            if turn_data is not None:
                enemy_events, turn_data = _run_enemy_turn_resolution_until_player()
        if turn_data is None:
            print(f"[END-TURN] turn_data is None after advance")
            return _deny("turn-advance-failed")

        print(f"[END-TURN] Emitting combat-turn: {turn_data}")

        for event in enemy_events:
            socketio.emit("combat-action-result", event)

        socketio.emit("combat-turn", turn_data)
        _broadcast_world_update(include_scene=False)
        return {"ok": True, "reason": "advanced", "turnIndex": turn_data.get("turnIndex")}
    except Exception as exc:
        print(f"[END-TURN] Exception: {exc}")
        detail = str(exc)
        emit("end-turn-denied", {"reason": "internal-error", "detail": detail}, to=sid)
        emit("combat-error", {"reason": "internal-error", "detail": detail}, to=sid)
        return {"ok": False, "reason": "internal-error", "detail": detail}


@socketio.on("advance-combat-turn")
def socket_advance_combat_turn(data=None):
    """DM/dev force-advance the server turn counter."""
    sid = request.sid
    if sid not in players:
        return

    role = _normalize_role(client_roles.get(sid, "player"))
    if role not in {"dm", "dev"}:
        return

    _sync_enemy_entries_into_combat_order()

    with turn_lock:
        turn_data = _advance_server_turn()
        enemy_events: list[dict] = []
        if turn_data is not None:
            enemy_events, turn_data = _run_enemy_turn_resolution_until_player()
    if turn_data is None:
        return

    for event in enemy_events:
        socketio.emit("combat-action-result", event)

    socketio.emit("combat-turn", turn_data)
    _broadcast_world_update(include_scene=False)


@socketio.on("combat-action")
def socket_combat_action(data):
    """Player submits a combat action; server validates turn ownership and broadcasts result."""
    sid = request.sid
    if sid not in players or not isinstance(data, dict):
        return

    combat = world_state.get("combat", {})
    if not combat.get("state", {}).get("inCombat"):
        emit("combat-action-denied", {"reason": "not-in-combat"})
        return

    order = combat.get("order") or []
    turn = combat.get("turn", 0)
    turn_index = int(turn) if turn is not None else 0
    if not order or not (0 <= turn_index < len(order)):
        emit("combat-action-denied", {"reason": "no-active-turn"})
        return

    current_actor_entry = order[turn_index]
    role = _normalize_role(client_roles.get(sid, "player"))

    if role not in {"dm", "dev"}:
        if not _is_players_turn(sid):
            emit("combat-action-denied", {"reason": "not-your-turn"})
            return

    _ALLOWED_ACTIONS = {"attack", "move", "dodge", "dash", "help", "hide", "ready", "disengage"}
    action_type = str(data.get("type") or "").strip().lower()
    if action_type not in _ALLOWED_ACTIONS:
        emit("combat-action-denied", {"reason": "unknown-action"})
        return

    result: dict = {
        "attacker": current_actor_entry.get("id"),
        "actorType": current_actor_entry.get("type", "player"),
        "type": action_type,
    }

    if action_type == "attack":
        target_id = str(data.get("targetId") or "").strip()
        if not target_id:
            emit("combat-action-denied", {"reason": "missing-target"})
            return
        _ensure_enemy_actor_registered(target_id)
        hit_roll = _random.randint(1, 20)
        damage_roll = _random.randint(1, 8)
        result.update({"targetId": target_id, "hitRoll": hit_roll, "damage": damage_roll})

    socketio.emit("combat-action-result", result)
    _broadcast_world_update(include_scene=False)


@socketio.on("request-combat-state")
def socket_request_combat_state(data=None):
    """Client requests a hard resync of the current combat turn state."""
    sid = request.sid
    if sid not in players:
        return
    _emit_combat_turn_to_sid(sid)
    emit("combat-full-state", world_state.get("combat", {}))


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    icon_path = STATIC_DIR / "favicon.ico"
    if icon_path.exists():
        return send_file(icon_path, mimetype="image/x-icon")
    return Response(status=204)


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
        incoming_entities = data.get("entities", {})
        world_state["entities"] = _apply_training_dummy_avatar_fallbacks(incoming_entities)
        if world_state.get("combat", {}).get("state", {}).get("inCombat"):
            _sync_enemy_entries_into_combat_order()
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
    master_record = build_master_character_record(tables)

    return jsonify(
        ok=True,
        source_file=filename,
        character=tables.get("character", {}),
        master=master_record,
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


@app.route("/debug/combat", methods=["GET"])
def debug_combat_api():
    return jsonify(ok=True, combat=world_state.get("combat", {}))


@app.route("/server-build", methods=["GET"])
def server_build_api():
    return jsonify(
        ok=True,
        build=SERVER_BUILD_TAG,
        pid=os.getpid(),
        async_mode=socketio.async_mode,
    )


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
    import sys
    print(f"[BOOT] Python {sys.version}", flush=True)
    print(f"[BOOT] Flask-SocketIO async_mode={socketio.async_mode}", flush=True)

    if socketio.async_mode != "gevent":
        raise RuntimeError(
            f"ERROR: async_mode is {socketio.async_mode!r}, not 'gevent'. "
            "Run: pip install gevent gevent-websocket && python app.py"
        )

    try:
        import geventwebsocket
        version = getattr(geventwebsocket, '__version__', None) or getattr(geventwebsocket, 'version', 'unknown')
        print(f"[BOOT] gevent-websocket OK: {version}", flush=True)
    except ImportError as exc:
        raise RuntimeError(
            "ERROR: gevent-websocket not installed — WebSocket will not work.\n"
            "Fix: pip install gevent-websocket"
        ) from exc

    print("[BOOT] Starting on http://0.0.0.0:5000 with gevent WebSocket support", flush=True)
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
