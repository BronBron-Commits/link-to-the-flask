import random
import unittest

import combat_harness


class MultiActorContentionTests(unittest.TestCase):
    def _initial_state(self) -> dict:
        return {
            "players": {
                "p1": {
                    "id": "p1",
                    "actorId": "player_1",
                    "role": "player",
                    "hp": 36.0,
                    "max_hp": 36.0,
                    "ac": 14,
                    "position": {"x": -2.0, "y": 0.0, "z": 0.0},
                    "inventory": {
                        "items": [
                            {"instanceId": "p1_ls", "itemId": "longsword", "qty": 1, "equipped": True}
                        ]
                    },
                },
                "p2": {
                    "id": "p2",
                    "actorId": "player_2",
                    "role": "player",
                    "hp": 30.0,
                    "max_hp": 30.0,
                    "ac": 13,
                    "position": {"x": 2.0, "y": 0.0, "z": 0.0},
                    "inventory": {
                        "items": [
                            {"instanceId": "p2_j", "itemId": "javelin", "qty": 1, "equipped": True}
                        ]
                    },
                },
            },
            "client_roles": {"p1": "player", "p2": "player"},
            "world_state": {
                "players": {},
                "entities": {
                    "enemy_1": {
                        "id": "enemy_1",
                        "networkId": "enemy_1",
                        "type": "enemy",
                        "name": "Raider",
                        "position": {"x": 1.0, "y": 0.0, "z": 5.0},
                        "hp": 42.0,
                        "maxHp": 42.0,
                        "ac": 11,
                        "attackBonus": 3,
                        "damageRoll": 6,
                        "damageBonus": 1,
                    },
                    "enemy_2": {
                        "id": "enemy_2",
                        "networkId": "enemy_2",
                        "type": "enemy",
                        "name": "Skirmisher",
                        "position": {"x": -1.0, "y": 0.0, "z": 5.0},
                        "hp": 34.0,
                        "maxHp": 34.0,
                        "ac": 12,
                        "attackBonus": 2,
                        "damageRoll": 4,
                        "damageBonus": 1,
                    },
                },
                "mode": "combat",
                "combat": {
                    "turn": 0,
                    "order": [
                        {"id": "player_1", "type": "player", "ownerSid": "p1"},
                        {"id": "enemy_1", "type": "enemy"},
                        {"id": "player_2", "type": "player", "ownerSid": "p2"},
                        {"id": "enemy_2", "type": "enemy"},
                    ],
                    "state": {"inCombat": True, "roundNumber": 1},
                },
                "scene": {"objects": []},
            },
        }

    def _aggressive_provider(self):
        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            _ = (actor, step)
            entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
            live_targets = [
                eid
                for eid, row in entities.items()
                if isinstance(row, dict)
                and str(row.get("type") or "").lower() == "enemy"
                and float(row.get("hp", 0)) > 0
            ]
            if not live_targets:
                return {"type": "dodge"}
            # Intentional contention: both players focus same target first.
            target_id = sorted(live_targets)[0]
            if rng.random() < 0.85:
                return {"type": "attack", "targetId": target_id}
            return {"type": "move"}

        return _provider

    def _chaos_provider(self, max_steps: int):
        chaos_trigger_step = max(4, int(max_steps * 0.35))
        memory = {"last_action_id": None}

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            actor_id = str(actor.get("id") or "player")
            action_id = f"mchaos_{step}_{actor_id}"
            entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
            live_targets = [
                eid
                for eid, row in entities.items()
                if isinstance(row, dict)
                and str(row.get("type") or "").lower() == "enemy"
                and float(row.get("hp", 0)) > 0
            ]
            target_id = live_targets[0] if live_targets else "enemy_1"

            if step >= chaos_trigger_step:
                p = rng.random()
                if p < 0.15 and memory["last_action_id"]:
                    return {"id": memory["last_action_id"], "type": "attack", "targetId": target_id}
                if p < 0.30:
                    memory["last_action_id"] = action_id
                    return {"id": action_id, "type": "teleport"}
                if p < 0.45:
                    memory["last_action_id"] = action_id
                    return {"id": action_id, "type": "attack"}
                if p < 0.60:
                    memory["last_action_id"] = action_id
                    return {"id": action_id, "type": "attack", "targetId": "enemy_UNKNOWN"}

            payload = {"id": action_id, "type": "attack", "targetId": target_id}
            memory["last_action_id"] = action_id
            return payload

        return _provider

    def test_multi_actor_determinism(self) -> None:
        initial = self._initial_state()
        provider = self._aggressive_provider()

        a = combat_harness.run_combat(initial, provider, seed=123, max_steps=60)
        b = combat_harness.run_combat(initial, provider, seed=123, max_steps=60)

        self.assertEqual(a["finalHash"], b["finalHash"])
        self.assertEqual(a["timeline"], b["timeline"])

    def test_no_actor_gets_double_turn_per_round(self) -> None:
        initial = self._initial_state()
        result = combat_harness.run_combat(initial, self._aggressive_provider(), seed=88, max_steps=40)

        seen: dict[int, set[str]] = {}
        for step in result.get("timeline", []):
            if not isinstance(step, dict):
                continue
            record = step.get("stepRecord") if isinstance(step.get("stepRecord"), dict) else {}
            actor = str(record.get("actor") or "")
            rnd = int(record.get("round") or 1)
            if not actor:
                continue
            bucket = seen.setdefault(rnd, set())
            self.assertNotIn(actor, bucket)
            bucket.add(actor)

    def test_dead_entities_do_not_act(self) -> None:
        initial = self._initial_state()
        initial["world_state"]["entities"]["enemy_1"]["hp"] = 6.0
        initial["world_state"]["entities"]["enemy_1"]["maxHp"] = 6.0

        result = combat_harness.run_combat(initial, self._aggressive_provider(), seed=42, max_steps=40)

        death_step = None
        for idx, step in enumerate(result.get("timeline", [])):
            if not isinstance(step, dict):
                continue
            diff = step.get("diff") if isinstance(step.get("diff"), dict) else {}
            change = (diff.get("entityHp") or {}).get("enemy_1") if isinstance(diff.get("entityHp"), dict) else None
            if isinstance(change, dict) and float(change.get("to", 1)) <= 0:
                death_step = idx
                break

        self.assertIsNotNone(death_step)
        for step in result.get("timeline", [])[int(death_step) + 1 :]:
            if not isinstance(step, dict):
                continue
            actor = str(((step.get("stepRecord") or {}).get("actor")) or "")
            self.assertNotEqual(actor, "enemy_1")

    def test_multiple_attacks_resolve_sequentially_on_shared_target(self) -> None:
        initial = self._initial_state()
        initial_enemy_hp = float(initial["world_state"]["entities"]["enemy_1"]["hp"])
        result = combat_harness.run_combat(initial, self._aggressive_provider(), seed=99, max_steps=12)

        player_damage = 0
        for step in result.get("timeline", []):
            if not isinstance(step, dict):
                continue
            record = step.get("stepRecord") if isinstance(step.get("stepRecord"), dict) else {}
            action = record.get("action") if isinstance(record.get("action"), dict) else {}
            if action.get("type") != "ATTACK":
                continue
            if record.get("actorType") != "player":
                continue
            if action.get("target") != "enemy_1":
                continue
            if record.get("result") != "applied":
                continue
            if bool(record.get("hit")):
                player_damage += int(record.get("damage") or 0)

        final_enemy_hp = float(result.get("finalState", {}).get("entities", {}).get("enemy_1", {}).get("hp", 0.0))
        self.assertAlmostEqual(final_enemy_hp, max(0.0, initial_enemy_hp - float(player_damage)))

    def test_multi_client_convergence(self) -> None:
        initial = self._initial_state()
        provider = self._aggressive_provider()

        server = combat_harness.run_combat(initial, provider, seed=777, max_steps=50)
        client_a = combat_harness.run_combat(initial, provider, seed=777, max_steps=50)
        client_b = combat_harness.run_combat(initial, provider, seed=777, max_steps=50)

        self.assertEqual(client_a["finalHash"], server["finalHash"])
        self.assertEqual(client_b["finalHash"], server["finalHash"])
        self.assertEqual(client_a["finalState"], server["finalState"])
        self.assertEqual(client_b["finalState"], server["finalState"])

    def test_multi_actor_chaos(self) -> None:
        initial = self._initial_state()
        max_steps = 80
        result = combat_harness.run_combat(
            initial,
            self._chaos_provider(max_steps),
            seed=2026,
            max_steps=max_steps,
            validate_invariants=True,
        )

        self.assertGreater(result.get("steps", 0), 0)
        self.assertIn(result.get("stopReason"), {"combat-finished", "max-steps-reached"})

        deny_counts: dict[str, int] = {}
        for step in result.get("timeline", []):
            if not isinstance(step, dict):
                continue
            reason = str(((step.get("stepRecord") or {}).get("denyReason")) or "").strip()
            if not reason:
                continue
            deny_counts[reason] = deny_counts.get(reason, 0) + 1

        self.assertTrue(any(reason in deny_counts for reason in ("duplicate-action", "unknown-action", "missing-target", "unknown-target")))

    def _reaction_initial_state(self) -> dict:
        state = self._initial_state()
        state["players"]["p1"]["position"] = {"x": 0.0, "y": 0.0, "z": 0.0}
        state["world_state"]["entities"]["enemy_1"]["position"] = {"x": 4.0, "y": 0.0, "z": 0.0}
        state["world_state"]["combat"]["order"] = [
            {"id": "player_1", "type": "player", "ownerSid": "p1"},
            {"id": "enemy_1", "type": "enemy"},
        ]
        state["world_state"]["combat"]["turn"] = 0
        return state

    def test_move_out_of_melee_triggers_opportunity_attack(self) -> None:
        initial = self._reaction_initial_state()

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            _ = (state, actor, rng)
            if step == 0:
                return {"id": "r_move_0", "type": "move", "position": {"x": 12.0, "y": 0.0, "z": 0.0}}
            return {"id": f"r_idle_{step}", "type": "dodge"}

        result = combat_harness.run_combat(initial, _provider, seed=31, max_steps=2)
        step0 = result.get("timeline", [])[0]
        self.assertIsInstance(step0, dict)
        events = step0.get("events") if isinstance(step0.get("events"), list) else []
        reaction_events = [
            e for e in events
            if isinstance(e, dict)
            and str(e.get("channel") or "") == "combat-reaction-result"
        ]
        self.assertGreaterEqual(len(reaction_events), 1)

    def test_disengage_move_prevents_opportunity_attack(self) -> None:
        initial = self._reaction_initial_state()

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            _ = (state, actor, rng)
            if step == 0:
                return {"id": "r_dis_0", "type": "disengage", "position": {"x": 12.0, "y": 0.0, "z": 0.0}}
            return {"id": f"r_idle_{step}", "type": "dodge"}

        result = combat_harness.run_combat(initial, _provider, seed=31, max_steps=2)
        step0 = result.get("timeline", [])[0]
        self.assertIsInstance(step0, dict)
        events = step0.get("events") if isinstance(step0.get("events"), list) else []
        reaction_events = [
            e for e in events
            if isinstance(e, dict)
            and str(e.get("channel") or "") == "combat-reaction-result"
        ]
        self.assertEqual(len(reaction_events), 0)

    def test_enemy_leave_melee_triggers_player_opportunity_attack(self) -> None:
        initial = {
            "players": {
                "p1": {
                    "id": "p1",
                    "actorId": "player_1",
                    "role": "player",
                    "hp": 30.0,
                    "max_hp": 30.0,
                    "ac": 14,
                    "position": {"x": 0.0, "y": 0.0, "z": 0.0},
                    "inventory": {"items": [{"instanceId": "p1_ls", "itemId": "longsword", "qty": 1, "equipped": True}]},
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
                        "name": "Runner",
                        "position": {"x": 4.0, "y": 0.0, "z": 0.0},
                        "hp": 2.0,
                        "maxHp": 20.0,
                        "ac": 10,
                        "attackBonus": 2,
                        "damageRoll": 4,
                        "damageBonus": 0,
                        "canDisengage": False,
                    }
                },
                "mode": "combat",
                "combat": {
                    "turn": 0,
                    "order": [{"id": "enemy_1", "type": "enemy"}, {"id": "player_1", "type": "player", "ownerSid": "p1"}],
                    "state": {"inCombat": True, "roundNumber": 1},
                },
                "scene": {"objects": []},
            },
        }

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            _ = (state, actor, rng, step)
            return {"id": "noop", "type": "dodge"}

        result = combat_harness.run_combat(initial, _provider, seed=7, max_steps=1)
        step0 = result.get("timeline", [])[0]
        events = step0.get("events") if isinstance(step0, dict) and isinstance(step0.get("events"), list) else []
        reaction_events = [e for e in events if isinstance(e, dict) and str(e.get("channel") or "") == "combat-reaction-result"]
        self.assertGreaterEqual(len(reaction_events), 1)
        self.assertTrue(any(str((e.get("payload") or {}).get("actorType") or "") == "player" for e in reaction_events))

    def test_use_object_consumes_potion_and_heals(self) -> None:
        initial = self._initial_state()
        initial["players"]["p1"]["hp"] = 8.0
        initial["players"]["p1"]["max_hp"] = 30.0
        initial["players"]["p1"]["inventory"] = {
            "items": [
                {"instanceId": "p1_potion", "itemId": "health_potion", "qty": 1, "equipped": False},
                {"instanceId": "p1_ls", "itemId": "longsword", "qty": 1, "equipped": True},
            ]
        }
        initial["world_state"]["combat"]["order"] = [
            {"id": "player_1", "type": "player", "ownerSid": "p1"},
            {"id": "enemy_1", "type": "enemy"},
        ]
        initial["world_state"]["combat"]["turn"] = 0

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            _ = (state, actor, rng)
            if step == 0:
                return {"id": "usepot", "type": "use-object", "instanceId": "p1_potion"}
            return {"id": f"noop_{step}", "type": "dodge"}

        result = combat_harness.run_combat(initial, _provider, seed=17, max_steps=1)
        step0 = result.get("timeline", [])[0]
        self.assertIsInstance(step0, dict)
        step_record = step0.get("stepRecord") if isinstance(step0.get("stepRecord"), dict) else {}
        self.assertEqual(str(step_record.get("action", {}).get("type") or ""), "USE-OBJECT")
        self.assertEqual(step_record.get("result"), "applied")

        events = step0.get("events") if isinstance(step0.get("events"), list) else []
        action_results = [
            e.get("payload")
            for e in events
            if isinstance(e, dict)
            and str(e.get("channel") or "") == "combat-action-result"
            and isinstance(e.get("payload"), dict)
            and str((e.get("payload") or {}).get("type") or "") == "use-object"
        ]
        self.assertTrue(action_results)
        payload = action_results[0]
        self.assertGreater(float(payload.get("healed", 0.0)), 0.0)
        self.assertEqual(int(payload.get("qtyAfter", 1)), 0)


if __name__ == "__main__":
    unittest.main()
