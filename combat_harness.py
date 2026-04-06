"""Headless deterministic combat runner for offline simulation and replay."""

from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import json
import random
from typing import Callable
from unittest.mock import patch
import builtins

import action_handler
import game_state as gs
import turn_manager


ActionProvider = Callable[[dict, dict, random.Random, int], dict | None]
FinishCondition = Callable[[dict, int], bool]


def _reset_runtime_state(initial_state: dict) -> None:
    source = initial_state if isinstance(initial_state, dict) else {}

    gs.players.clear()
    gs.players.update(deepcopy(source.get("players") if isinstance(source.get("players"), dict) else {}))

    gs.client_roles.clear()
    gs.client_roles.update(deepcopy(source.get("client_roles") if isinstance(source.get("client_roles"), dict) else {}))

    gs.client_resume_keys.clear()
    gs.player_update_last_seen.clear()
    gs.resume_sessions.clear()
    gs.pending_combat_start_requests.clear()
    gs.recent_combat_action_ids.clear()
    gs.combat_action_rate_window.clear()
    gs.player_slot_owner[:] = [None] * len(gs.player_slot_owner)

    world = deepcopy(source.get("world_state") if isinstance(source.get("world_state"), dict) else {})
    if not world:
        world = {
            "players": {},
            "entities": {},
            "mode": "exploration",
            "combat": {"turn": None, "order": [], "state": {"inCombat": False}},
            "scene": {"objects": []},
        }

    gs.world_state.clear()
    gs.world_state.update(world)
    gs.latest_scene_state = deepcopy(gs.world_state.get("scene") if isinstance(gs.world_state.get("scene"), dict) else {"objects": []})
    gs.refresh_authority()


def _state_snapshot() -> dict:
    return gs.deserialize_state(gs.serialize_state(gs.world_state))


def _current_actor(state: dict) -> dict | None:
    combat = state.get("combat") if isinstance(state.get("combat"), dict) else {}
    order = combat.get("order") if isinstance(combat.get("order"), list) else []
    if not order:
        return None
    idx_raw = combat.get("turn")
    idx = int(idx_raw) if idx_raw is not None else 0
    if not (0 <= idx < len(order)):
        return None
    actor = order[idx]
    return actor if isinstance(actor, dict) else None


def _is_actor_alive(actor: dict) -> bool:
    if not isinstance(actor, dict):
        return False
    actor_type = str(actor.get("type") or "player").strip().lower()
    actor_id = str(actor.get("id") or "").strip()
    if not actor_id:
        return False

    if actor_type == "enemy":
        entity = gs.world_state.get("entities", {}).get(actor_id)
        if not isinstance(entity, dict):
            return False
        hp = gs.safe_float(entity.get("hp", entity.get("maxHp", 0)), 0)
        return hp > 0

    sid = str(actor.get("ownerSid") or "").strip() or gs.sid_for_actor(actor_id)
    if not sid:
        return False
    player = gs.players.get(sid)
    if not isinstance(player, dict):
        return False
    hp = gs.safe_float(player.get("hp", player.get("max_hp", 1)), 1)
    return hp > 0


def _prune_defeated_from_turn_order() -> None:
    combat = gs.world_state.get("combat") if isinstance(gs.world_state.get("combat"), dict) else {}
    order = combat.get("order") if isinstance(combat.get("order"), list) else []
    if not order:
        return

    idx_raw = combat.get("turn")
    old_idx = int(idx_raw) if idx_raw is not None else 0
    new_order: list[dict] = []
    removed_at_or_before = 0
    changed = False
    for idx, row in enumerate(order):
        keep = _is_actor_alive(row)
        if keep:
            new_order.append(row)
            continue
        changed = True
        if idx <= old_idx:
            removed_at_or_before += 1

    if not changed:
        return

    combat["order"] = new_order
    if not new_order:
        combat["turn"] = None
        return

    new_idx = old_idx - removed_at_or_before
    if new_idx < 0:
        new_idx = 0
    if new_idx >= len(new_order):
        new_idx = len(new_order) - 1
    combat["turn"] = new_idx


def _default_finished(state: dict) -> bool:
    combat = state.get("combat") if isinstance(state.get("combat"), dict) else {}
    order = combat.get("order") if isinstance(combat.get("order"), list) else []
    in_combat = bool((combat.get("state") or {}).get("inCombat"))
    if not in_combat or not order:
        return True

    players_alive = 0
    for entry in gs.players.values():
        if not isinstance(entry, dict):
            continue
        if gs.normalize_role(entry.get("role")) != "player":
            continue
        hp = gs.safe_float(entry.get("hp", entry.get("max_hp", 1)), 1)
        if hp > 0:
            players_alive += 1

    entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
    enemy_rows = [e for e in entities.values() if isinstance(e, dict) and gs.is_enemy(e)]
    if not enemy_rows:
        return False

    enemies_alive = sum(1 for row in enemy_rows if gs.safe_float(row.get("hp", row.get("maxHp", 1)), 1) > 0)
    return players_alive <= 0 or enemies_alive <= 0


def _assert_round_progression(prev_state: dict, next_state: dict) -> None:
    prev_combat = prev_state.get("combat") if isinstance(prev_state.get("combat"), dict) else {}
    next_combat = next_state.get("combat") if isinstance(next_state.get("combat"), dict) else {}
    prev_in = bool((prev_combat.get("state") or {}).get("inCombat"))
    next_in = bool((next_combat.get("state") or {}).get("inCombat"))
    if not prev_in or not next_in:
        return

    prev_round = int(gs.safe_float((prev_combat.get("state") or {}).get("roundNumber", 1), 1))
    next_round = int(gs.safe_float((next_combat.get("state") or {}).get("roundNumber", 1), 1))
    if next_round >= prev_round:
        return

    prev_turn = prev_combat.get("turn")
    next_turn = next_combat.get("turn")
    prev_order = prev_combat.get("order") if isinstance(prev_combat.get("order"), list) else []
    next_order = next_combat.get("order") if isinstance(next_combat.get("order"), list) else []
    prev_sig = tuple(str((row or {}).get("id") or "") for row in prev_order if isinstance(row, dict))
    next_sig = tuple(str((row or {}).get("id") or "") for row in next_order if isinstance(row, dict))

    # Explicit reset allowance: new round starts from 1 at turn 0 with changed combat order.
    explicit_reset = next_round == 1 and (next_turn == 0 or next_turn is None) and prev_sig != next_sig
    if explicit_reset:
        return

    raise ValueError(
        f"Round counter regressed unexpectedly: {prev_round} -> {next_round} "
        f"(turn {prev_turn} -> {next_turn})"
    )


def assert_valid_state(state: dict) -> None:
    combat = state.get("combat") if isinstance(state.get("combat"), dict) else {}
    order = combat.get("order") if isinstance(combat.get("order"), list) else []
    idx_raw = combat.get("turn")
    idx = int(idx_raw) if idx_raw is not None else 0

    if order and not (0 <= idx < len(order)):
        raise ValueError("Invalid turn index for combat order")

    seen_ids: set[str] = set()
    for row in order:
        if not isinstance(row, dict):
            continue
        actor_id = str(row.get("id") or "").strip()
        if not actor_id:
            continue
        if actor_id in seen_ids:
            raise ValueError("Duplicate actor id in combat order")
        seen_ids.add(actor_id)

    entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
    for entity in entities.values():
        if not isinstance(entity, dict):
            continue
        hp = gs.safe_float(entity.get("hp", entity.get("maxHp", 0)), 0)
        if hp < 0:
            raise ValueError("Entity hp below zero")

    for entry in gs.players.values():
        if not isinstance(entry, dict):
            continue
        hp = gs.safe_float(entry.get("hp", entry.get("max_hp", 0)), 0)
        if hp < 0:
            raise ValueError("Player hp below zero")


def _state_diff(prev_state: dict, next_state: dict) -> dict:
    out = {
        "turn": {
            "from": ((prev_state.get("combat") or {}).get("turn")),
            "to": ((next_state.get("combat") or {}).get("turn")),
            "roundFrom": ((prev_state.get("combat") or {}).get("state") or {}).get("roundNumber"),
            "roundTo": ((next_state.get("combat") or {}).get("state") or {}).get("roundNumber"),
        },
        "entityHp": {},
        "playerHp": {},
    }

    prev_entities = prev_state.get("entities") if isinstance(prev_state.get("entities"), dict) else {}
    next_entities = next_state.get("entities") if isinstance(next_state.get("entities"), dict) else {}
    for eid, next_row in next_entities.items():
        if not isinstance(next_row, dict):
            continue
        prev_row = prev_entities.get(eid) if isinstance(prev_entities.get(eid), dict) else {}
        hp_prev = gs.safe_float(prev_row.get("hp", prev_row.get("maxHp", 0)), 0)
        hp_next = gs.safe_float(next_row.get("hp", next_row.get("maxHp", 0)), 0)
        if hp_prev != hp_next:
            out["entityHp"][eid] = {"from": hp_prev, "to": hp_next, "delta": hp_next - hp_prev}

    for sid, entry in gs.players.items():
        if not isinstance(entry, dict):
            continue
        hp_next = gs.safe_float(entry.get("hp", entry.get("max_hp", 0)), 0)
        out["playerHp"][sid] = hp_next

    return out


def _flatten_state_diff(diff: dict) -> dict:
    flat: dict[str, float] = {}
    entity_hp = diff.get("entityHp") if isinstance(diff.get("entityHp"), dict) else {}
    for eid, change in entity_hp.items():
        if not isinstance(change, dict):
            continue
        flat[f"entities.{eid}.hp"] = float(gs.safe_float(change.get("delta", 0), 0))

    turn = diff.get("turn") if isinstance(diff.get("turn"), dict) else {}
    turn_from = turn.get("from")
    turn_to = turn.get("to")
    if turn_from != turn_to and turn_from is not None and turn_to is not None:
        flat["combat.turn"] = float(gs.safe_float(turn_to, 0) - gs.safe_float(turn_from, 0))

    round_from = turn.get("roundFrom")
    round_to = turn.get("roundTo")
    if round_from != round_to and round_from is not None and round_to is not None:
        flat["combat.roundNumber"] = float(gs.safe_float(round_to, 0) - gs.safe_float(round_from, 0))

    return flat


def _build_step_record(
    step_index: int,
    actor: dict,
    action: dict,
    before_state: dict,
    after_state: dict,
    events: list[dict],
    diff: dict,
) -> dict:
    combat_before = before_state.get("combat") if isinstance(before_state.get("combat"), dict) else {}
    turn_before = int(combat_before.get("turn")) if combat_before.get("turn") is not None else 0
    round_before = int(gs.safe_float((combat_before.get("state") or {}).get("roundNumber", 1), 1))
    action_id = str(action.get("id") or f"h_{step_index}")

    primary_result = None
    deny_payload = None
    for evt in events:
        if not isinstance(evt, dict):
            continue
        channel = str(evt.get("channel") or "")
        payload = evt.get("payload") if isinstance(evt.get("payload"), dict) else {}
        if channel == "combat-action-result" and primary_result is None:
            primary_result = payload
        if channel == "combat-action-denied" and deny_payload is None:
            deny_payload = payload

    action_type = str(action.get("type") or "unknown").upper()
    target_id = str(action.get("targetId") or (primary_result or {}).get("targetId") or "").strip() or None
    result_status = "applied"
    if isinstance(deny_payload, dict):
        result_status = "denied"

    return {
        "stepIndex": step_index,
        "turn": turn_before,
        "round": round_before,
        "actor": str(actor.get("id") or "unknown"),
        "actorType": str(actor.get("type") or "player"),
        "actionId": action_id,
        "action": {
            "type": action_type,
            "target": target_id,
            "payload": deepcopy(action),
        },
        "result": result_status,
        "denyReason": (deny_payload or {}).get("reason") if isinstance(deny_payload, dict) else None,
        "roll": (primary_result or {}).get("hitRoll") if isinstance(primary_result, dict) else None,
        "hit": (primary_result or {}).get("hit") if isinstance(primary_result, dict) else None,
        "damage": int(gs.safe_float((primary_result or {}).get("damage", 0), 0)) if isinstance(primary_result, dict) else 0,
        "stateDiff": _flatten_state_diff(diff),
        "stateHashBefore": gs.hash_state(before_state),
        "stateHashAfter": gs.hash_state(after_state),
    }


def run_combat(
    initial_state: dict,
    get_action: ActionProvider,
    seed: int,
    *,
    max_steps: int = 200,
    finish_condition: FinishCondition | None = None,
    validate_invariants: bool = True,
) -> dict:
    """Run deterministic headless combat loop and return final state + timeline."""

    _reset_runtime_state(initial_state)
    rng = random.Random(int(seed))
    timeline: list[dict] = []
    event_buffer: list[dict] = []

    def _capture_emit(channel: str, payload=None, *args, **kwargs):
        event_buffer.append(
            {
                "channel": str(channel),
                "payload": deepcopy(payload),
                "kwargs": deepcopy(kwargs) if isinstance(kwargs, dict) else {},
            }
        )

    def _seeded_randint(low: int, high: int) -> int:
        return rng.randint(low, high)

    time_tick = {"value": 1700000000.0}

    def _seeded_time() -> float:
        time_tick["value"] += 0.001
        return time_tick["value"]

    stop_reason = "max-steps-reached"
    with patch("action_handler.emit", side_effect=_capture_emit), patch(
        "action_handler.socketio.emit", side_effect=_capture_emit
    ), patch("action_handler.broadcast_world"), patch("action_handler.random.randint", side_effect=_seeded_randint), patch(
        "turn_manager.emit", side_effect=_capture_emit
    ), patch(
        "turn_manager.socketio.emit", side_effect=_capture_emit
    ), patch("turn_manager.broadcast_world"), patch("turn_manager.gevent.sleep"), patch(
        "turn_manager.random.randint", side_effect=_seeded_randint
    ), patch("turn_manager.time.time", side_effect=_seeded_time), patch.object(builtins, "print"):
        for step in range(max_steps):
            _prune_defeated_from_turn_order()
            before = _state_snapshot()
            if validate_invariants:
                assert_valid_state(before)

            if finish_condition is not None:
                if finish_condition(before, step):
                    stop_reason = "finish-condition"
                    break
            elif _default_finished(before):
                stop_reason = "combat-finished"
                break

            actor = _current_actor(before)
            if actor is None:
                stop_reason = "no-active-actor"
                break

            event_start_idx = len(event_buffer)
            actor_type = str(actor.get("type") or "player").strip().lower()
            action: dict

            if actor_type == "enemy":
                action = {"id": f"h_enemy_{step}", "type": "enemy-auto", "actorId": actor.get("id")}
                turn_manager.run_enemy_turn(actor)
            else:
                sid = str(actor.get("ownerSid") or "").strip() or gs.sid_for_actor(str(actor.get("id") or "").strip())
                planned = get_action(before, actor, rng, step)
                payload = planned if isinstance(planned, dict) else {"type": "dodge"}
                payload = deepcopy(payload)
                payload.setdefault("id", f"h_{step}_{actor.get('id')}")
                action = payload
                if sid:
                    action_handler.handle_combat_action(sid, payload)
                else:
                    _capture_emit("combat-action-denied", {"reason": "missing-owner-sid"})

            turn_manager._advance_turn()
            after = _state_snapshot()
            if validate_invariants:
                assert_valid_state(after)
                _assert_round_progression(before, after)

            step_events = deepcopy(event_buffer[event_start_idx:])
            step_diff = _state_diff(before, after)
            step_record = _build_step_record(
                step_index=step,
                actor=actor,
                action=action,
                before_state=before,
                after_state=after,
                events=step_events,
                diff=step_diff,
            )

            timeline.append(
                {
                    "step": step,
                    "stepIndex": step,
                    "actor": deepcopy(actor),
                    "action": deepcopy(action),
                    "actionId": str(action.get("id") or f"h_{step}"),
                    "events": step_events,
                    "diff": step_diff,
                    "stateHashBefore": step_record["stateHashBefore"],
                    "stateHash": gs.hash_state(after),
                    "stepRecord": step_record,
                }
            )

    final_state = _state_snapshot()
    combat_finished = _default_finished(final_state)
    
    # === FINALIZE COMBAT STATE ===
    if combat_finished:
        # Mark combat as ended
        combat = final_state.get("combat", {})
        if "state" not in combat:
            combat["state"] = {}
        combat["state"]["inCombat"] = False
        
        # Remove dead entities from final turn order
        order = combat.get("order", [])
        clean_order = [actor for actor in order if _is_actor_alive(actor)]
        combat["order"] = clean_order
        combat["turn"] = None  # Combat is over, no active turn
        
        # Determine winner and survivors
        players_alive = sum(
            1 for sid, entry in gs.players.items()
            if isinstance(entry, dict) and gs.normalize_role(entry.get("role")) == "player"
            and gs.safe_float(entry.get("hp", entry.get("max_hp", 1)), 1) > 0
        )
        entities = final_state.get("entities", {})
        enemies_alive = sum(
            1 for e in entities.values()
            if isinstance(e, dict) and gs.is_enemy(e)
            and gs.safe_float(e.get("hp", e.get("maxHp", 1)), 1) > 0
        )
        
        winner = "players" if enemies_alive <= 0 else ("enemies" if players_alive <= 0 else "stalemate")
        
        # Add combat-ended event
        timeline.append({
            "step": len(timeline),
            "stepIndex": len(timeline),
            "actor": None,
            "action": {"type": "combat-ended"},
            "actionId": "combat-ended",
            "events": [{
                "channel": "combat-ended",
                "payload": {
                    "winner": winner,
                    "playersAlive": players_alive,
                    "enemiesAlive": enemies_alive,
                    "totalSteps": len(timeline),
                    "finalHash": gs.hash_state(final_state)
                },
                "kwargs": {}
            }],
            "diff": {},
            "stateHashBefore": gs.hash_state(final_state),
            "stateHash": gs.hash_state(final_state),
            "stepRecord": {
                "stepIndex": len(timeline),
                "actor": "system",
                "action": "combat-ended",
                "result": "completed",
                "winner": winner,
                "playersAlive": players_alive,
                "enemiesAlive": enemies_alive
            }
        })
    
    return {
        "seed": int(seed),
        "steps": len(timeline),
        "stopReason": stop_reason,
        "combatFinished": combat_finished,
        "finalState": final_state,
        "finalHash": gs.hash_state(final_state),
        "timeline": timeline,
    }


def save_combat_log(path: str | Path, run_result: dict) -> Path:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(run_result, indent=2, ensure_ascii=True), encoding="utf-8")
    return output


def format_timeline_step(step: dict) -> str:
    record = step.get("stepRecord") if isinstance(step.get("stepRecord"), dict) else {}
    if record:
        idx = record.get("stepIndex")
        actor_id = record.get("actor")
        action_data = record.get("action") if isinstance(record.get("action"), dict) else {}
        action_type = action_data.get("type") or "unknown"
        target_id = action_data.get("target") or "-"
        action_id = record.get("actionId")
        damage = record.get("damage")
        state_hash = str(record.get("stateHashAfter") or "")[:10]
        return (
            f"[STEP {idx}]"
            f"[ACTOR {actor_id}]"
            f"[ACTION {action_type}]"
            f"[TARGET {target_id}]"
            f"[ACTION_ID {action_id}]"
            f" actionId={action_id}"
            f"[DMG {damage}]"
            f"[HASH {state_hash}]"
        )

    action = step.get("action") if isinstance(step.get("action"), dict) else {}
    actor = step.get("actor") if isinstance(step.get("actor"), dict) else {}
    return f"Step {step.get('step')}: {actor.get('id')} {str(action.get('type') or 'unknown').upper()}"
