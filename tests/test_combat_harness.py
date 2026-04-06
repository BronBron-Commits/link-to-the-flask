import tempfile
import unittest
from pathlib import Path

import combat_harness
import game_state as gs


class CombatHarnessTests(unittest.TestCase):
    def _initial_state(self) -> dict:
        return {
            "players": {
                "p1": {
                    "id": "p1",
                    "actorId": "player_1",
                    "role": "player",
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
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
            },
            "client_roles": {"p1": "player"},
            "world_state": {
                "players": {},
                "entities": {
                    "enemy_1": {
                        "id": "enemy_1",
                        "networkId": "enemy_1",
                        "type": "enemy",
                        "name": "Dummy",
                        "position": {"x": 3.0, "y": 0.0, "z": 0.0},
                        "hp": 40.0,
                        "maxHp": 40.0,
                        "ac": 10,
                        "attackBonus": 1,
                        "damageRoll": 4,
                        "damageBonus": 0,
                    }
                },
                "mode": "combat",
                "combat": {
                    "turn": 0,
                    "order": [
                        {"id": "player_1", "type": "player", "ownerSid": "p1"},
                        {"id": "enemy_1", "type": "enemy"},
                    ],
                    "state": {"inCombat": True, "roundNumber": 1},
                },
                "scene": {"objects": []},
            },
        }

    def _scripted_provider(self):
        scripted = [
            {"type": "attack", "targetId": "enemy_1"},
            {"type": "move"},
            {"type": "attack", "targetId": "enemy_1"},
        ]
        idx = {"value": 0}

        def _next_action(state: dict, actor: dict, rng, step: int) -> dict:
            _ = (state, actor, rng, step)
            pos = idx["value"]
            idx["value"] += 1
            if pos < len(scripted):
                return dict(scripted[pos])
            return {"type": "dodge"}

        return _next_action

    def test_run_combat_is_deterministic(self) -> None:
        initial = self._initial_state()

        run1 = combat_harness.run_combat(initial, self._scripted_provider(), seed=123, max_steps=8)
        run2 = combat_harness.run_combat(initial, self._scripted_provider(), seed=123, max_steps=8)

        self.assertEqual(run1["finalHash"], run2["finalHash"])
        self.assertEqual(run1["timeline"], run2["timeline"])

    def test_timeline_contains_step_visibility(self) -> None:
        initial = self._initial_state()
        result = combat_harness.run_combat(initial, self._scripted_provider(), seed=42, max_steps=5)

        self.assertGreater(result["steps"], 0)
        first = result["timeline"][0]
        self.assertIn("actor", first)
        self.assertIn("action", first)
        self.assertIn("diff", first)
        self.assertIn("events", first)
        self.assertIn("stepIndex", first)
        self.assertIn("actionId", first)
        self.assertIn("stateHashBefore", first)
        self.assertIn("stateHash", first)
        self.assertIn("stepRecord", first)
        self.assertEqual(first["stepIndex"], first["step"])

        record = first["stepRecord"]
        self.assertEqual(record["stepIndex"], first["step"])
        self.assertEqual(record["actionId"], first["actionId"])
        self.assertIn("stateHashAfter", record)
        self.assertIn("stateDiff", record)
        self.assertIsInstance(record["stateDiff"], dict)
        pretty = combat_harness.format_timeline_step(first)
        self.assertIn("[STEP", pretty)
        self.assertIn("actionId=", pretty)

    def test_save_combat_log_writes_json(self) -> None:
        initial = self._initial_state()
        result = combat_harness.run_combat(initial, self._scripted_provider(), seed=99, max_steps=4)

        with tempfile.TemporaryDirectory() as temp_dir:
            out_path = Path(temp_dir) / "combat_log.json"
            combat_harness.save_combat_log(out_path, result)
            loaded = gs.deserialize_state(out_path.read_text(encoding="utf-8"))

        self.assertEqual(loaded.get("finalHash"), result["finalHash"])
        self.assertEqual(loaded.get("steps"), result["steps"])

    def test_round_progression_is_monotonic_within_run(self) -> None:
        initial = self._initial_state()
        result = combat_harness.run_combat(initial, self._scripted_provider(), seed=123, max_steps=10)

        rounds = [
            int((step.get("stepRecord") or {}).get("round", 1))
            for step in result.get("timeline", [])
            if isinstance(step, dict)
        ]
        for idx in range(1, len(rounds)):
            self.assertGreaterEqual(rounds[idx], rounds[idx - 1])

    def test_combat_finished_flag_true_when_enemy_defeated(self) -> None:
        initial = self._initial_state()
        initial["world_state"]["entities"]["enemy_1"]["hp"] = 4.0
        initial["world_state"]["entities"]["enemy_1"]["maxHp"] = 4.0

        def always_attack(state: dict, actor: dict, rng, step: int) -> dict:
            _ = (state, actor, rng, step)
            return {"type": "attack", "targetId": "enemy_1"}

        result = combat_harness.run_combat(initial, always_attack, seed=7, max_steps=20)

        self.assertTrue(result.get("combatFinished"))
        self.assertEqual(result.get("stopReason"), "combat-finished")


if __name__ == "__main__":
    unittest.main()
