"""
GAME STATE — Single Source of Truth.

All mutable game state lives here. No SocketIO, no Flask, no I/O side-effects.
Every other module imports from here and mutates state through the helpers below.
"""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import random
import re
from threading import Lock
from time import perf_counter
from typing import Optional
from uuid import uuid4

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SERVER_BUILD_TAG = "combat-restructure-2026-04-03"
TRAINING_DUMMY_FALLBACK_MODEL_URL = "/static/untitled.glb"

# Difficulty tier stat templates for training dummies and enemies
ENTITY_STAT_TEMPLATES = {
    "training-dummy": {
        "hp": 30,
        "ac": 8,
        "attackBonus": 1,
        "damageRoll": 3,
        "damageBonus": 0,
    },
    "player-dummy": {
        "hp": 40,
        "ac": 12,
        "attackBonus": 2,
        "damageRoll": 6,
        "damageBonus": 1,
    },
    "elite-dummy": {
        "hp": 60,
        "ac": 14,
        "attackBonus": 4,
        "damageRoll": 8,
        "damageBonus": 2,
    },
}

CONTRACTS_DIR = Path("data") / "character_tidy"
STATIC_DIR = Path("static")
UPLOADS_DIR = Path("data") / "uploads"
PERSISTENCE_DIR = Path("data")
SCENE_STATE_FILE = PERSISTENCE_DIR / "scene_state.json"
MATERIALS_STATE_FILE = PERSISTENCE_DIR / "materials_state.json"
CHARACTER_MODELS_DIR = STATIC_DIR / "user_models"
ENGINE_ENTITY_CONTRACT_NAME = "engine_entity.json"

DEFAULT_ITEM_DB: dict[str, dict] = {
    "unarmed_strike": {
        "id": "unarmed_strike",
        "name": "Unarmed Strike",
        "type": "weapon",
        "slot": "main_hand",
        "attackMode": "melee",
        "reachFt": 5,
        "attackBonus": 0,
        "damageRoll": 3,
        "damageBonus": 0,
        "damageType": "bludgeoning",
    },
    "longsword": {
        "id": "longsword",
        "name": "Longsword",
        "type": "weapon",
        "slot": "main_hand",
        "attackMode": "melee",
        "reachFt": 5,
        "attackBonus": 0,
        "damageRoll": 8,
        "damageBonus": 0,
        "damageType": "slashing",
    },
    "javelin": {
        "id": "javelin",
        "name": "Javelin",
        "type": "weapon",
        "slot": "main_hand",
        "attackMode": "thrown",
        "reachFt": 5,
        "rangeFt": 30,
        "longRangeFt": 120,
        "attackBonus": 0,
        "damageRoll": 6,
        "damageBonus": 0,
        "damageType": "piercing",
    },
    "shield": {
        "id": "shield",
        "name": "Shield",
        "type": "armor",
        "slot": "off_hand",
        "acBonus": 2,
    },
    "health_potion": {
        "id": "health_potion",
        "name": "Health Potion",
        "type": "consumable",
        "healDice": "2d4+2",
        "healFlat": 7,
    },
}

LOBBY_ROLE_CAPACITY: dict[str, int] = {"player": 4, "dm": 1, "dev": 1}
PLAYER_UPDATE_MIN_INTERVAL_SEC = 1.0 / 20.0   # 20 Hz cap per client
RESUME_SESSION_TTL_SEC = 300.0
COMBAT_ACTION_DEDUPE_TTL_SEC = 15.0
COMBAT_ACTION_RATE_WINDOW_SEC = 1.0
COMBAT_ACTION_RATE_MAX = 20

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

# sid -> {action_id -> seen_at_perf_counter}
recent_combat_action_ids: dict[str, dict[str, float]] = {}

# sid -> {windowStart: float, count: int}
combat_action_rate_window: dict[str, dict] = {}

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

# Monotonic server event sequence used by clients to reject stale packets.
_event_sequence_lock = Lock()
_event_sequence_counter = 0

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


def next_event_sequence() -> int:
    """Return the next monotonic server sequence number."""
    global _event_sequence_counter
    with _event_sequence_lock:
        _event_sequence_counter += 1
        return _event_sequence_counter


def _to_jsonable_state(value):
    if isinstance(value, dict):
        return {str(k): _to_jsonable_state(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_to_jsonable_state(v) for v in value]
    if isinstance(value, tuple):
        return [_to_jsonable_state(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def serialize_state(state: dict) -> str:
    payload = _to_jsonable_state(state if isinstance(state, dict) else {})
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def deserialize_state(serialized: str) -> dict:
    try:
        parsed = json.loads(str(serialized or "{}"))
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def hash_state(state: dict) -> str:
    canonical = serialize_state(state)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _sanitize_action_id(value) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    return raw[:128]


def _cleanup_recent_combat_actions(now: Optional[float] = None) -> None:
    t = now if now is not None else perf_counter()
    for sid in list(recent_combat_action_ids.keys()):
        bucket = recent_combat_action_ids.get(sid)
        if not isinstance(bucket, dict):
            recent_combat_action_ids.pop(sid, None)
            continue
        for action_id, seen_at in list(bucket.items()):
            if (t - float(seen_at)) > COMBAT_ACTION_DEDUPE_TTL_SEC:
                bucket.pop(action_id, None)
        if not bucket:
            recent_combat_action_ids.pop(sid, None)


def is_duplicate_combat_action(sid: str, action_id) -> bool:
    aid = _sanitize_action_id(action_id)
    if not aid:
        return False
    _cleanup_recent_combat_actions()
    return aid in (recent_combat_action_ids.get(sid) or {})


def mark_combat_action_seen(sid: str, action_id, now: Optional[float] = None) -> None:
    aid = _sanitize_action_id(action_id)
    if not aid:
        return
    t = now if now is not None else perf_counter()
    _cleanup_recent_combat_actions(now=t)
    bucket = recent_combat_action_ids.setdefault(sid, {})
    bucket[aid] = t


def consume_combat_rate_token(sid: str, now: Optional[float] = None) -> bool:
    t = now if now is not None else perf_counter()
    window = combat_action_rate_window.get(sid)
    if not isinstance(window, dict):
        combat_action_rate_window[sid] = {"windowStart": t, "count": 1}
        return True

    start = float(window.get("windowStart", t))
    count = int(safe_float(window.get("count", 0), 0))
    if (t - start) >= COMBAT_ACTION_RATE_WINDOW_SEC:
        combat_action_rate_window[sid] = {"windowStart": t, "count": 1}
        return True

    if count >= COMBAT_ACTION_RATE_MAX:
        return False

    window["count"] = count + 1
    return True


def _slugify_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value or "").strip().lower()).strip("_")


def _parse_signed_int(value) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    m = re.search(r"[+-]?\d+", str(value))
    return int(m.group(0)) if m else None


def _parse_damage_roll(value) -> tuple[int, int]:
    text = str(value or "").strip().lower()
    m = re.match(r"^\s*\d+d(\d+)([+-]\d+)?\s*$", text)
    if m:
        sides = max(1, int(m.group(1)))
        bonus = int(m.group(2) or "0")
        return sides, bonus
    n = _parse_signed_int(value)
    if n is None:
        return 3, 0
    return max(1, n), 0


def roll_dice_formula(value, fallback: int = 0, rng: Optional[random.Random] = None) -> int:
    text = str(value or "").strip().lower()
    match = re.match(r"^\s*(\d+)d(\d+)([+-]\d+)?\s*$", text)
    if not match:
        parsed = _parse_signed_int(value)
        if parsed is None:
            return int(fallback)
        return int(parsed)

    count = max(1, int(match.group(1)))
    sides = max(1, int(match.group(2)))
    bonus = int(match.group(3) or "0")
    roller = rng if rng is not None else random
    total = 0
    for _ in range(count):
        total += int(roller.randint(1, sides))
    return total + bonus


def normalize_movement_capabilities(raw_caps) -> dict:
    raw = raw_caps if isinstance(raw_caps, dict) else {}
    # Default to enabled for core tactical actions so players always retain baseline agency.
    return {
        "can_dash": bool(raw.get("can_dash", raw.get("canDash", True))),
        "can_disengage": bool(raw.get("can_disengage", raw.get("canDisengage", True))),
        "can_dodge": bool(raw.get("can_dodge", raw.get("canDodge", True))),
        "has_opportunity_attack": bool(raw.get("has_opportunity_attack", raw.get("hasOpportunityAttack", True))),
    }


def set_player_movement_capabilities(entry: dict, raw_caps) -> dict:
    normalized = normalize_movement_capabilities(raw_caps)
    if isinstance(entry, dict):
        entry["movement_capabilities"] = normalized
    return normalized


def player_has_movement_capability(entry: dict, capability: str, default: bool = True) -> bool:
    if not isinstance(entry, dict):
        return default
    caps = entry.get("movement_capabilities")
    if not isinstance(caps, dict):
        return default
    return bool(caps.get(capability, default))


def set_player_dodge_active(entry: dict, active: bool) -> None:
    if not isinstance(entry, dict):
        return
    defense = entry.get("combat_defense") if isinstance(entry.get("combat_defense"), dict) else {}
    defense["dodgeActive"] = bool(active)
    entry["combat_defense"] = defense


def is_player_dodge_active(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    defense = entry.get("combat_defense") if isinstance(entry.get("combat_defense"), dict) else {}
    return bool(defense.get("dodgeActive", False))


def resolve_contract(filename: str) -> Optional[Path]:
    for candidate in (CONTRACTS_DIR / filename, STATIC_DIR / filename):
        if candidate.exists():
            return candidate
    return None


def load_engine_entity_contract() -> Optional[dict]:
    contract_path = resolve_contract(ENGINE_ENTITY_CONTRACT_NAME)
    if not contract_path:
        return None
    try:
        parsed = json.loads(contract_path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


def resolve_item_def(item_id: str) -> dict:
    key = _slugify_token(item_id)
    return deepcopy(DEFAULT_ITEM_DB.get(key, {
        "id": key or "unknown_item",
        "name": str(item_id or "Unknown Item"),
        "type": "misc",
    }))


def normalize_inventory_contract(raw_inventory) -> dict:
    if not isinstance(raw_inventory, dict):
        return {"items": [], "capacity": None, "weight": 0}

    items_raw = raw_inventory.get("items") if isinstance(raw_inventory.get("items"), list) else []
    out_items: list[dict] = []
    for idx, row in enumerate(items_raw, 1):
        if not isinstance(row, dict):
            continue
        item_id = _slugify_token(str(row.get("itemId") or "").strip())
        if not item_id:
            continue
        qty = _parse_signed_int(row.get("qty"))
        if qty is None:
            qty = 1
        qty = max(0, qty)
        inst = {
            "instanceId": str(row.get("instanceId") or f"inv_{idx:03d}"),
            "itemId": item_id,
            "qty": qty,
            "equipped": bool(row.get("equipped", False)),
        }
        if row.get("slot") is not None:
            inst["slot"] = str(row.get("slot") or "").strip() or None
        out_items.append(inst)

    capacity = _parse_signed_int(raw_inventory.get("capacity"))
    weight = _parse_signed_int(raw_inventory.get("weight"))
    if weight is None:
        # Derive weight from known item weights if possible.
        total_weight = 0
        for item in out_items:
            definition = resolve_item_def(item.get("itemId") or "")
            unit_w = _parse_signed_int(definition.get("weight")) or 0
            total_weight += unit_w * max(0, int(item.get("qty") or 0))
        weight = total_weight

    return {
        "items": out_items,
        "capacity": capacity,
        "weight": max(0, weight or 0),
    }


def resolve_equipped_weapon(entry: dict) -> dict:
    inventory = entry.get("inventory") if isinstance(entry.get("inventory"), dict) else {"items": []}
    items = inventory.get("items") if isinstance(inventory.get("items"), list) else []

    equipped = None
    for item in items:
        if not isinstance(item, dict):
            continue
        if not bool(item.get("equipped")):
            continue
        definition = resolve_item_def(str(item.get("itemId") or ""))
        if definition.get("type") == "weapon":
            equipped = {"instance": item, "definition": definition}
            break

    if equipped is None:
        # Auto-fallback: first weapon in inventory, else unarmed.
        for item in items:
            if not isinstance(item, dict):
                continue
            definition = resolve_item_def(str(item.get("itemId") or ""))
            if definition.get("type") == "weapon":
                item["equipped"] = True
                item.setdefault("slot", definition.get("slot") or "main_hand")
                equipped = {"instance": item, "definition": definition}
                break

    if equipped is None:
        unarmed = resolve_item_def("unarmed_strike")
        return {
            "itemId": "unarmed_strike",
            "name": unarmed.get("name", "Unarmed Strike"),
            "attackMode": str(unarmed.get("attackMode") or "melee"),
            "reachFt": safe_float(unarmed.get("reachFt", 5), 5.0),
            "rangeFt": safe_float(unarmed.get("rangeFt", 0), 0.0),
            "longRangeFt": safe_float(unarmed.get("longRangeFt", 0), 0.0),
            "attackBonus": int(_parse_signed_int(unarmed.get("attackBonus")) or 0),
            "damageRoll": int(_parse_signed_int(unarmed.get("damageRoll")) or 3),
            "damageBonus": int(_parse_signed_int(unarmed.get("damageBonus")) or 0),
            "damageType": str(unarmed.get("damageType") or "bludgeoning"),
            "source": "default",
        }

    definition = equipped["definition"]
    dmg_roll, dmg_bonus_from_dice = _parse_damage_roll(definition.get("damage"))
    fallback_roll = _parse_signed_int(definition.get("damageRoll"))
    dmg_bonus = _parse_signed_int(definition.get("damageBonus"))

    return {
        "itemId": str(definition.get("id") or equipped["instance"].get("itemId") or "weapon"),
        "name": str(definition.get("name") or equipped["instance"].get("itemId") or "Weapon"),
        "attackMode": str(definition.get("attackMode") or "melee"),
        "reachFt": safe_float(definition.get("reachFt", 5), 5.0),
        "rangeFt": safe_float(definition.get("rangeFt", 0), 0.0),
        "longRangeFt": safe_float(definition.get("longRangeFt", 0), 0.0),
        "attackBonus": int(_parse_signed_int(definition.get("attackBonus")) or 0),
        "damageRoll": int(fallback_roll if fallback_roll is not None else dmg_roll),
        "damageBonus": int(dmg_bonus if dmg_bonus is not None else dmg_bonus_from_dice),
        "damageType": str(definition.get("damageType") or "physical"),
        "source": "inventory",
        "instanceId": str(equipped["instance"].get("instanceId") or ""),
    }


def apply_equipped_weapon_stats(entry: dict) -> None:
    if not isinstance(entry, dict):
        return
    weapon = resolve_equipped_weapon(entry)
    entry["equipped_weapon"] = weapon
    # combat uses these canonical fields already for enemies/players.
    entry["attackBonus"] = int(weapon.get("attackBonus") or 0)
    entry["damageRoll"] = max(1, int(weapon.get("damageRoll") or 3))
    entry["damageBonus"] = int(weapon.get("damageBonus") or 0)


def set_player_inventory(sid: str, raw_inventory) -> bool:
    entry = players.get(sid)
    if not isinstance(entry, dict):
        return False
    normalized = normalize_inventory_contract(raw_inventory)
    entry["inventory"] = normalized
    apply_equipped_weapon_stats(entry)
    save_resume_snapshot(sid)
    return True


def apply_inventory_from_engine_entity(sid: str, engine_entity: dict) -> bool:
    if not isinstance(engine_entity, dict):
        return False
    inventory = engine_entity.get("inventory")
    if not isinstance(inventory, dict):
        return False
    return set_player_inventory(sid, inventory)


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
    if t in {"enemy", "training-dummy", "player-dummy", "elite-dummy"}:
        return True
    # Older tests and some server-side fixtures omit an explicit type but still
    # represent combat enemies with HP + AC and attack metadata.
    return (
        ("hp" in entity or "maxHp" in entity)
        and "ac" in entity
    )


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
    if normalized not in ENTITY_STAT_TEMPLATES:
        normalized = "training-dummy"
    
    actor_id = uuid4().hex
    display_name = str(name or "").strip() or {
        "player-dummy": "Dummy Player",
        "elite-dummy": "Elite Dummy",
    }.get(normalized, "Training Dummy")
    
    px = safe_float((position or {}).get("x", 0.0))
    py = safe_float((position or {}).get("y", 0.0))
    pz = safe_float((position or {}).get("z", 0.0))
    
    # Get stat template for this entity type
    template = ENTITY_STAT_TEMPLATES.get(normalized, ENTITY_STAT_TEMPLATES["training-dummy"])
    
    entities = world_state.setdefault("entities", {})
    entities[actor_id] = {
        "id": actor_id,
        "networkId": actor_id,
        "type": normalized,
        "name": display_name,
        "position": {"x": px, "y": py, "z": pz},
        "hp": template["hp"],
        "maxHp": template["hp"],
        "ac": template["ac"],
        "attackBonus": template["attackBonus"],
        "damageRoll": template["damageRoll"],
        "damageBonus": template["damageBonus"],
    }
    print(f"[ENTITY] spawned {normalized} {actor_id}: AC={template['ac']} AB={template['attackBonus']} HP={template['hp']}", flush=True)
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
    template = ENTITY_STAT_TEMPLATES["training-dummy"]
    if not isinstance(entity, dict):
        entities[eid] = {
            "id": eid, "networkId": eid, "type": "training-dummy",
            "name": str(name or eid),
            "hp": template["hp"],
            "maxHp": template["hp"],
            "ac": template["ac"],
            "attackBonus": template["attackBonus"],
            "damageRoll": template["damageRoll"],
            "damageBonus": template["damageBonus"],
        }
    else:
        entity.setdefault("networkId", eid)
        entity.setdefault("type", "training-dummy")
        entity.setdefault("name", str(name or eid))
        entity.setdefault("hp", template["hp"])
        entity.setdefault("maxHp", template["hp"])
        entity.setdefault("ac", template["ac"])
        entity.setdefault("attackBonus", template["attackBonus"])
        entity.setdefault("damageRoll", template["damageRoll"])
        entity.setdefault("damageBonus", template["damageBonus"])
    order = world_state.get("combat", {}).get("order")
    if not isinstance(order, list):
        return False
    if any(isinstance(e, dict) and str(e.get("id") or "").strip() == eid for e in order):
        return True
    order.append({"id": eid, "type": "enemy", "name": str(entities[eid].get("name") or name or eid)})
    return True


def validate_player_stats(player_data: dict) -> dict:
    """Validate and clamp player stats from importer to reasonable ranges."""
    # For level 3, stats should be in these ranges
    hp = safe_float(player_data.get("hp", 20.0), 20.0)
    ac = safe_float(player_data.get("ac", 14.0), 14.0)
    attack_bonus = safe_float(player_data.get("attackBonus", 4.0), 4.0)
    
    # Clamp to level-appropriate ranges
    hp = max(10.0, min(40.0, hp))  # Level 3: ~10-40 HP
    ac = max(8.0, min(20.0, ac))   # AC: 8-20 is reasonable
    attack_bonus = max(0.0, min(10.0, attack_bonus))  # AB: 0-10
    
    # Log if any were adjusted
    if (hp != safe_float(player_data.get("hp", 20.0), 20.0) or
        ac != safe_float(player_data.get("ac", 14.0), 14.0) or
        attack_bonus != safe_float(player_data.get("attackBonus", 4.0), 4.0)):
        print(f"[IMPORT] stats clamped: HP {player_data.get('hp')}→{hp}, AC {player_data.get('ac')}→{ac}, AB {player_data.get('attackBonus')}→{attack_bonus}", flush=True)
    else:
        print(f"[IMPORT] validated: HP={hp}, AC={ac}, AB={attack_bonus}", flush=True)
    
    player_data["hp"] = hp
    player_data["ac"] = ac
    player_data["attackBonus"] = attack_bonus
    return player_data


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
                "hp": safe_float(entity.get("hp", 50.0), 50.0),
                "maxHp": safe_float(entity.get("maxHp", 50.0), 50.0),
                "ac": int(safe_float(entity.get("ac", 12), 12)),
                "attackBonus": int(safe_float(entity.get("attackBonus", 4), 4)),
                "damageRoll": int(safe_float(entity.get("damageRoll", 6), 6)),
                "damageBonus": int(safe_float(entity.get("damageBonus", 0), 0)),
            })
    payload = {
        "serverSeq": next_event_sequence(),
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
    player_pool: list[dict] = []
    for sid, entry in players.items():
        if not isinstance(entry, dict):
            continue
        if normalize_role(entry.get("role")) != "player":
            continue
        actor_id = str(entry.get("networkId") or entry.get("actorId") or "").strip()
        if not actor_id:
            continue
        side = str(entry.get("side") or "heroes").strip().lower()
        side = "villains" if side == "villains" else "heroes"
        player_pool.append({
            "sid": sid,
            "side": side,
            "name": str(entry.get("name") or actor_id),
            "actor": {
            "id": actor_id, "type": "player",
            "ownerSid": sid, "name": str(entry.get("name") or actor_id),
            },
        })

    player_pool.sort(key=lambda row: (str(row.get("name") or "").lower(), str(row.get("sid") or "")))
    heroes = [row for row in player_pool if row.get("side") == "heroes"]
    villains = [row for row in player_pool if row.get("side") == "villains"]

    selected_players: list[dict] = []
    if heroes and villains:
        selected_players = [heroes[0], villains[0]]
    else:
        selected_players = player_pool[:2]

    order.extend(row["actor"] for row in selected_players)
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
        if safe_float((entity or {}).get("hp", (entity or {}).get("maxHp", 0.0)), 0.0) <= 0:
            continue
        if isinstance(entity, dict) and not entity.get("networkId"):
            entity["networkId"] = actor_id
        order.append({"id": actor_id, "type": "enemy",
                       "name": str((entity or {}).get("name") or actor_id)})
        existing_ids.add(actor_id)
        changed = True
    return changed


def is_player_downed(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    state = str(entry.get("state") or "").strip().lower()
    if state == "downed":
        return True
    if "hp" not in entry and "max_hp" not in entry:
        return False
    hp = safe_float(entry.get("hp", entry.get("max_hp", 0.0)), 0.0)
    return hp <= 0.0


def is_enemy_downed(entity: dict) -> bool:
    if not isinstance(entity, dict):
        return False
    state = str(entity.get("state") or "").strip().lower()
    hp = safe_float(entity.get("hp", entity.get("maxHp", 0.0)), 0.0)
    return state == "downed" or hp <= 0.0


def mark_player_downed(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    entry["hp"] = 0.0
    entry["state"] = "downed"
    return True


def mark_enemy_downed(entity: dict) -> bool:
    if not isinstance(entity, dict):
        return False
    entity["hp"] = 0.0
    entity["state"] = "downed"
    return True


def clear_combatant_state(entry: dict) -> None:
    if not isinstance(entry, dict):
        return
    if safe_float(entry.get("hp", entry.get("maxHp", entry.get("max_hp", 0.0))), 0.0) > 0.0:
        entry.pop("state", None)


def is_combat_actor_active(actor: dict) -> bool:
    if not isinstance(actor, dict):
        return False
    actor_type = str(actor.get("type") or "").strip().lower()
    actor_id = str(actor.get("id") or "").strip()
    if actor_type == "player":
        owner_sid = str(actor.get("ownerSid") or "").strip()
        entry = players.get(owner_sid) if owner_sid else None
        if not isinstance(entry, dict) and actor_id:
            resolved_sid = sid_for_actor(actor_id)
            entry = players.get(resolved_sid) if resolved_sid else None
        return isinstance(entry, dict) and normalize_role(entry.get("role")) == "player" and not is_player_downed(entry)
    if actor_type == "enemy":
        entities = world_state.get("entities", {})
        entity = entities.get(actor_id) if isinstance(entities, dict) else None
        return isinstance(entity, dict) and is_enemy(entity) and not is_enemy_downed(entity)
    return False


def prune_defeated_enemies() -> list[str]:
    entities = world_state.get("entities", {})
    if not isinstance(entities, dict):
        return []
    removed: list[str] = []
    for eid, entity in list(entities.items()):
        if not is_enemy(entity):
            continue
        if not is_enemy_downed(entity):
            continue
        removed.append(str((entity or {}).get("networkId") or eid or ""))
        entities.pop(eid, None)
    return removed


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
        "movement_capabilities": deepcopy(entry.get("movement_capabilities")) if isinstance(entry.get("movement_capabilities"), dict) else None,
        "inventory": deepcopy(entry.get("inventory")) if isinstance(entry.get("inventory"), dict) else None,
        "equipped_weapon": deepcopy(entry.get("equipped_weapon")) if isinstance(entry.get("equipped_weapon"), dict) else None,
        "attackBonus": entry.get("attackBonus"),
        "damageRoll": entry.get("damageRoll"),
        "damageBonus": entry.get("damageBonus"),
        "expiresAt": t + RESUME_SESSION_TTL_SEC,
        "lastSeen": t,
    }
