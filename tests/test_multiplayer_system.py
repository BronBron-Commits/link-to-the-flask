import unittest
from unittest.mock import MagicMock, patch

import action_handler
import game_state as gs
import state_sync
import turn_manager


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


class MultiplayerSystemTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_server_state()

    def test_normalize_inventory_contract_sanitizes_entries(self) -> None:
        raw_inventory = {
            "capacity": "210 lb.",
            "weight": None,
            "items": [
                {"instanceId": "inv_a", "itemId": "Longsword", "qty": "2", "equipped": 1},
                {"instanceId": "inv_bad", "itemId": "", "qty": "1"},
            ],
        }

        normalized = gs.normalize_inventory_contract(raw_inventory)

        self.assertEqual(normalized["capacity"], 210)
        self.assertEqual(len(normalized["items"]), 1)
        self.assertEqual(normalized["items"][0]["itemId"], "longsword")
        self.assertEqual(normalized["items"][0]["qty"], 2)

    def test_resolve_equipped_weapon_auto_falls_back_to_inventory_weapon(self) -> None:
        entry = {
            "inventory": {
                "items": [
                    {"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": False}
                ]
            }
        }

        weapon = gs.resolve_equipped_weapon(entry)

        self.assertEqual(weapon["itemId"], "longsword")
        self.assertEqual(weapon["damageRoll"], 8)
        self.assertTrue(entry["inventory"]["items"][0]["equipped"])

    def test_set_player_inventory_applies_equipped_weapon_stats(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid}

        ok = gs.set_player_inventory(
            sid,
            {
                "items": [
                    {"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": True}
                ]
            },
        )

        self.assertTrue(ok)
        self.assertEqual(gs.players[sid]["attackBonus"], 0)
        self.assertEqual(gs.players[sid]["damageRoll"], 8)
        self.assertEqual(gs.players[sid]["equipped_weapon"]["itemId"], "longsword")

    def test_apply_inventory_from_engine_entity_hydrates_player_inventory(self) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid}
        engine_entity = {
            "inventory": {
                "capacity": 210,
                "weight": 105,
                "items": [
                    {"instanceId": "inv_001", "itemId": "javelin", "qty": 2, "equipped": True}
                ],
            }
        }

        ok = gs.apply_inventory_from_engine_entity(sid, engine_entity)

        self.assertTrue(ok)
        self.assertEqual(gs.players[sid]["inventory"]["capacity"], 210)
        self.assertEqual(gs.players[sid]["equipped_weapon"]["itemId"], "javelin")

    def test_resolve_equipped_weapon_returns_unarmed_when_no_inventory(self) -> None:
        weapon = gs.resolve_equipped_weapon({"inventory": {"items": []}})

        self.assertEqual(weapon["itemId"], "unarmed_strike")
        self.assertEqual(weapon["damageRoll"], 3)

    def test_normalize_movement_capabilities_defaults_to_enabled(self) -> None:
        caps = gs.normalize_movement_capabilities(None)
        self.assertTrue(caps["can_dash"])
        self.assertTrue(caps["can_disengage"])
        self.assertTrue(caps["can_dodge"])

    @patch("action_handler.emit")
    def test_handle_combat_action_preview_emits_authoritative_attack_preview(self, emit_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [
                    {"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": True}
                ]
            },
        }
        gs.client_roles[sid] = "player"
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": sid}],
            "state": {"inCombat": True},
        }
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "ac": 10, "hp": 20, "maxHp": 20}
        }

        action_handler.handle_combat_action_preview(sid, {"requestId": "preview_1", "type": "attack", "targetId": "enemy_1"})

        emit_mock.assert_called_once()
        event_name, payload = emit_mock.call_args.args[:2]
        self.assertEqual(event_name, "combat-action-preview")
        self.assertEqual(payload["requestId"], "preview_1")
        self.assertEqual(payload["targetId"], "enemy_1")
        self.assertEqual(payload["type"], "attack")
        self.assertIn("preview", payload)
        self.assertGreaterEqual(payload["preview"]["hitChancePct"], 0)
        self.assertGreater(payload["preview"]["damageMax"], 0)
        self.assertEqual(emit_mock.call_args.kwargs.get("to"), sid)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    @patch("action_handler.advance_and_resolve")
    def test_handle_end_turn_advances_for_current_player(self, advance_mock, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "actorId": "player_1", "role": "player"}
        gs.client_roles[sid] = "player"
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": sid}],
            "state": {"inCombat": True, "roundNumber": 1},
        }
        advance_mock.return_value = {
            "turnIndex": 0,
            "order": gs.world_state["combat"]["order"],
            "roundNumber": 1,
            "currentActor": gs.world_state["combat"]["order"][0],
        }

        result = action_handler.handle_end_turn(sid, {})

        self.assertTrue(result["ok"])
        socket_emit_mock.assert_called_with("combat-turn", advance_mock.return_value)
        broadcast_mock.assert_called_once_with(include_scene=False)
        emit_mock.assert_any_call("end-turn-accepted", {"reason": "received"}, to=sid)

    @patch("action_handler.emit")
    def test_handle_end_turn_denies_unregistered_player(self, emit_mock) -> None:
        result = action_handler.handle_end_turn("missing", {})

        self.assertFalse(result["ok"])
        self.assertEqual(result["reason"], "player-not-registered")
        emit_mock.assert_any_call("end-turn-denied", {"reason": "player-not-registered"}, to="missing")

    @patch("action_handler.emit")
    def test_handle_combat_action_denies_when_not_players_turn(self, emit_mock) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "actorId": "player_1", "role": "player"}
        gs.players["p2"] = {"id": "p2", "actorId": "player_2", "role": "player"}
        gs.client_roles[sid] = "player"
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_2", "type": "player", "ownerSid": "p2"}],
            "state": {"inCombat": True},
        }

        action_handler.handle_combat_action(sid, {"type": "attack", "targetId": "enemy_1"})

        emit_mock.assert_called_with("combat-action-denied", {"reason": "not-your-turn"})

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_handle_combat_action_attack_uses_equipped_weapon(self, randint_mock, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [
                    {"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": True}
                ]
            },
        }
        gs.client_roles[sid] = "player"
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": sid}],
            "state": {"inCombat": True},
        }
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "ac": 10, "hp": 20, "maxHp": 20}
        }

        # 15 to hit, then 6 damage on d8.
        randint_mock.side_effect = [15, 6]

        action_handler.handle_combat_action(sid, {"type": "attack", "targetId": "enemy_1"})

        payload = socket_emit_mock.call_args[0][1]
        self.assertEqual(socket_emit_mock.call_args[0][0], "combat-action-result")
        self.assertTrue(payload["hit"])
        self.assertEqual(payload["weapon"]["itemId"], "longsword")
        self.assertEqual(payload["damage"], 6)
        self.assertEqual(gs.world_state["entities"]["enemy_1"]["hp"], 14.0)
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_handle_combat_action_attack_ends_combat_when_last_enemy_downed(self, randint_mock, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [
                    {"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": True}
                ]
            },
        }
        gs.client_roles[sid] = "player"
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [{"id": "player_1", "type": "player", "ownerSid": sid}],
            "state": {"inCombat": True, "roundNumber": 2, "initiator": sid},
        }
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "name": "Dummy", "ac": 10, "hp": 4, "maxHp": 4, "attackBonus": 1, "damageRoll": 4, "damageBonus": 0}
        }

        randint_mock.side_effect = [15, 6]

        action_handler.handle_combat_action(sid, {"type": "attack", "targetId": "enemy_1"})

        emitted = [call.args[0] for call in socket_emit_mock.call_args_list]
        combat_ended_payload = next(call.args[1] for call in socket_emit_mock.call_args_list if call.args and call.args[0] == "combat-ended")

        self.assertIn("combat-action-result", emitted)
        self.assertIn("combat-ended", emitted)
        self.assertIn("combat-reset", emitted)
        self.assertEqual(combat_ended_payload["result"], "players_victorious")
        self.assertEqual(combat_ended_payload["winner"], "players")
        self.assertFalse(gs.world_state["combat"]["state"]["inCombat"])
        self.assertEqual(gs.world_state["mode"], "exploration")
        self.assertNotIn("enemy_1", gs.world_state["entities"])
        self.assertEqual(broadcast_mock.call_count, 0)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_equip_item_updates_weapon_stats(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "inventory": {
                "items": [
                    {"instanceId": "inv_1", "itemId": "shield", "qty": 1, "equipped": False, "slot": "off_hand"},
                    {"instanceId": "inv_2", "itemId": "longsword", "qty": 1, "equipped": False, "slot": "main_hand"},
                ]
            },
        }

        action_handler.handle_inventory_equip_item(sid, {"instanceId": "inv_2"})

        self.assertEqual(gs.players[sid]["equipped_weapon"]["itemId"], "longsword")
        self.assertEqual(gs.players[sid]["damageRoll"], 8)
        socket_emit_mock.assert_called()
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_use_item_consumes_potion_and_heals(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "hp": 5.0,
            "max_hp": 20.0,
            "inventory": {
                "items": [
                    {"instanceId": "inv_pot", "itemId": "health_potion", "qty": 1, "equipped": False}
                ]
            },
        }

        action_handler.handle_inventory_use_item(sid, {"instanceId": "inv_pot"})

        self.assertEqual(gs.players[sid]["hp"], 15.0)
        self.assertEqual(len(gs.players[sid]["inventory"]["items"]), 0)
        socket_emit_mock.assert_called()
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_use_item_denies_non_consumable(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "inventory": {
                "items": [
                    {"instanceId": "inv_ls", "itemId": "longsword", "qty": 1, "equipped": True}
                ]
            },
        }

        action_handler.handle_inventory_use_item(sid, {"instanceId": "inv_ls"})

        emit_mock.assert_called_with("inventory-error", {"reason": "item-not-usable"}, to=sid)
        socket_emit_mock.assert_not_called()
        broadcast_mock.assert_not_called()

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_equip_item_denies_missing_id(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {"id": sid, "inventory": {"items": []}}

        action_handler.handle_inventory_equip_item(sid, {})

        emit_mock.assert_called_with("inventory-error", {"reason": "missing-instance-id"}, to=sid)
        socket_emit_mock.assert_not_called()
        broadcast_mock.assert_not_called()

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_loot_item_requires_dm_or_dev(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        gs.players["player"] = {"id": "player", "inventory": {"items": []}}
        gs.client_roles["player"] = "player"

        action_handler.handle_inventory_loot_item(
            "player", {"targetSid": "player", "itemId": "longsword", "qty": 1}
        )

        emit_mock.assert_called_with("inventory-error", {"reason": "requires-dm-or-dev"}, to="player")
        socket_emit_mock.assert_not_called()
        broadcast_mock.assert_not_called()

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_loot_item_adds_item_for_dm(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        gs.players["dm"] = {"id": "dm"}
        gs.client_roles["dm"] = "dm"
        gs.players["player"] = {"id": "player", "inventory": {"items": []}}

        action_handler.handle_inventory_loot_item(
            "dm", {"targetSid": "player", "itemId": "health_potion", "qty": 2}
        )

        items = gs.players["player"]["inventory"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["itemId"], "health_potion")
        self.assertEqual(items[0]["qty"], 2)
        socket_emit_mock.assert_called()
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    def test_inventory_loot_item_stacks_stackable(self, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        gs.players["dm"] = {"id": "dm"}
        gs.client_roles["dm"] = "dm"
        gs.players["player"] = {
            "id": "player",
            "inventory": {
                "items": [
                    {"instanceId": "inv_pot", "itemId": "health_potion", "qty": 1, "equipped": False}
                ]
            },
        }

        action_handler.handle_inventory_loot_item(
            "dm", {"targetSid": "player", "itemId": "health_potion", "qty": 3}
        )

        items = gs.players["player"]["inventory"]["items"]
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["qty"], 4)
        socket_emit_mock.assert_called()
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("action_handler.broadcast_world")
    @patch("action_handler.socketio.emit")
    @patch("action_handler.emit")
    @patch("action_handler.random.randint")
    def test_attack_resolution_is_repeatable_with_same_random_rolls(self, randint_mock, emit_mock, socket_emit_mock, broadcast_mock) -> None:
        sid = "p1"
        gs.players[sid] = {
            "id": sid,
            "actorId": "player_1",
            "role": "player",
            "inventory": {
                "items": [{"instanceId": "inv_001", "itemId": "longsword", "qty": 1, "equipped": True}]
            },
        }
        gs.client_roles[sid] = "player"

        def run_once() -> tuple[dict, float]:
            gs.world_state["combat"] = {
                "turn": 0,
                "order": [{"id": "player_1", "type": "player", "ownerSid": sid}],
                "state": {"inCombat": True},
            }
            gs.world_state["entities"] = {"enemy_1": {"id": "enemy_1", "ac": 10, "hp": 20, "maxHp": 20}}
            socket_emit_mock.reset_mock()
            broadcast_mock.reset_mock()
            randint_mock.side_effect = [12, 5]
            action_handler.handle_combat_action(sid, {"type": "attack", "targetId": "enemy_1"})
            payload = socket_emit_mock.call_args[0][1]
            hp_after = gs.world_state["entities"]["enemy_1"]["hp"]
            return payload, hp_after

        first_payload, first_hp = run_once()
        second_payload, second_hp = run_once()

        self.assertEqual(first_payload["hitRoll"], second_payload["hitRoll"])
        self.assertEqual(first_payload["damage"], second_payload["damage"])
        self.assertEqual(first_payload["toHit"], second_payload["toHit"])
        self.assertEqual(first_hp, second_hp)

    def test_turn_manager_advance_turn_wraps_round(self) -> None:
        gs.world_state["combat"] = {
            "turn": 1,
            "order": [{"id": "a", "type": "player"}, {"id": "b", "type": "enemy"}],
            "state": {"roundNumber": 1},
        }

        result = turn_manager._advance_turn()

        self.assertEqual(result["turnIndex"], 0)
        self.assertEqual(result["roundNumber"], 2)

    @patch("turn_manager.run_enemy_turn")
    @patch("turn_manager.socketio.emit")
    def test_turn_manager_advance_and_resolve_skips_enemy_turn(self, socket_emit_mock, run_enemy_turn_mock) -> None:
        gs.players["p1"] = {"id": "p1", "actorId": "player_1", "role": "player", "hp": 20, "max_hp": 20}
        gs.world_state["entities"] = {
            "enemy_1": {"id": "enemy_1", "type": "enemy", "hp": 10, "maxHp": 10, "ac": 10, "attackBonus": 1, "damageRoll": 4, "damageBonus": 0}
        }
        gs.world_state["combat"] = {
            "turn": -1,
            "order": [
                {"id": "enemy_1", "type": "enemy"},
                {"id": "player_1", "type": "player", "ownerSid": "p1"},
            ],
            "state": {"roundNumber": 1},
        }

        result = turn_manager.advance_and_resolve()

        run_enemy_turn_mock.assert_called_once()
        self.assertEqual(result["currentActor"]["type"], "player")
        socket_emit_mock.assert_called()

    @patch("turn_manager.broadcast_world")
    @patch("turn_manager.socketio.emit")
    @patch("turn_manager.gevent.sleep")
    @patch("turn_manager.random.randint")
    def test_run_enemy_turn_ends_combat_when_last_player_is_downed(self, randint_mock, sleep_mock, socket_emit_mock, broadcast_mock) -> None:
        _ = sleep_mock
        gs.players["p1"] = {
            "id": "p1",
            "actorId": "player_1",
            "networkId": "player_1",
            "role": "player",
            "hp": 3.0,
            "max_hp": 20.0,
            "ac": 10,
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        }
        gs.client_roles["p1"] = "player"
        gs.world_state["entities"] = {
            "enemy_1": {
                "id": "enemy_1",
                "type": "enemy",
                "name": "Raider",
                "position": {"x": 0.0, "y": 0.0, "z": 4.0},
                "hp": 10.0,
                "maxHp": 10.0,
                "ac": 10,
                "attackBonus": 5,
                "damageRoll": 4,
                "damageBonus": 0,
            }
        }
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [
                {"id": "enemy_1", "type": "enemy"},
                {"id": "player_1", "type": "player", "ownerSid": "p1"},
            ],
            "state": {"inCombat": True, "roundNumber": 3, "initiator": "p1"},
        }

        randint_mock.side_effect = [15, 4]

        turn_manager.run_enemy_turn({"id": "enemy_1", "type": "enemy"})
        outcome = turn_manager.conclude_combat_if_needed("p1")

        emitted = [call.args[0] for call in socket_emit_mock.call_args_list]
        combat_ended_payload = next(call.args[1] for call in socket_emit_mock.call_args_list if call.args and call.args[0] == "combat-ended")

        self.assertEqual(outcome, "players_defeated")
        self.assertEqual(gs.players["p1"]["state"], "downed")
        self.assertEqual(gs.players["p1"]["hp"], 0.0)
        self.assertIn("combat-ended", emitted)
        self.assertIn("combat-reset", emitted)
        self.assertEqual(combat_ended_payload["result"], "players_defeated")
        self.assertEqual(combat_ended_payload["winner"], "enemies")
        self.assertFalse(gs.world_state["combat"]["state"]["inCombat"])
        self.assertEqual(gs.world_state["mode"], "exploration")
        broadcast_mock.assert_called_once_with(include_scene=False)

    @patch("turn_manager.reaction_system.trigger_reactions")
    @patch("turn_manager.socketio.emit")
    @patch("turn_manager.gevent.sleep")
    def test_run_enemy_turn_stops_when_last_enemy_is_downed_by_reaction(self, sleep_mock, socket_emit_mock, trigger_reactions_mock) -> None:
        gs.players["p1"] = {
            "id": "p1",
            "actorId": "player_1",
            "networkId": "player_1",
            "role": "player",
            "hp": 20.0,
            "max_hp": 20.0,
            "ac": 14,
            "position": {"x": 0.0, "y": 0.0, "z": 0.0},
        }
        gs.world_state["mode"] = "combat"
        gs.world_state["entities"] = {
            "enemy_1": {
                "id": "enemy_1",
                "networkId": "enemy_1",
                "type": "enemy",
                "name": "Runner",
                "position": {"x": 4.0, "y": 0.0, "z": 0.0},
                "hp": 2.0,
                "maxHp": 2.0,
                "ac": 10,
                "attackBonus": 5,
                "damageRoll": 4,
                "damageBonus": 0,
                "canDisengage": False,
            }
        }
        gs.world_state["combat"] = {
            "turn": 0,
            "order": [
                {"id": "enemy_1", "type": "enemy"},
                {"id": "player_1", "type": "player", "ownerSid": "p1"},
            ],
            "state": {"inCombat": True, "roundNumber": 1, "initiator": "p1"},
        }

        def _kill_enemy(*_args, **_kwargs):
            enemy = gs.world_state["entities"]["enemy_1"]
            enemy["hp"] = 0.0
            enemy["state"] = "downed"
            return [{"attacker": "player_1", "type": "opportunity-attack", "targetId": "enemy_1", "hit": True, "damage": 3}]

        trigger_reactions_mock.side_effect = _kill_enemy

        result = turn_manager.run_enemy_turn({"id": "enemy_1", "type": "enemy"})
        outcome = turn_manager.conclude_combat_if_needed("p1")

        emitted = [call.args[0] for call in socket_emit_mock.call_args_list]

        self.assertEqual(result["reason"], "downed-by-reaction")
        self.assertEqual(outcome, "players_victorious")
        self.assertIn("combat-ended", emitted)
        self.assertIn("combat-reset", emitted)
        self.assertFalse(gs.world_state["combat"]["state"]["inCombat"])
        self.assertEqual(gs.world_state["mode"], "exploration")
        self.assertNotIn("combat-action-result", emitted)

    @patch("state_sync.socketio.emit")
    @patch("state_sync.gs.build_world_payload")
    def test_state_sync_broadcast_world_uses_payload_builder(self, payload_mock, socket_emit_mock) -> None:
        payload_mock.return_value = {"ok": True, "scene": {}}

        state_sync.broadcast_world(include_scene=True)

        payload_mock.assert_called_once_with(include_scene=True)
        socket_emit_mock.assert_called_once_with("world-update", {"ok": True, "scene": {}})


if __name__ == "__main__":
    unittest.main()
