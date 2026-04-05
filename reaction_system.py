"""Reaction system and deterministic reaction queue resolution."""

from __future__ import annotations

import random
from typing import Callable

from extensions import socketio
import game_state as gs


ReactionHandler = Callable[[dict], list[dict]]
_REACTION_HANDLERS: dict[str, ReactionHandler] = {}


def _distance_2d(a: dict, b: dict) -> float:
    dx = gs.safe_float(a.get("x", 0.0)) - gs.safe_float(b.get("x", 0.0))
    dz = gs.safe_float(a.get("z", 0.0)) - gs.safe_float(b.get("z", 0.0))
    return (dx * dx + dz * dz) ** 0.5


def _is_player_alive(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    return gs.safe_float(entry.get("hp", entry.get("max_hp", 0)), 0) > 0


def _is_enemy_alive(entry: dict) -> bool:
    if not isinstance(entry, dict):
        return False
    if not gs.is_enemy(entry):
        return False
    return gs.safe_float(entry.get("hp", entry.get("maxHp", 0)), 0) > 0


def _combat_reaction_ledger() -> tuple[int, dict]:
    combat = gs.world_state.get("combat") if isinstance(gs.world_state.get("combat"), dict) else {}
    state = combat.get("state") if isinstance(combat.get("state"), dict) else {}
    round_number = int(gs.safe_float(state.get("roundNumber", 1), 1))
    ledger = state.setdefault("reactionLedger", {}) if isinstance(state, dict) else {}
    if not isinstance(ledger, dict):
        ledger = {}
        if isinstance(state, dict):
            state["reactionLedger"] = ledger
    return round_number, ledger


def _resolve_player_by_actor_id(actor_id: str) -> tuple[str | None, dict | None]:
    sid = gs.sid_for_actor(actor_id)
    if sid and isinstance(gs.players.get(sid), dict):
        return sid, gs.players[sid]
    return None, None


def _resolve_enemy_by_actor_id(actor_id: str) -> dict | None:
    entities = gs.world_state.get("entities") if isinstance(gs.world_state.get("entities"), dict) else {}
    row = entities.get(actor_id) if isinstance(entities, dict) else None
    return row if isinstance(row, dict) else None


def _make_reaction_candidate(reactor: dict, mover_start: dict, mover_end: dict) -> dict | None:
    actor_id = str(reactor.get("actorId") or "").strip()
    if not actor_id:
        return None
    reactor_pos = reactor.get("position") if isinstance(reactor.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
    start_dist = _distance_2d(mover_start, reactor_pos)
    end_dist = _distance_2d(mover_end, reactor_pos)
    if not (start_dist <= 5.0 and end_dist > 5.0):
        return None
    out = dict(reactor)
    out["startDist"] = start_dist
    out["endDist"] = end_dist
    return out


def _resolve_reaction_attack(reactor: dict, mover: dict) -> dict:
    reactor_type = str(reactor.get("actorType") or "enemy").lower()
    reactor_id = str(reactor.get("actorId") or "")
    mover_type = str(mover.get("actorType") or "player").lower()
    mover_actor_id = str(mover.get("actorId") or "")

    target_ac = 10
    if mover_type == "player":
        _, target_entry = _resolve_player_by_actor_id(mover_actor_id)
        target_ac = int(gs.safe_float((target_entry or {}).get("ac", 10), 10))
    else:
        target_entry = _resolve_enemy_by_actor_id(mover_actor_id)
        target_ac = int(gs.safe_float((target_entry or {}).get("ac", 10), 10))

    if reactor_type == "player":
        sid, player = _resolve_player_by_actor_id(reactor_id)
        weapon = gs.resolve_equipped_weapon(player or {})
        atk_bonus = int(gs.safe_float(weapon.get("attackBonus", 0), 0))
        dmg_die = max(1, int(gs.safe_float(weapon.get("damageRoll", 3), 3)))
        dmg_bonus = int(gs.safe_float(weapon.get("damageBonus", 0), 0))
    else:
        sid = None
        enemy = _resolve_enemy_by_actor_id(reactor_id) or {}
        atk_bonus = int(gs.safe_float(enemy.get("attackBonus", 2), 2))
        dmg_die = max(1, int(gs.safe_float(enemy.get("damageRoll", 4), 4)))
        dmg_bonus = int(gs.safe_float(enemy.get("damageBonus", 0), 0))

    hit_roll = random.randint(1, 20)
    total = hit_roll + atk_bonus
    is_hit = hit_roll == 20 or (hit_roll != 1 and total >= target_ac)
    damage = max(0, random.randint(1, dmg_die) + dmg_bonus) if is_hit else 0

    if is_hit:
        if mover_type == "player":
            _, target_player = _resolve_player_by_actor_id(mover_actor_id)
            if isinstance(target_player, dict):
                hp_before = gs.safe_float(target_player.get("hp", target_player.get("max_hp", 0)), 0)
                target_player["hp"] = max(0.0, hp_before - float(damage))
        else:
            target_enemy = _resolve_enemy_by_actor_id(mover_actor_id)
            if isinstance(target_enemy, dict):
                hp_before = gs.safe_float(target_enemy.get("hp", target_enemy.get("maxHp", 0)), 0)
                target_enemy["hp"] = max(0.0, hp_before - float(damage))

    return {
        "attacker": reactor_id,
        "actorType": reactor_type,
        "type": "opportunity-attack",
        "reaction": True,
        "targetId": mover_actor_id,
        "targetType": mover_type,
        "reactorSid": sid,
        "hitRoll": hit_roll,
        "attackBonus": atk_bonus,
        "toHit": total,
        "targetAC": target_ac,
        "hit": is_hit,
        "damage": damage,
    }


def _handle_leave_melee_range(ctx: dict) -> list[dict]:
    mover_actor_type = str(ctx.get("moverActorType") or "player").strip().lower()
    mover_actor_id = str(ctx.get("moverActorId") or "").strip()
    mover_start = ctx.get("startPos") if isinstance(ctx.get("startPos"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0}
    mover_end = ctx.get("endPos") if isinstance(ctx.get("endPos"), dict) else mover_start
    is_disengage = bool(ctx.get("isDisengage", False))
    if is_disengage or not mover_actor_id:
        return []

    round_number, ledger = _combat_reaction_ledger()
    entities = gs.world_state.get("entities") if isinstance(gs.world_state.get("entities"), dict) else {}

    candidates: list[dict] = []
    if mover_actor_type == "player":
        for enemy_id, enemy in entities.items() if isinstance(entities, dict) else []:
            if not _is_enemy_alive(enemy):
                continue
            cand = _make_reaction_candidate(
                {
                    "actorId": str(enemy.get("networkId") or enemy_id),
                    "actorType": "enemy",
                    "position": enemy.get("position") if isinstance(enemy.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0},
                },
                mover_start,
                mover_end,
            )
            if cand is not None:
                candidates.append(cand)
    else:
        for sid, player in gs.players.items():
            if not _is_player_alive(player):
                continue
            actor_id = str(player.get("actorId") or player.get("networkId") or "").strip()
            if not actor_id:
                continue
            cand = _make_reaction_candidate(
                {
                    "actorId": actor_id,
                    "actorType": "player",
                    "ownerSid": sid,
                    "position": player.get("position") if isinstance(player.get("position"), dict) else {"x": 0.0, "y": 0.0, "z": 0.0},
                },
                mover_start,
                mover_end,
            )
            if cand is not None:
                candidates.append(cand)

    # Deterministic queue ordering: closest first, then actor id lexical.
    candidates.sort(key=lambda c: (round(float(c.get("startDist", 0.0)), 6), str(c.get("actorId") or "")))

    queue_rows = []
    for cand in candidates:
        actor_id = str(cand.get("actorId") or "")
        if not actor_id:
            continue
        used_round = int(gs.safe_float(ledger.get(actor_id, -1), -1))
        if used_round == round_number:
            continue
        queue_rows.append({"reactor": actor_id, "actorType": cand.get("actorType"), "priority": len(queue_rows) + 1})

    if queue_rows:
        socketio.emit("combat-reaction-queue", {
            "event": "leave_melee_range",
            "moverActorId": mover_actor_id,
            "moverActorType": mover_actor_type,
            "queue": queue_rows,
        })

    resolved: list[dict] = []
    for cand in candidates:
        actor_id = str(cand.get("actorId") or "")
        if not actor_id:
            continue
        used_round = int(gs.safe_float(ledger.get(actor_id, -1), -1))
        if used_round == round_number:
            continue

        reaction_event = _resolve_reaction_attack(
            reactor={"actorId": actor_id, "actorType": cand.get("actorType")},
            mover={"actorId": mover_actor_id, "actorType": mover_actor_type},
        )
        ledger[actor_id] = round_number
        resolved.append(reaction_event)
        socketio.emit("combat-reaction-result", reaction_event)

    return resolved


def register_reaction_handler(event_name: str, handler: ReactionHandler) -> None:
    key = str(event_name or "").strip().lower()
    if not key:
        return
    _REACTION_HANDLERS[key] = handler


def trigger_reactions(event_name: str, context: dict) -> list[dict]:
    key = str(event_name or "").strip().lower()
    handler = _REACTION_HANDLERS.get(key)
    if handler is None:
        return []
    payload = context if isinstance(context, dict) else {}
    return handler(payload)


register_reaction_handler("leave_melee_range", _handle_leave_melee_range)
register_reaction_handler("attack_declared", lambda ctx: [])
register_reaction_handler("spell_cast", lambda ctx: [])
