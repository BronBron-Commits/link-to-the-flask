import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import action_handler
import event_log
import game_state as gs


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


class PersistenceAndStabilityTests(unittest.TestCase):
    def _seeded_randint(self, seed: int):
        rng = __import__("random").Random(seed)

        def _randint(a: int, b: int) -> int:
            return rng.randint(a, b)

        return _randint

    def _setup_combat(self, enemy_hp: float = 200.0) -> None:
        gs.players["p1"] = {
            "id": "p1",
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [
                    {
                        "instanceId": "inv_ls",
                        "itemId": "longsword",
                        "qty": 1,
                        "equipped": True,
                    }
                ]
            },
        }
        gs.client_roles["p1"] = "player"
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "ac": 10, "hp": enemy_hp, "maxHp": enemy_hp}
        }
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": "p1"}],
            "state": {"inCombat": True, "roundNumber": 1},
        }

    def _run_actions(self, seed: int, actions: list[dict], enemy_hp: float = 200.0) -> dict:
        reset_server_state()
        self._setup_combat(enemy_hp=enemy_hp)
        with patch("action_handler.emit"), patch("action_handler.socketio.emit"), patch(
            "action_handler.broadcast_world"
        ), patch("action_handler.random.randint", side_effect=self._seeded_randint(seed)):
            for index, row in enumerate(actions):
                # Advance synthetic time so rate-limit windows roll during soak/replay.
                now = float(index) * 0.2
                with patch("game_state.perf_counter", return_value=now):
                    action_handler.handle_combat_action(row["sid"], row["payload"])

        return {
            "state": gs.deserialize_state(gs.serialize_state(gs.world_state)),
            "stateHash": gs.hash_state(gs.world_state),
        }

    def test_persisted_event_log_replay_matches_expected_state(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": "a1", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "a2", "type": "move"}},
            {"sid": "p1", "payload": {"id": "a3", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "a4", "type": "attack", "targetId": "enemy_1"}},
        ]

        with tempfile.TemporaryDirectory() as tmp_dir:
            log_path = Path(tmp_dir) / "match_log.json"
            event_log.write_event_log(log_path, seed=123, actions=actions)
            replayed = event_log.replay_event_log(log_path, self._run_actions)
            expected = self._run_actions(seed=123, actions=actions)

        self.assertEqual(replayed, expected)

    def test_state_hash_detects_convergence(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": f"h{idx}", "type": "attack", "targetId": "enemy_1"}}
            for idx in range(12)
        ]

        server_result = self._run_actions(seed=77, actions=actions)
        client_result = self._run_actions(seed=77, actions=actions)

        self.assertEqual(server_result["stateHash"], client_result["stateHash"])
        self.assertEqual(server_result["state"], client_result["state"])

    def test_1000_turns_stability(self) -> None:
        actions = [
            {
                "sid": "p1",
                "payload": {
                    "id": f"soak_{idx}",
                    "type": "attack" if idx % 3 else "move",
                    "targetId": "enemy_1",
                },
            }
            for idx in range(1000)
        ]

        result = self._run_actions(seed=999, actions=actions, enemy_hp=5000.0)
        state = result["state"]
        enemy = state.get("entities", {}).get("enemy_1", {})

        self.assertIn("combat", state)
        self.assertGreaterEqual(float(enemy.get("hp", 0.0)), 0.0)
        self.assertLessEqual(float(enemy.get("hp", 0.0)), 5000.0)
        self.assertEqual(state.get("combat", {}).get("turn"), 0)

    def test_save_load_integrity(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": "s1", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "s2", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "s3", "type": "move"}},
        ]

        result = self._run_actions(seed=17, actions=actions)
        serialized = gs.serialize_state(result["state"])
        loaded = gs.deserialize_state(serialized)

        self.assertEqual(loaded, result["state"])
        self.assertEqual(gs.hash_state(loaded), gs.hash_state(result["state"]))


if __name__ == "__main__":
    unittest.main()
