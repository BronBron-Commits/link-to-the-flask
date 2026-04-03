"""
CONNECTION MANAGER — Who's connected.

Handles the full connect/disconnect lifecycle:
  - session resume (reconnecting with a prior resume key)
  - role assignment and player slot ownership
  - initial state delivery to new clients
  - clean teardown on disconnect
"""
from flask import request
from flask_socketio import emit

from extensions import socketio
import game_state as gs
from state_sync import (
    broadcast_world,
    broadcast_lobby,
    emit_world_to,
    emit_combat_state_to,
    emit_combat_turn_to,
)


def on_connect(payload=None) -> None:
    sid = request.sid
    try:
        gs.cleanup_resume_sessions()

        # --- Resolve resume key ---
        resume_key: str | None = None
        if isinstance(payload, dict):
            resume_key = gs.sanitize_resume_key(payload.get("resumeKey"))
        if not resume_key:
            resume_key = gs.sanitize_resume_key(request.args.get("resumeKey"))
        if resume_key:
            gs.client_resume_keys[sid] = resume_key

        # --- Restore prior session if available ---
        snapshot: dict | None = None
        if resume_key:
            raw = gs.resume_sessions.get(resume_key)
            if isinstance(raw, dict):
                prev_sid = str(raw.get("sid") or "").strip()
                if prev_sid and prev_sid != sid:
                    # Evict the stale connection record before restoring.
                    prev_slot = gs.get_slot_for(prev_sid)
                    if prev_slot is not None:
                        gs.player_slot_owner[prev_slot] = None
                    gs.player_update_last_seen.pop(prev_sid, None)
                    gs.players.pop(prev_sid, None)
                    gs.client_roles.pop(prev_sid, None)
                    gs.client_resume_keys.pop(prev_sid, None)
                    # Re-point live combat order so turn ownership survives reconnect.
                    gs.update_turn_order_sid(prev_sid, sid)
                snapshot = raw

        role = gs.normalize_role(
            (snapshot or {}).get("role") if snapshot else gs.client_roles.get(sid, "player")
        )

        # --- Create base player entry ---
        gs.players[sid] = {
            "id": sid, "role": role, "slot": None,
            "actorId": None, "networkId": None, "isAuthoritative": False,
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
            "rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
        }
        gs.player_update_last_seen[sid] = 0.0

        # Restore slot index from snapshot before apply_role so claim_slot finds it.
        if snapshot and isinstance(snapshot.get("slotIndex"), int):
            slot_i = int(snapshot["slotIndex"])
            if 0 <= slot_i < len(gs.player_slot_owner):
                gs.player_slot_owner[slot_i] = sid

        # Apply role — falls back to dev or player if the desired slot is full.
        if not gs.apply_role(sid, role):
            fallback = "dev" if gs.can_assign_role("dev", sid=sid) else "player"
            gs.apply_role(sid, fallback)

        # --- Restore snapshot fields onto the player entry ---
        if snapshot:
            entry = gs.players.get(sid)
            if isinstance(entry, dict):
                if isinstance(snapshot.get("position"), dict):
                    entry["position"] = snapshot["position"]
                if isinstance(snapshot.get("rotation"), dict):
                    entry["rotation"] = snapshot["rotation"]
                if isinstance(snapshot.get("avatar"), dict):
                    entry["avatar"] = snapshot["avatar"]
                if isinstance(snapshot.get("movementPreview"), dict):
                    entry["movementPreview"] = snapshot["movementPreview"]
                if snapshot.get("networkId") is not None:
                    entry["networkId"] = str(snapshot["networkId"]).strip() or entry.get("networkId")
                for stat_key, cast in (
                    ("ac", int), ("max_hp", int),
                    ("initiative_bonus", int), ("speed_ft", int),
                ):
                    if snapshot.get(stat_key) is not None:
                        try:
                            entry[stat_key] = cast(gs.safe_float(snapshot[stat_key]))
                        except (TypeError, ValueError):
                            pass
                if snapshot.get("hp") is not None:
                    entry["hp"] = gs.safe_float(snapshot["hp"])
                elif entry.get("max_hp") is not None:
                    entry["hp"] = float(entry["max_hp"])
            gs.save_resume_snapshot(sid)

        # --- Deliver initial state to this client ---
        emit("player-id", {"id": sid})
        emit("server-build", {"build": gs.SERVER_BUILD_TAG})
        emit_world_to(sid, include_scene=True)
        emit("players-state", gs.players)
        emit("scene-state", gs.latest_scene_state)
        emit("lobby-state", gs.build_lobby_state())
        emit_combat_state_to(sid)
        emit_combat_turn_to(sid)

        # --- Notify other clients ---
        emit("player-joined", gs.players[sid], broadcast=True, include_self=False)
        socketio.emit("players-state", gs.players)
        broadcast_world(include_scene=False)
        broadcast_lobby()

    except Exception as exc:
        import traceback
        print(f"[ERROR] connect sid={sid}: {exc}", flush=True)
        traceback.print_exc()
        raise


def on_disconnect() -> None:
    sid = request.sid
    gs.save_resume_snapshot(sid)
    # Release the player slot so resume can reclaim it.
    # Do NOT modify combat state — resume will restore turn ownership.
    gs.release_slot(sid)
    gs.player_update_last_seen.pop(sid, None)
    gs.players.pop(sid, None)
    gs.client_roles.pop(sid, None)
    gs.client_resume_keys.pop(sid, None)
    gs.refresh_authority()
    emit("player-left", {"id": sid}, broadcast=True)
    socketio.emit("players-state", gs.players)
    broadcast_world(include_scene=False)
    broadcast_lobby()
