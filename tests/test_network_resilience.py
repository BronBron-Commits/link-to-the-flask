import unittest
from unittest.mock import patch

import action_handler
import connection_manager
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


class _FakeRequest:
    def __init__(self, sid: str):
        self.sid = sid
        self.args = {}


def _patched_connect(request_obj: _FakeRequest):
    original_request = connection_manager.request
    connection_manager.request = request_obj
    return original_request


class NetworkResilienceTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_server_state()

    def _setup_combat(self) -> tuple[str, str]:
        p1 = "p1"
        p2 = "p2"
        gs.players[p1] = {
            "id": p1,
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [{"instanceId": "inv_ls", "itemId": "longsword", "qty": 1, "equipped": True}]
            },
        }
        gs.players[p2] = {"id": p2, "actorId": "player_2", "role": "player"}
        gs.client_roles[p1] = "player"
        gs.client_roles[p2] = "player"
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "ac": 10, "hp": 50, "maxHp": 50}
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

    def _deliver_with_schedule(self, scheduled_actions: list[dict]) -> None:
        # Fake network delivery: actions are applied in delivery-time order.
        for packet in sorted(scheduled_actions, key=lambda row: int(row.get("delayMs", 0))):
            action_handler.handle_combat_action(packet["sid"], packet["payload"])

    def _connect_with_request(self, sid: str, payload=None, query_args=None) -> None:
        request_obj = _FakeRequest(sid)
        if isinstance(query_args, dict):
            request_obj.args.update(query_args)
        original_request = _patched_connect(request_obj)
        try:
            with patch("connection_manager.emit"), \
                patch("connection_manager.socketio.emit"), \
                patch("connection_manager.emit_world_to"), \
                patch("connection_manager.emit_combat_state_to"), \
                patch("connection_manager.emit_combat_turn_to"), \
                patch("connection_manager.broadcast_world"), \
                patch("connection_manager.broadcast_lobby"):
                connection_manager.on_connect(payload)
        finally:
            connection_manager.request = original_request

    @patch("action_handler.emit")
    def test_late_attack_rejected(self, emit_mock) -> None:
        p1, _ = self._setup_combat()
        gs.world_state["combat"]["turn"] = 1

        action_handler.handle_combat_action(p1, {"type": "attack", "targetId": "enemy_1"})

        emit_mock.assert_called_with("combat-action-denied", {"reason": "not-your-turn"})
        self.assertEqual(gs.world_state["entities"]["enemy_1"]["hp"], 50)

    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_duplicate_action_not_applied_twice(self, randint_mock, emit_mock, socket_emit_mock) -> None:
        p1, _ = self._setup_combat()
        action = {"id": "action_123", "type": "attack", "targetId": "enemy_1"}
        randint_mock.side_effect = [14, 5, 14, 5]

        action_handler.handle_combat_action(p1, action)
        action_handler.handle_combat_action(p1, action)

        self.assertEqual(gs.world_state["entities"]["enemy_1"]["hp"], 45)
        event_names = [call.args[0] for call in socket_emit_mock.call_args_list]
        self.assertEqual(event_names.count("combat-action-result"), 1)
        emit_mock.assert_called_with("combat-action-denied", {"reason": "duplicate-action", "id": "action_123"})

    @patch("action_handler.emit")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.random.randint")
    def test_out_of_order_actions_do_not_corrupt_state(self, randint_mock, socket_emit_mock, emit_mock) -> None:
        p1, p2 = self._setup_combat()
        randint_mock.side_effect = [16, 4]

        self._deliver_with_schedule(
            [
                {"delayMs": 0, "sid": p2, "payload": {"type": "attack", "targetId": "enemy_1", "seq": 2}},
                {"delayMs": 50, "sid": p1, "payload": {"type": "attack", "targetId": "enemy_1", "seq": 1}},
            ]
        )

        self.assertEqual(gs.world_state["entities"]["enemy_1"]["hp"], 46)
        emit_mock.assert_called_with("combat-action-denied", {"reason": "not-your-turn"})
        event_names = [call.args[0] for call in socket_emit_mock.call_args_list]
        self.assertIn("combat-action-result", event_names)
        self.assertEqual(event_names.count("combat-action-result"), 1)

    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_disconnect_during_action_does_not_break_state(self, randint_mock, emit_mock) -> None:
        p1, _ = self._setup_combat()
        randint_mock.side_effect = [17, 5]

        action_handler.handle_combat_action(p1, {"type": "attack", "targetId": "enemy_1"})
        hp_after_first = gs.world_state["entities"]["enemy_1"]["hp"]

        gs.players.pop(p1, None)
        gs.client_roles.pop(p1, None)
        action_handler.handle_combat_action(p1, {"type": "attack", "targetId": "enemy_1"})

        self.assertEqual(gs.world_state["entities"]["enemy_1"]["hp"], hp_after_first)
        emit_mock.assert_called_with("combat-action-denied", {"reason": "player-not-registered"})

    def test_reconnect_restores_authoritative_inventory(self) -> None:
        old_sid = "p_old"
        resume_key = "resume_123"
        gs.players[old_sid] = {
            "id": old_sid,
            "role": "player",
            "actorId": "player_1",
            "inventory": {
                "items": [
                    {"instanceId": "inv_pot", "itemId": "health_potion", "qty": 2, "equipped": False}
                ]
            },
        }
        gs.client_roles[old_sid] = "player"
        gs.client_resume_keys[old_sid] = resume_key
        gs.save_resume_snapshot(old_sid)

        self._connect_with_request("p_reconnect", {"resumeKey": resume_key})

        self.assertNotIn(old_sid, gs.players)
        self.assertIn("p_reconnect", gs.players)
        restored_items = gs.players["p_reconnect"].get("inventory", {}).get("items", [])
        self.assertEqual(len(restored_items), 1)
        self.assertEqual(restored_items[0]["itemId"], "health_potion")
        self.assertEqual(restored_items[0]["qty"], 2)

    def test_reconnect_repoints_live_combat_turn_ownership(self) -> None:
        old_sid = "p_old"
        new_sid = "p_new"
        resume_key = "resume_combat"
        gs.players[old_sid] = {
            "id": old_sid,
            "role": "player",
            "actorId": "player_1",
            "inventory": {"items": []},
        }
        gs.client_roles[old_sid] = "player"
        gs.client_resume_keys[old_sid] = resume_key
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": old_sid}],
            "state": {"inCombat": True, "roundNumber": 2},
        }
        gs.save_resume_snapshot(old_sid)

        self._connect_with_request(new_sid, {"resumeKey": resume_key})

        self.assertEqual(gs.world_state["combat"]["order"][0]["ownerSid"], new_sid)
        self.assertNotIn(old_sid, gs.players)
        self.assertIn(new_sid, gs.players)

    def test_fresh_second_connection_without_resume_key_keeps_first_client(self) -> None:
        existing_sid = "p_existing"
        gs.players[existing_sid] = {
            "id": existing_sid,
            "role": "player",
            "actorId": "player_1",
            "inventory": {"items": []},
        }
        gs.client_roles[existing_sid] = "player"

        self._connect_with_request("p_second")

        self.assertIn(existing_sid, gs.players)
        self.assertIn("p_second", gs.players)
        self.assertNotEqual(gs.players[existing_sid]["id"], gs.players["p_second"]["id"])

    def test_expired_resume_key_is_ignored_instead_of_evicting_live_player(self) -> None:
        old_sid = "p_old"
        new_sid = "p_new"
        resume_key = "resume_expired"
        gs.players[old_sid] = {
            "id": old_sid,
            "role": "player",
            "actorId": "player_1",
            "inventory": {"items": []},
        }
        gs.client_roles[old_sid] = "player"
        gs.resume_sessions[resume_key] = {
            "sid": old_sid,
            "role": "player",
            "slotIndex": None,
            "inventory": {"items": []},
            "expiresAt": -1,
        }

        self._connect_with_request(new_sid, {"resumeKey": resume_key})

        self.assertIn(old_sid, gs.players)
        self.assertIn(new_sid, gs.players)
        self.assertEqual(gs.resume_sessions[resume_key]["sid"], new_sid)

    def test_resume_key_can_restore_from_query_args(self) -> None:
        old_sid = "p_old"
        resume_key = "resume_query"
        gs.players[old_sid] = {
            "id": old_sid,
            "role": "player",
            "actorId": "player_1",
            "inventory": {"items": [{"instanceId": "inv_1", "itemId": "torch", "qty": 1}]},
        }
        gs.client_roles[old_sid] = "player"
        gs.client_resume_keys[old_sid] = resume_key
        gs.save_resume_snapshot(old_sid)

        self._connect_with_request("p_query", payload=None, query_args={"resumeKey": resume_key})

        self.assertNotIn(old_sid, gs.players)
        self.assertEqual(gs.players["p_query"]["inventory"]["items"][0]["itemId"], "torch")

    def test_invalid_resume_key_is_sanitized_to_none(self) -> None:
        self._connect_with_request("p_bad", {"resumeKey": "!!!@@@###"})

        self.assertNotIn("p_bad", gs.client_resume_keys)
        self.assertIn("p_bad", gs.players)

    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_action_spam_keeps_state_valid(self, randint_mock, emit_mock) -> None:
        p1, _ = self._setup_combat()
        randint_mock.side_effect = [18, 2] * 100

        for _ in range(100):
            action_handler.handle_combat_action(p1, {"type": "attack", "targetId": "enemy_1"})

        hp = gs.world_state["entities"]["enemy_1"]["hp"]
        self.assertGreaterEqual(hp, 0.0)
        self.assertLessEqual(hp, 50.0)

    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_action_spam_rate_limited(self, randint_mock, emit_mock) -> None:
        p1, _ = self._setup_combat()
        randint_mock.side_effect = [18, 2] * 100

        for _ in range(100):
            action_handler.handle_combat_action(p1, {"id": f"a_{_}", "type": "attack", "targetId": "enemy_1"})

        self.assertGreater(gs.world_state["entities"]["enemy_1"]["hp"], 0.0)
        denied_reasons = [call.args[1].get("reason") for call in emit_mock.call_args_list if len(call.args) >= 2]
        self.assertIn("rate-limited", denied_reasons)


if __name__ == "__main__":
    unittest.main()