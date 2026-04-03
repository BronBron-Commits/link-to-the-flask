"""
STATE SYNC — Broadcast helpers.

Sends the authoritative server state to clients.
State is never modified here — only read and emitted.
"""
from flask_socketio import emit

from extensions import socketio
import game_state as gs


def broadcast_world(include_scene: bool = False) -> None:
    """Push a world-update snapshot to every connected client."""
    socketio.emit("world-update", gs.build_world_payload(include_scene=include_scene))


def broadcast_lobby() -> None:
    socketio.emit("lobby-state", gs.build_lobby_state())


def broadcast_combat_turn() -> None:
    socketio.emit("combat-turn", gs.build_combat_turn_payload())


def emit_world_to(sid: str, include_scene: bool = True) -> None:
    """Send a full world snapshot to a single client (used on connect)."""
    emit("world-init", gs.build_world_payload(include_scene=include_scene), to=sid)


def emit_combat_state_to(sid: str) -> None:
    """Emit the current combat active/inactive state to a single client."""
    combat_state = gs.world_state.get("combat", {}).get("state", {})
    in_combat = bool(combat_state.get("inCombat", False))
    if in_combat:
        emit("combat-state", {
            "active": True,
            "initiator": combat_state.get("initiator"),
            "targetId": combat_state.get("targetId"),
            "mode": "combat",
            "approvedBy": combat_state.get("approvedBy"),
        }, to=sid)
    else:
        emit("combat-state", {
            "active": False,
            "initiator": combat_state.get("initiator"),
            "mode": "exploration",
        }, to=sid)


def emit_combat_turn_to(sid: str) -> None:
    emit("combat-turn", gs.build_combat_turn_payload(), to=sid)
