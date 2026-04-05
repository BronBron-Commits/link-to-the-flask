import unittest
from pathlib import Path
from unittest.mock import patch

import app
import game_state as gs


MAP3D_JS = Path(__file__).resolve().parents[1] / 'static' / 'map3d.js'


def reset_server_state() -> None:
    gs.players.clear()
    gs.client_roles.clear()
    gs.client_resume_keys.clear()
    gs.player_update_last_seen.clear()
    gs.resume_sessions.clear()
    gs.pending_combat_start_requests.clear()
    gs.recent_combat_action_ids.clear()
    gs.combat_action_rate_window.clear()
    gs.player_slot_owner[:] = [None] * len(gs.player_slot_owner)
    gs.latest_scene_state = {"objects": []}
    gs.world_state.clear()
    gs.world_state.update(
        {
            "players": {},
            "entities": {},
            "mode": "exploration",
            "combat": {
                "turn": None,
                "order": [],
                "state": {"inCombat": False},
            },
            "scene": gs.latest_scene_state,
        }
    )


class _FakeRequest:
    def __init__(self, sid: str):
        self.sid = sid


class PlayerSpawnHealthServerTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_server_state()

    def _call_stats(self, sid: str, payload: dict) -> None:
        original_request = app.request
        app.request = _FakeRequest(sid)
        try:
            with patch("app.emit"), patch("game_state.save_resume_snapshot"):
                app.socket_player_character_stats(payload)
        finally:
            app.request = original_request

    def test_out_of_combat_stats_load_resets_stale_hp_to_full(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "role": "player", "hp": 2.0, "max_hp": 20.0}
        gs.client_roles[sid] = "player"

        self._call_stats(sid, {"maxHp": 31, "ac": 15})

        self.assertEqual(gs.players[sid]["max_hp"], 31.0)
        self.assertEqual(gs.players[sid]["hp"], 31.0)

    def test_in_combat_stats_load_preserves_current_hp(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "role": "player", "hp": 7.0, "max_hp": 20.0}
        gs.client_roles[sid] = "player"
        gs.world_state["combat"]["state"]["inCombat"] = True

        self._call_stats(sid, {"maxHp": 31, "ac": 15})

        self.assertEqual(gs.players[sid]["max_hp"], 31.0)
        self.assertEqual(gs.players[sid]["hp"], 7.0)

    def test_in_combat_explicit_current_hp_is_respected_and_clamped(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "role": "player", "hp": 7.0, "max_hp": 20.0}
        gs.client_roles[sid] = "player"
        gs.world_state["combat"]["state"]["inCombat"] = True

        self._call_stats(sid, {"maxHp": 31, "currentHp": 99, "ac": 15})

        self.assertEqual(gs.players[sid]["max_hp"], 31.0)
        self.assertEqual(gs.players[sid]["hp"], 31.0)

    def test_missing_max_hp_does_not_overwrite_existing_hp(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "role": "player", "hp": 12.0, "max_hp": 20.0}
        gs.client_roles[sid] = "player"

        self._call_stats(sid, {"ac": 15})

        self.assertEqual(gs.players[sid]["max_hp"], 20.0)
        self.assertEqual(gs.players[sid]["hp"], 12.0)


class PlayerSpawnHealthFrontendTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MAP3D_JS.read_text(encoding='utf-8')

    def test_local_profile_sync_starts_full_out_of_combat(self) -> None:
        self.assertIn("const inCombatNow = currentGameMode === GAME_MODE.COMBAT || combatState.inCombat;", self.source)
        self.assertIn("if (nextMaxHp !== null && !inCombatNow) {", self.source)
        self.assertIn("playerState.hp = nextMaxHp;", self.source)

    def test_local_profile_sync_only_uses_current_hp_as_combat_fallback(self) -> None:
        self.assertIn("} else if (nextCurrentHp !== null) {", self.source)
        self.assertIn("playerState.hp = nextCurrentHp;", self.source)

    def test_stats_ack_resets_hp_to_max_out_of_combat(self) -> None:
        # The ack handler must check inCombatNow and always set hp=maxHp when not in combat.
        self.assertIn(
            "if (!inCombatNow || !Number.isFinite(Number(playerState.hp)) || Number(playerState.hp) > playerState.maxHp)",
            self.source,
        )

    def test_safe_spawn_reset_restores_full_hp(self) -> None:
        idx = self.source.index("function resetPlayerToSafeSpawn()")
        spawn_block = self.source[idx:idx + 500]
        self.assertIn("playerState.hp = playerState.maxHp;", spawn_block)


if __name__ == '__main__':
    unittest.main()