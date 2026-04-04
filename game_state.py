"""
GAME STATE — Single Source of Truth.

All mutable game state lives here. No SocketIO, no Flask, no I/O side-effects.
Every other module imports from here and mutates state through the helpers below.
"""
from copy import deepcopy
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Optional
from uuid import uuid4

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SERVER_BUILD_TAG = "combat-restructure-2026-04-03"
TRAINING_DUMMY_FALLBACK_MODEL_URL = "/static/untitled.glb"

CONTRACTS_DIR = Path("data") / "character_tidy"
STATIC_DIR = Path("static")
UPLOADS_DIR = Path("data") / "uploads"
CHARACTER_MODELS_DIR = STATIC_DIR / "user_models"

LOBBY_ROLE_CAPACITY: dict[str, int] = {"player": 4, "dm": 1, "dev": 1}
PLAYER_UPDATE_MIN_INTERVAL_SEC = 1.0 / 20.0   # 20 Hz cap per client
RESUME_SESSION_TTL_SEC = 300.0

# ---------------------------------------------------------------------------
# Mutable state — the server's official record of the game
# ---------------------------------------------------------------------------

# sid → player data dict
players: dict[str, dict] = {}

# sid → "player" | "dm" | "dev"
client_roles: dict[str, str] = {}

# sid → resume key string
client_resume_keys: dict[str, str] = {}

# sid → last update timestamp (float, perf_counter)
player_update_last_seen: dict[str, float] = {}

# resume_key → snapshot dict
resume_sessions: dict[str, dict] = {}

game_session_state: str = "in_game"

# request_id → {requesterSid, targetId, createdAt}
pending_combat_start_requests: dict[str, dict] = {}

# Player slot ownership: index 0-3 → owner SID or None
player_slot_owner: list[Optional[str]] = [None] * LOBBY_ROLE_CAPACITY["player"]

# Serialisable scene + world
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

# Mutex for turn advancement — prevents double-advance on concurrent events
turn_lock = Lock()

# ---------------------------------------------------------------------------
# Pure helpers — no I/O, no imports from project modules
# ---------------------------------------------------------------------------

def normalize_role(value) -> str:
    r = str(value or "player").strip().lower()
    return r if r in {"player", "dm", "dev"} else "player"


def safe_float(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# --- Player slot management ---

def find_open_slot() -> Optional[int]:
    for i, owner in enumerate(player_slot_owner):
        if owner is None:
            return i
    return None


def get_slot_for(sid: str) -> Optional[int]:
    for i, owner in enumerate(player_slot_owner):
        if owner == sid:
            return i
    return None


def release_slot(sid: str) -> None:
    i = get_slot_for(sid)
    if i is not None:
        player_slot_owner[i] = None


def claim_slot(sid: str) -> Optional[int]:
    i = get_slot_for(sid)
    if i is not None:
        return i
    open_i = find_open_slot()
    if open_i is None:
        return None
    player_slot_owner[open_i] = sid
    return open_i


def authoritative_player_sid() -> Optional[str]:
    for owner in player_slot_owner:
        if owner:
            return owner
    return None


def refresh_authority() -> None:
    auth = authoritative_player_sid()
    for sid, data in players.items():
        if isinstance(data, dict):
            data["isAuthoritative"] = (auth is not None and sid == auth)


def can_assign_role(role: str, sid: Optional[str] = None) -> bool:
    normalized = normalize_role(role)
    if normalized == "player":
        if sid and get_slot_for(sid) is not None:
            return True
        return find_open_slot() is not None
    cap = max(1, int(LOBBY_ROLE_CAPACITY.get(normalized, 1)))
    used = sum(
        1 for s, r in client_roles.items()
        if (sid is None or s != sid) and normalize_role(r) == normalized
    )
    return used < cap


def apply_role(sid: str, role: str) -> bool:
    """Assign a role to a connected client. Returns False if the slot is full."""
    normalized = normalize_role(role)
    prev = normalize_role(client_roles.get(sid, "player")) if sid in client_roles else None

    if prev == "player" and normalized != "player":
        release_slot(sid)

    slot_idx: Optional[int] = None
    if normalized == "player":
        slot_idx = claim_slot(sid)
        if slot_idx is None:
            return False

    client_roles[sid] = normalized
    entry = players.setdefault(sid, {
        "id": sid,
        "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
    })
    entry["role"] = normalized
    entry["slot"] = (slot_idx + 1) if slot_idx is not None else None
    if normalized == "player" and slot_idx is not None:
        entry["actorId"] = f"player_{slot_idx + 1}"
    elif normalized == "dm":
        entry["actorId"] = "dm_1"
    else:
        entry["actorId"] = "dev_1"
    entry["networkId"] = str(entry.get("actorId") or sid)
    refresh_authority()
    return True


# --- Entity helpers ---

def is_enemy(entity: dict) -> bool:
    if not isinstance(entity, dict):
        return False
    t = str(entity.get("type") or entity.get("entityType") or "").strip().lower()
    return t in {"enemy", "training-dummy", "player-dummy", "elite-dummy"}


def get_dm_sids() -> list[str]:
    return [s for s, r in client_roles.items() if normalize_role(r) == "dm"]


def sid_for_actor(actor_id: str) -> Optional[str]:
    for sid, entry in players.items():
        if isinstance(entry, dict) and str(entry.get("actorId") or "").strip() == actor_id:
            return sid
    return None


def register_entity(entity_type: str, position: dict, name: Optional[str] = None) -> str:
    """Spawn a new entity into world_state and return its actor_id."""
    normalized = str(entity_type or "training-dummy").strip().lower()
    if normalized not in {"training-dummy", "player-dummy", "elite-dummy"}:
        normalized = "training-dummy"
    actor_id = uuid4().hex
    display_name = str(name or "").strip() or {
        "player-dummy": "Dummy Player",
        "elite-dummy": "Elite Dummy",
    }.get(normalized, "Training Dummy")
    px = safe_float((position or {}).get("x", 0.0))
    py = safe_float((position or {}).get("y", 0.0))
    pz = safe_float((position or {}).get("z", 0.0))
    entities = world_state.setdefault("entities", {})
    entities[actor_id] = {
        "id": actor_id,
        "networkId": actor_id,
        "type": normalized,
        "name": display_name,
        "position": {"x": px, "y": py, "z": pz},
        "attackBonus": 4,
        "damageRoll": 6,
        "damageBonus": 0,
    }
    return actor_id


def ensure_enemy_registered(actor_id: str, name: Optional[str] = None) -> bool:
    """Guarantee an entity record exists and is in the combat order."""
    eid = str(actor_id or "").strip()
    if not eid:
        return False
    entities = world_state.setdefault("entities", {})
    if not isinstance(entities, dict):
        world_state["entities"] = {}
        entities = world_state["entities"]
    entity = entities.get(eid)
    if not isinstance(entity, dict):
        entities[eid] = {
            "id": eid, "networkId": eid, "type": "training-dummy",
            "name": str(name or eid),
            "attackBonus": 4, "damageRoll": 6, "damageBonus": 0,
        }
    else:
        entity.setdefault("networkId", eid)
        entity.setdefault("type", "training-dummy")
        entity.setdefault("name", str(name or eid))
        entity.setdefault("attackBonus", 4)
        entity.setdefault("damageRoll", 6)
        entity.setdefault("damageBonus", 0)
    order = world_state.get("combat", {}).get("order")
    if not isinstance(order, list):
        return False
    if any(isinstance(e, dict) and str(e.get("id") or "").strip() == eid for e in order):
        return True
    order.append({"id": eid, "type": "enemy", "name": str(entities[eid].get("name") or name or eid)})
    return True


# --- Lobby builder ---

def build_lobby_state() -> dict:
    counts: dict[str, int] = {"player": 0, "dm": 0, "dev": 0}
    occupants: dict[str, list] = {"player": [], "dm": [], "dev": []}
    for sid, role in client_roles.items():
        n = normalize_role(role)
        counts[n] = counts.get(n, 0) + 1
        occupants[n].append({"id": sid, "label": f"{n.upper()}-{sid[:6]}"})
    slots = {}
    for role in ("player", "dm", "dev"):
        cap = max(1, int(LOBBY_ROLE_CAPACITY.get(role, 1)))
        used = counts.get(role, 0)
        slots[role] = {
            "capacity": cap, "occupied": used,
            "open": max(0, cap - used), "isFull": used >= cap,
            "occupants": occupants.get(role, []),
        }
    ps = []
    for idx, owner in enumerate(player_slot_owner, start=1):
        ps.append({
            "slot": idx, "occupied": bool(owner), "sid": owner,
            "actorId": f"player_{idx}" if owner else None,
        })
    return {
        "slots": slots, "playerSlots": ps,
        "gameState": game_session_state, "rolesLocked": False,
        "authoritativePlayerId": authoritative_player_sid(),
        "totalConnected": len(players),
    }


# --- World payload builder ---

def build_world_payload(include_scene: bool = True) -> dict:
    # Filter entities to extract authoritative enemies list for frontend
    entities = world_state.get("entities", {})
    enemies_list = []
    if isinstance(entities, dict):
        for eid, entity in entities.items():
            if not isinstance(entity, dict):
                continue
            if not is_enemy(entity):
                continue
            # Ensure actor_id is authoritative entity ID
            actor_id = str(entity.get("networkId") or eid or "").strip()
            if not actor_id:
                continue
            enemies_list.append({
                "actorId": actor_id,
                "networkId": actor_id,
                "name": str(entity.get("name") or actor_id),
                "position": entity.get("position", {"x": 0, "y": 0, "z": 0}),
                "rotationY": float(entity.get("rotationY", 0)),
                "hp": gs.safe_float(entity.get("hp", 50.0), 50.0),
                "maxHp": gs.safe_float(entity.get("maxHp", 50.0), 50.0),
                "ac": int(gs.safe_float(entity.get("ac", 12), 12)),
                "attackBonus": int(gs.safe_float(entity.get("attackBonus", 4), 4)),
                "damageRoll": int(gs.safe_float(entity.get("damageRoll", 6), 6)),
                "damageBonus": int(gs.safe_float(entity.get("damageBonus", 0), 0)),
            })
    payload = {
        "serverBuild": SERVER_BUILD_TAG,
        "players": deepcopy(players),
        "entities": deepcopy(entities),
        "enemies": enemies_list,  # Authoritative list for frontend
        "mode": str(world_state.get("mode", "exploration")),
        "combat": deepcopy(world_state.get("combat", {"turn": None, "order": [], "state": {}})),
        "session": {
            "gameState": game_session_state,
            "rolesLocked": False,
            "authoritativePlayerId": authoritative_player_sid(),
        },
    }
    if include_scene:
        scene = deepcopy(latest_scene_state)
        payload["scene"] = scene
        payload["objects"] = scene.get("objects", {})
        payload["lights"] = scene.get("lights", {})
    return payload


# --- Combat turn helpers ---

def build_turn_order(initiator_sid: Optional[str] = None) -> list[dict]:
    order: list[dict] = []
    for sid, entry in players.items():
        if not isinstance(entry, dict):
            continue
        if normalize_role(entry.get("role")) != "player":
            continue
        actor_id = str(entry.get("networkId") or entry.get("actorId") or "").strip()
        if not actor_id:
            continue
        order.append({
            "id": actor_id, "type": "player",
            "ownerSid": sid, "name": str(entry.get("name") or actor_id),
        })
    if initiator_sid:
        for i, e in enumerate(order):
            if e.get("ownerSid") == initiator_sid:
                if i > 0:
                    order.insert(0, order.pop(i))
                break
    entities = world_state.get("entities", {})
    if isinstance(entities, dict):
        for eid, entity in entities.items():
            if not is_enemy(entity):
                continue
            if not isinstance((entity or {}).get("position"), dict):
                continue
            actor_id = str((entity or {}).get("networkId") or eid or "").strip()
            if not actor_id:
                continue
            if isinstance(entity, dict) and not entity.get("networkId"):
                entity["networkId"] = actor_id
            order.append({
                "id": actor_id, "type": "enemy",
                "name": str((entity or {}).get("name") or actor_id),
            })
    return order


def build_combat_turn_payload() -> dict:
    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    turn = combat.get("turn")
    idx = int(turn) if turn is not None else 0
    if order:
        idx = max(0, min(idx, len(order) - 1))
    rnd = max(1, int(safe_float(combat.get("state", {}).get("roundNumber", 1))))
    return {
        "turnIndex": idx, "order": order, "roundNumber": rnd,
        "currentActor": order[idx] if order and 0 <= idx < len(order) else None,
    }


def is_players_turn(sid: str) -> bool:
    """True if the active turn in combat belongs to the player with this sid."""
    combat = world_state.get("combat", {})
    order = combat.get("order") or []
    turn = combat.get("turn", 0)
    idx = int(turn) if turn is not None else 0
    if not order or not (0 <= idx < len(order)):
        return False
    current = order[idx]
    if not isinstance(current, dict) or current.get("type") != "player":
        return False
    # Primary: match stable actorId (survives reconnect)
    actor_id = str(players.get(sid, {}).get("actorId") or "").strip()
    if actor_id and current.get("id") == actor_id:
        return True
    # Fallback: ownerSid for initial connections
    return str(current.get("ownerSid") or "") == sid


def update_turn_order_sid(prev_sid: str, new_sid: str) -> None:
    """Repoint ownerSid in the live combat order when a player reconnects."""
    order = world_state.get("combat", {}).get("order")
    if not isinstance(order, list):
        return
    for entry in order:
        if isinstance(entry, dict) and entry.get("ownerSid") == prev_sid:
            entry["ownerSid"] = new_sid


def sync_enemies_into_order() -> bool:
    """Add any entities that spawned mid-combat to the current turn order."""
    combat = world_state.setdefault("combat", {})
    order = combat.get("order")
    if not isinstance(order, list):
        return False
    existing_ids = {str(e.get("id") or "").strip() for e in order if isinstance(e, dict)}
    entities = world_state.get("entities", {})
    if not isinstance(entities, dict):
        return False
    changed = False
    for eid, entity in entities.items():
        if not is_enemy(entity):
            continue
        actor_id = str((entity or {}).get("networkId") or eid or "").strip()
        if not actor_id or actor_id in existing_ids:
            continue
        if isinstance(entity, dict) and not entity.get("networkId"):
            entity["networkId"] = actor_id
        order.append({"id": actor_id, "type": "enemy",
                       "name": str((entity or {}).get("name") or actor_id)})
        existing_ids.add(actor_id)
        changed = True
    return changed


# --- Resume session helpers ---

def sanitize_resume_key(value) -> Optional[str]:
    raw = str(value or "").strip()
    if not raw:
        return None
    raw = raw[:96]
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    cleaned = "".join(c for c in raw if c in allowed)
    return cleaned or None


def cleanup_resume_sessions(now: Optional[float] = None) -> None:
    t = now if now is not None else perf_counter()
    expired = [k for k, v in resume_sessions.items() if float(v.get("expiresAt", 0)) <= t]
    for k in expired:
        resume_sessions.pop(k, None)


def save_resume_snapshot(sid: str, now: Optional[float] = None) -> None:
    key = client_resume_keys.get(sid)
    if not key:
        return
    entry = players.get(sid)
    if not isinstance(entry, dict):
        return
    t = now if now is not None else perf_counter()
    resume_sessions[key] = {
        "sid": sid,
        "role": normalize_role(client_roles.get(sid, entry.get("role", "player"))),
        "slotIndex": get_slot_for(sid),
        "actorId": entry.get("actorId"),
        "networkId": entry.get("networkId"),
        "isAuthoritative": bool(entry.get("isAuthoritative", False)),
        "position": deepcopy(entry.get("position", {"x": 0.0, "y": 0.0, "z": 0.0})),
        "rotation": deepcopy(entry.get("rotation", {"x": 0.0, "y": 0.0, "z": 0.0})),
        "avatar": deepcopy(entry.get("avatar")) if isinstance(entry.get("avatar"), dict) else None,
        "movementPreview": deepcopy(entry.get("movementPreview")) if isinstance(entry.get("movementPreview"), dict) else None,
        "ac": entry.get("ac"),
        "max_hp": entry.get("max_hp"),
        "hp": entry.get("hp"),
        "initiative_bonus": entry.get("initiative_bonus"),
        "speed_ft": entry.get("speed_ft"),
        "expiresAt": t + RESUME_SESSION_TTL_SEC,
        "lastSeen": t,
    }
