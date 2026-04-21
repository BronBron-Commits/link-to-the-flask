import random
import unittest
from unittest.mock import patch

import action_handler
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


class DeterminismReplayTests(unittest.TestCase):
    def _setup_combat(self, enemy_hp: float = 120.0) -> tuple[str, str]:
        p1 = "p1"
        p2 = "p2"
        gs.players[p1] = {
            "id": p1,
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
        gs.players[p2] = {
            "id": p2,
            "actorId": "player_2",
            "role": "player",
            "inventory": {
                "items": [
                    {
                        "instanceId": "inv_j",
                        "itemId": "javelin",
                        "qty": 1,
                        "equipped": True,
                    }
                ]
            },
        }
        gs.client_roles[p1] = "player"
        gs.client_roles[p2] = "player"
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "ac": 10, "hp": enemy_hp, "maxHp": enemy_hp}
        }
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [
                {"id": "player_1", "type": "player", "ownerSid": p1},
                {"id": "player_2", "type": "player", "ownerSid": p2},
            ],
            "state": {"inCombat": True, "roundNumber": 1},
        }
        return p1, p2

    def _seeded_randint(self, seed: int):
        rng = random.Random(seed)

        def _randint(a: int, b: int) -> int:
            return rng.randint(a, b)

        return _randint

    def _snapshot_state(self) -> dict:
        enemy = gs.world_state.get("entities", {}).get("enemy_1", {})
        combat = gs.world_state.get("combat", {})
        return {
            "enemyHp": float(enemy.get("hp", 0.0)),
            "turn": combat.get("turn"),
            "order": [
                {
                    "id": row.get("id"),
                    "type": row.get("type"),
                    "ownerSid": row.get("ownerSid"),
                }
                for row in (combat.get("order") or [])
                if isinstance(row, dict)
            ],
            "recentActionBuckets": {
                sid: sorted(list(bucket.keys()))
                for sid, bucket in gs.recent_combat_action_ids.items()
                if isinstance(bucket, dict)
            },
        }

    def _run_actions(self, actions: list[dict], seed: int, enemy_hp: float = 120.0) -> tuple[dict, list[dict], list[dict]]:
        reset_server_state()
        self._setup_combat(enemy_hp=enemy_hp)
        with patch("action_handler.emit") as emit_mock, patch("action_handler.socketio.emit") as socket_emit_mock, patch(
            "action_handler.broadcast_world"
        ), patch("action_handler.random.randint", side_effect=self._seeded_randint(seed)):
            for action in actions:
                action_handler.handle_combat_action(action["sid"], action["payload"])

            combat_results = [
                call.args[1]
                for call in socket_emit_mock.call_args_list
                if call.args and call.args[0] == "combat-action-result"
            ]
            denies = [
                call.args[1]
                for call in emit_mock.call_args_list
                if call.args and call.args[0] == "combat-action-denied"
            ]

        return self._snapshot_state(), combat_results, denies

    def test_full_sequence_determinism(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": "a1", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "a2", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p2", "payload": {"id": "a3", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "a4", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "a5", "type": "move"}},
        ]

        result1, events1, denies1 = self._run_actions(actions, seed=123)
        result2, events2, denies2 = self._run_actions(actions, seed=123)

        self.assertEqual(result1, result2)
        self.assertEqual(events1, events2)
        self.assertEqual(denies1, denies2)

    def test_replay_matches_live_execution(self) -> None:
        recorded_actions = [
            {"sid": "p1", "payload": {"id": "live_1", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "live_2", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "live_2", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p2", "payload": {"id": "live_3", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "live_4", "type": "attack", "targetId": "enemy_1"}},
        ]

        live_state, live_events, live_denies = self._run_actions(recorded_actions, seed=777)
        replay_state, replay_events, replay_denies = self._run_actions(recorded_actions, seed=777)

        self.assertEqual(live_state, replay_state)
        self.assertEqual(live_events, replay_events)
        self.assertEqual(live_denies, replay_denies)

    def test_client_state_convergence(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": "c1", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "c2", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p2", "payload": {"id": "c3", "type": "attack", "targetId": "enemy_1"}},
            {"sid": "p1", "payload": {"id": "c4", "type": "move"}},
        ]

        server_state, _, _ = self._run_actions(actions, seed=91)
        client_a_state, _, _ = self._run_actions(actions, seed=91)
        client_b_state, _, _ = self._run_actions(actions, seed=91)

        self.assertEqual(client_a_state, server_state)
        self.assertEqual(client_b_state, server_state)

    def test_spam_partial_acceptance_is_consistent(self) -> None:
        actions = [
            {"sid": "p1", "payload": {"id": f"spam_{idx}", "type": "attack", "targetId": "enemy_1"}}
            for idx in range(100)
        ]

        state, events, denies = self._run_actions(actions, seed=42)

        self.assertLessEqual(len(events), gs.COMBAT_ACTION_RATE_MAX)
        self.assertGreater(len(events), 0)
        self.assertGreater(len(denies), 0)
        self.assertEqual(state["turn"], 0)

        total_damage = sum(int(evt.get("damage", 0)) for evt in events)
        self.assertEqual(state["enemyHp"], 120.0 - float(total_damage))

    def test_randomized_network_conditions(self) -> None:
        rng = random.Random(2026)
        base_actions = [
            {"sid": "p1", "payload": {"id": f"net_{idx}", "type": "attack", "targetId": "enemy_1"}}
            for idx in range(10)
        ]

        shuffled = list(base_actions)
        rng.shuffle(shuffled)

        noisy_actions: list[dict] = []
        for action in shuffled:
            noisy_actions.append(action)
            if rng.random() < 0.35:
                noisy_actions.append({"sid": action["sid"], "payload": dict(action["payload"])})
            if rng.random() < 0.25:
                noisy_actions.append(
                    {
                        "sid": "p2",
                        "payload": {
                            "id": f"p2_{action['payload']['id']}",
                            "type": "attack",
                            "targetId": "enemy_1",
                        },
                    }
                )

        state, events, denies = self._run_actions(noisy_actions, seed=2026)

        self.assertGreaterEqual(state["enemyHp"], 0.0)
        self.assertLessEqual(state["enemyHp"], 120.0)
        self.assertEqual(state["turn"], 0)

        total_damage = sum(int(evt.get("damage", 0)) for evt in events)
        self.assertEqual(state["enemyHp"], 120.0 - float(total_damage))

        deny_reasons = {payload.get("reason") for payload in denies if isinstance(payload, dict)}
        self.assertTrue({"duplicate-action", "not-your-turn", "rate-limited"}.intersection(deny_reasons))


if __name__ == "__main__":
    unittest.main()
