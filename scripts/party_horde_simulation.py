"""Build a party from character PDFs and run a deterministic party-vs-horde simulation."""

from __future__ import annotations

import argparse
from contextlib import redirect_stdout
import io
import json
import random
from pathlib import Path
import sys

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import combat_harness
from scripts import pdf_to_tidy_data as pdf_parser


def discover_character_pdfs(static_dir: Path) -> list[Path]:
    if not static_dir.exists():
        return []
    out: list[Path] = []
    for path in sorted(static_dir.rglob("*")):
        if not path.is_file():
            continue
        if path.suffix.lower() != ".pdf":
            continue
        out.append(path)
    return out


def _parse_engine_entity(pdf_path: Path) -> dict:
    # Parser emits verbose diagnostics; keep party-horde runs readable.
    with redirect_stdout(io.StringIO()):
        tables = pdf_parser.parse_character_tables(pdf_path)
    master = pdf_parser.build_master_character_record(tables)
    entity = pdf_parser.build_engine_entity(master)
    pdf_parser.validate_engine_entity_contract(entity)
    return entity


def _player_entry_from_entity(entity: dict, sid: str, actor_id: str, slot_index: int) -> dict:
    combat = entity.get("combat") if isinstance(entity.get("combat"), dict) else {}
    hp = float(combat.get("hp", combat.get("maxHp", 20)) or 20)
    max_hp = float(combat.get("maxHp", hp) or hp)
    return {
        "id": sid,
        "actorId": actor_id,
        "networkId": actor_id,
        "role": "player",
        "slot": slot_index,
        "name": str(entity.get("name") or actor_id),
        "hp": max(1.0, hp),
        "max_hp": max(1.0, max_hp),
        "ac": int(combat.get("ac", 10) or 10),
        "initiative_bonus": int(combat.get("initiative", 0) or 0),
        "speed_ft": int(combat.get("speed", 30) or 30),
        "position": {"x": float(slot_index * 2 - 2), "y": 0.0, "z": 0.0},
        "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        "inventory": entity.get("inventory") if isinstance(entity.get("inventory"), dict) else {"items": []},
    }


def _build_horde(enemy_count: int, rng: random.Random = None) -> dict[str, dict]:
    """Build a horde with radial/circular positioning to avoid stacking."""
    if rng is None:
        rng = random.Random()
    
    out: dict[str, dict] = {}
    for i in range(enemy_count):
        eid = f"enemy_{i + 1}"
        # Scaled down for beginner-appropriate difficulty
        # HP: 8-12 (was 24-54)
        hp = 8 + (i % 3) * 2
        
        # Radial distribution: enemies spawn in circles around origin
        # Use golden angle for even spatial distribution
        angle = (i * 2.39996) % (2 * 3.14159)  # Golden angle in radians
        radius = 5 + (i // 8) * 3  # Increase radius for each "ring"
        
        x = radius * (angle ** 0.5) if angle > 0 else 0
        z = radius * (1 - angle / 6.28) if angle > 0 else 0
        
        # Add small random jitter to avoid perfect alignment
        x += (rng.random() - 0.5) * 0.5
        z += (rng.random() - 0.5) * 0.5
        
        out[eid] = {
            "id": eid,
            "networkId": eid,
            "type": "enemy",
            "name": f"Goblin {i + 1}",
            "position": {"x": float(x), "y": 0.0, "z": float(z)},
            "hp": float(hp),
            "maxHp": float(hp),
            "ac": 9 + (i % 2),           # 9-10 (was 10-12, easier to hit)
            "attackBonus": 1 + (i % 2),   # +1-+2 (was +2-+4, less accurate)
            "damageRoll": 2 + (i % 2),    # 1d2-1d3 (was 1d4-1d8, much lower damage)
            "damageBonus": 0 + (i % 2),   # +0-+1 (was +1-+2, minimal bonus)
        }
    return out


def _build_turn_order(players: dict[str, dict], entities: dict[str, dict]) -> list[dict]:
    player_rows = [
        {"id": str(entry.get("actorId") or sid), "type": "player", "ownerSid": sid}
        for sid, entry in players.items()
        if isinstance(entry, dict)
    ]
    enemy_rows = [
        {"id": eid, "type": "enemy"}
        for eid, row in entities.items()
        if isinstance(row, dict) and str(row.get("type") or "").lower() == "enemy"
    ]

    order: list[dict] = []
    p_idx = 0
    e_idx = 0
    while p_idx < len(player_rows) or e_idx < len(enemy_rows):
        if p_idx < len(player_rows):
            order.append(player_rows[p_idx])
            p_idx += 1
        if e_idx < len(enemy_rows):
            order.append(enemy_rows[e_idx])
            e_idx += 1
    return order


def build_party_horde_initial_state(entities: list[dict], enemy_count: int, seed: int = None) -> dict:
    rng = random.Random(seed) if seed is not None else random.Random()
    players: dict[str, dict] = {}
    client_roles: dict[str, str] = {}
    for idx, entity in enumerate(entities, start=1):
        sid = f"p{idx}"
        actor_id = f"player_{idx}"
        players[sid] = _player_entry_from_entity(entity, sid, actor_id, idx)
        client_roles[sid] = "player"

    horde = _build_horde(max(1, enemy_count), rng)
    order = _build_turn_order(players, horde)

    return {
        "players": players,
        "client_roles": client_roles,
        "world_state": {
            "players": {},
            "entities": horde,
            "mode": "combat",
            "combat": {
                "turn": 0,
                "order": order,
                "state": {"inCombat": True, "roundNumber": 1},
            },
            "scene": {"objects": []},
        },
    }


def make_party_chaos_provider(max_steps: int):
    chaos_trigger_step = max(4, int(max_steps * 0.30))
    memory = {"last_action_id": None}

    def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
        actor_id = str(actor.get("id") or "player")
        action_id = f"party_chaos_{step}_{actor_id}"
        entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
        live_targets = [
            eid
            for eid, row in entities.items()
            if isinstance(row, dict) and str(row.get("type") or "").lower() == "enemy" and float(row.get("hp", 0)) > 0
        ]
        target_id = live_targets[0] if live_targets else "enemy_1"

        if step >= chaos_trigger_step:
            p = rng.random()
            if p < 0.12 and memory["last_action_id"]:
                return {"id": memory["last_action_id"], "type": "attack", "targetId": target_id}
            if p < 0.22:
                memory["last_action_id"] = action_id
                return {"id": action_id, "type": "attack"}
            if p < 0.30:
                memory["last_action_id"] = action_id
                return {"id": action_id, "type": "teleport"}
            if p < 0.38:
                memory["last_action_id"] = action_id
                return {"id": action_id, "type": "attack", "targetId": "enemy_UNKNOWN"}

        if rng.random() < 0.8:
            payload = {"id": action_id, "type": "attack", "targetId": target_id}
        elif rng.random() < 0.5:
            payload = {"id": action_id, "type": "move"}
        else:
            payload = {"id": action_id, "type": "dodge"}

        memory["last_action_id"] = action_id
        return payload

    return _provider


def summarize_run(result: dict, parsed_count: int, failed: list[dict], enemy_count: int) -> dict:
    timeline = result.get("timeline") if isinstance(result.get("timeline"), list) else []
    records = [
        step.get("stepRecord")
        for step in timeline
        if isinstance(step, dict) and isinstance(step.get("stepRecord"), dict)
    ]
    
    # Filter out combat-ended system events
    attacks = [
        r for r in records 
        if isinstance(r.get("action"), dict) and (r.get("action") or {}).get("type") == "ATTACK"
    ]
    applied = [r for r in attacks if r.get("result") == "applied"]
    hit_count = sum(1 for r in applied if bool(r.get("hit")))
    total_damage = sum(int(r.get("damage") or 0) for r in applied)

    deny_counts: dict[str, int] = {}
    for row in records:
        reason = str(row.get("denyReason") or "").strip()
        if not reason:
            continue
        deny_counts[reason] = deny_counts.get(reason, 0) + 1

    remaining_enemies = 0
    entities = result.get("finalState", {}).get("entities", {}) if isinstance(result.get("finalState"), dict) else {}
    if isinstance(entities, dict):
        remaining_enemies = sum(
            1
            for row in entities.values()
            if isinstance(row, dict)
            and str(row.get("type") or "").lower() == "enemy"
            and float(row.get("hp", 0)) > 0
        )

    return {
        "seed": result.get("seed"),
        "partySize": parsed_count,
        "enemyCount": enemy_count,
        "remainingEnemies": remaining_enemies,
        "steps": result.get("steps"),
        "stopReason": result.get("stopReason"),
        "combatFinished": bool(result.get("combatFinished")),
        "finalHash": str(result.get("finalHash") or "")[:16],
        "attackAttempts": len(attacks),
        "attackApplied": len(applied),
        "hitCount": hit_count,
        "hitRate": round((hit_count / max(1, len(applied))), 3),
        "totalDamage": total_damage,
        "denyCounts": deny_counts,
        "failedPdfs": failed,
    }


def run_party_horde(
    static_dir: Path,
    *,
    enemy_count: int,
    seed: int,
    max_steps: int,
    log_dir: Path,
) -> tuple[dict, Path]:
    pdf_paths = discover_character_pdfs(static_dir)
    if not pdf_paths:
        raise ValueError(f"No PDFs found under: {static_dir}")

    entities: list[dict] = []
    failed: list[dict] = []
    for path in pdf_paths:
        try:
            entities.append(_parse_engine_entity(path))
        except Exception as exc:
            failed.append({"pdf": str(path), "error": str(exc)})

    if not entities:
        raise ValueError("All character PDFs failed to parse")

    initial_state = build_party_horde_initial_state(entities, enemy_count=enemy_count, seed=seed)
    provider = make_party_chaos_provider(max_steps)
    result = combat_harness.run_combat(
        initial_state,
        provider,
        seed=seed,
        max_steps=max_steps,
        validate_invariants=True,
    )

    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = f"{seed}_{int(max_steps)}_{int(enemy_count)}"
    log_path = log_dir / f"party_horde_{stamp}.json"
    combat_harness.save_combat_log(log_path, result)

    summary = summarize_run(result, parsed_count=len(entities), failed=failed, enemy_count=enemy_count)
    return summary, log_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run party-vs-horde deterministic combat simulation from static PDFs")
    parser.add_argument("--static-dir", type=Path, default=Path("static"))
    parser.add_argument("--enemy-count", type=int, default=24)
    parser.add_argument("--seed", type=int, default=2026)
    parser.add_argument("--max-steps", type=int, default=220)
    parser.add_argument("--log-dir", type=Path, default=Path("data") / "combat_logs")
    args = parser.parse_args()

    summary, log_path = run_party_horde(
        args.static_dir,
        enemy_count=max(1, int(args.enemy_count)),
        seed=int(args.seed),
        max_steps=max(1, int(args.max_steps)),
        log_dir=args.log_dir,
    )
    print(json.dumps({"summary": summary, "logPath": str(log_path)}, indent=2))


if __name__ == "__main__":
    main()
