"""Small local GUI for running offline simulation tests.

Run from repo root:
    python scripts/simulation_test_gui.py
"""

from __future__ import annotations

import json
import random
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
import tkinter as tk
from tkinter import messagebox
from tkinter.scrolledtext import ScrolledText


REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

import combat_harness
from scripts import party_horde_simulation


class SimulationTestGui(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("Simulation Test Runner")
        self.geometry("980x660")
        self.minsize(820, 560)

        self.test_scope_var = tk.StringVar(value="simulation")
        self.custom_pattern_var = tk.StringVar(value="test_*.py")
        self.status_var = tk.StringVar(value="Ready")
        self.summary_var = tk.StringVar(value="No test run yet")
        self.chaos_seed_var = tk.StringVar(value="2026")
        self.chaos_steps_var = tk.StringVar(value="80")
        self.chaos_log_dir_var = tk.StringVar(value="data/combat_logs")
        self.party_pdf_dir_var = tk.StringVar(value="static")
        self.party_enemy_count_var = tk.StringVar(value="24")

        self._process: subprocess.Popen | None = None
        self._stop_requested = False

        self._build_ui()

    def _build_ui(self) -> None:
        root = tk.Frame(self, padx=12, pady=12)
        root.pack(fill="both", expand=True)

        controls = tk.Frame(root)
        controls.pack(fill="x", pady=(0, 8))

        tk.Label(controls, text="Scope", width=8, anchor="w").pack(side="left")
        tk.Radiobutton(controls, text="Simulation", value="simulation", variable=self.test_scope_var).pack(side="left")
        tk.Radiobutton(controls, text="All", value="all", variable=self.test_scope_var).pack(side="left")
        tk.Radiobutton(controls, text="Custom", value="custom", variable=self.test_scope_var).pack(side="left")

        pattern_row = tk.Frame(root)
        pattern_row.pack(fill="x", pady=(0, 10))
        tk.Label(pattern_row, text="Pattern", width=8, anchor="w").pack(side="left")
        tk.Entry(pattern_row, textvariable=self.custom_pattern_var).pack(side="left", fill="x", expand=True)
        tk.Label(
            pattern_row,
            text="Used when Scope=Custom (example: test_multiplayer_system.py)",
            fg="#555555",
            anchor="w",
        ).pack(side="left", padx=(8, 0))

        action_row = tk.Frame(root)
        action_row.pack(fill="x", pady=(0, 10))

        self.run_btn = tk.Button(action_row, text="Run Tests", width=14, command=self._run_tests)
        self.run_btn.pack(side="left")

        self.run_chaos_btn = tk.Button(action_row, text="Run Chaos Combat", width=18, command=self._run_chaos_simulation)
        self.run_chaos_btn.pack(side="left", padx=(8, 0))

        self.run_party_btn = tk.Button(action_row, text="Run Party vs Horde", width=18, command=self._run_party_horde_simulation)
        self.run_party_btn.pack(side="left", padx=(8, 0))

        self.stop_btn = tk.Button(action_row, text="Stop", width=10, command=self._stop_tests, state="disabled")
        self.stop_btn.pack(side="left", padx=(8, 0))

        tk.Button(action_row, text="Clear Log", width=12, command=self._clear_log).pack(side="left", padx=(8, 0))

        tk.Label(action_row, textvariable=self.status_var, fg="#1f4f99").pack(side="left", padx=(14, 0))

        chaos_row = tk.Frame(root)
        chaos_row.pack(fill="x", pady=(0, 10))
        tk.Label(chaos_row, text="Chaos", width=8, anchor="w").pack(side="left")
        tk.Label(chaos_row, text="Seed").pack(side="left")
        tk.Entry(chaos_row, textvariable=self.chaos_seed_var, width=10).pack(side="left", padx=(6, 12))
        tk.Label(chaos_row, text="Max Steps").pack(side="left")
        tk.Entry(chaos_row, textvariable=self.chaos_steps_var, width=8).pack(side="left", padx=(6, 12))
        tk.Label(chaos_row, text="Log Dir").pack(side="left")
        tk.Entry(chaos_row, textvariable=self.chaos_log_dir_var).pack(side="left", fill="x", expand=True, padx=(6, 0))

        party_row = tk.Frame(root)
        party_row.pack(fill="x", pady=(0, 10))
        tk.Label(party_row, text="Party", width=8, anchor="w").pack(side="left")
        tk.Label(party_row, text="PDF Dir").pack(side="left")
        tk.Entry(party_row, textvariable=self.party_pdf_dir_var).pack(side="left", fill="x", expand=True, padx=(6, 12))
        tk.Label(party_row, text="Enemies").pack(side="left")
        tk.Entry(party_row, textvariable=self.party_enemy_count_var, width=8).pack(side="left", padx=(6, 0))

        summary_row = tk.Frame(root)
        summary_row.pack(fill="x", pady=(0, 8))
        tk.Label(summary_row, text="Summary", width=8, anchor="w").pack(side="left")
        tk.Label(summary_row, textvariable=self.summary_var, anchor="w", fg="#173d24").pack(side="left", fill="x", expand=True)

        tk.Label(root, text="Test output", anchor="w").pack(fill="x")
        self.log = ScrolledText(root, wrap="word", height=30)
        self.log.pack(fill="both", expand=True)
        self._append_log("Choose scope and click Run Tests.\n")

    def _append_log(self, text: str) -> None:
        self.log.insert(tk.END, text)
        self.log.see(tk.END)

    def _clear_log(self) -> None:
        self.log.delete("1.0", tk.END)

    def _set_running_ui(self, running: bool) -> None:
        self.run_btn.config(state="disabled" if running else "normal")
        self.run_chaos_btn.config(state="disabled" if running else "normal")
        self.run_party_btn.config(state="disabled" if running else "normal")
        self.stop_btn.config(state="normal" if running else "disabled")
        if running:
            self.status_var.set("Running tests...")
        elif self.status_var.get() == "Running tests...":
            self.status_var.set("Ready")

    def _set_chaos_running_ui(self, running: bool) -> None:
        self.run_btn.config(state="disabled" if running else "normal")
        self.run_chaos_btn.config(state="disabled" if running else "normal")
        self.run_party_btn.config(state="disabled" if running else "normal")
        self.stop_btn.config(state="disabled")
        if running:
            self.status_var.set("Running chaos simulation...")
        elif self.status_var.get() == "Running chaos simulation...":
            self.status_var.set("Ready")

    def _resolve_test_pattern(self) -> str:
        scope = self.test_scope_var.get().strip().lower()
        if scope == "simulation":
            return "test_multiplayer_system.py"
        if scope == "all":
            return "test_*.py"
        pattern = self.custom_pattern_var.get().strip()
        return pattern or "test_*.py"

    def _build_test_command(self, pattern: str) -> list[str]:
        return [
            sys.executable,
            "-m",
            "unittest",
            "discover",
            "-s",
            "tests",
            "-p",
            pattern,
            "-v",
        ]

    def _run_tests(self) -> None:
        if self._process is not None:
            messagebox.showinfo("Already Running", "A test run is already in progress.")
            return

        pattern = self._resolve_test_pattern()
        tests_dir = Path("tests")
        if not tests_dir.exists():
            messagebox.showerror("Missing Tests", "Could not find tests directory.")
            return

        command = self._build_test_command(pattern)
        self._append_log("\n" + "=" * 72 + "\n")
        self._append_log("Command:\n")
        self._append_log("  " + " ".join(command) + "\n")
        self._append_log("Started: " + time.strftime("%Y-%m-%d %H:%M:%S") + "\n\n")

        self.summary_var.set("Running...")
        self._stop_requested = False
        self._set_running_ui(True)

        worker = threading.Thread(target=self._run_tests_worker, args=(command,), daemon=True)
        worker.start()

    def _run_tests_worker(self, command: list[str]) -> None:
        start = time.time()
        output_parts: list[str] = []

        try:
            self._process = subprocess.Popen(
                command,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            assert self._process.stdout is not None
            for line in self._process.stdout:
                output_parts.append(line)
                self.after(0, self._append_log, line)

            self._process.wait()
            code = int(self._process.returncode or 0)
            duration = time.time() - start
            output_text = "".join(output_parts)
            summary = self._summarize_output(output_text, code, duration)
            self.after(0, self._on_run_complete, code, summary)
        except Exception as exc:
            self.after(0, self._on_run_error, str(exc))
        finally:
            self._process = None

    def _summarize_output(self, output: str, code: int, duration_sec: float) -> dict:
        tests_run = None
        fail_count = 0
        err_count = 0

        m = re.search(r"Ran\s+(\d+)\s+tests?", output)
        if m:
            tests_run = int(m.group(1))

        m = re.search(r"FAILED\s*\(([^\)]+)\)", output)
        if m:
            details = m.group(1)
            fm = re.search(r"failures=(\d+)", details)
            em = re.search(r"errors=(\d+)", details)
            if fm:
                fail_count = int(fm.group(1))
            if em:
                err_count = int(em.group(1))

        return {
            "ok": code == 0 and not self._stop_requested,
            "return_code": code,
            "tests_run": tests_run,
            "failures": fail_count,
            "errors": err_count,
            "duration_sec": round(duration_sec, 2),
            "stopped": self._stop_requested,
        }

    def _on_run_complete(self, code: int, summary: dict) -> None:
        self._set_running_ui(False)

        self._append_log("\n" + "=" * 72 + "\n")
        self._append_log("Finished: " + time.strftime("%Y-%m-%d %H:%M:%S") + "\n")
        self._append_log(json.dumps(summary, indent=2) + "\n")

        if summary.get("stopped"):
            self.status_var.set("Stopped")
            self.summary_var.set("Run stopped by user")
            return

        if code == 0:
            self.status_var.set("Passed")
            self.summary_var.set(
                f"PASS - ran {summary.get('tests_run', '?')} tests in {summary.get('duration_sec')}s"
            )
        else:
            self.status_var.set("Failed")
            self.summary_var.set(
                "FAIL - "
                f"failures={summary.get('failures', 0)} "
                f"errors={summary.get('errors', 0)} "
                f"return_code={summary.get('return_code')}"
            )

    def _on_run_error(self, message: str) -> None:
        self._set_running_ui(False)
        self.status_var.set("Error")
        self.summary_var.set("Runner crashed")
        self._append_log("\nRunner error:\n" + message + "\n")
        messagebox.showerror("Test Runner Error", message)

    def _stop_tests(self) -> None:
        if self._process is None:
            return
        self._stop_requested = True
        self.status_var.set("Stopping...")
        try:
            self._process.terminate()
        except Exception:
            pass

    def _build_chaos_initial_state(self) -> dict:
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
                    "inventory": {"items": [{"instanceId": "p1_ls", "itemId": "longsword", "qty": 1, "equipped": True}]},
                },
                "p2": {
                    "id": "p2",
                    "actorId": "player_2",
                    "role": "player",
                    "hp": 30.0,
                    "max_hp": 30.0,
                    "ac": 13,
                    "position": {"x": 2.0, "y": 0.0, "z": 0.0},
                    "inventory": {"items": [{"instanceId": "p2_j", "itemId": "javelin", "qty": 1, "equipped": True}]},
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

    def _make_chaos_provider(self, max_steps: int):
        chaos_trigger_step = max(4, int(max_steps * 0.35))
        memory = {"last_action_id": None}

        def _provider(state: dict, actor: dict, rng: random.Random, step: int) -> dict:
            actor_id = str(actor.get("id") or "player")
            action_id = f"chaos_{step}_{actor_id}"
            entities = state.get("entities") if isinstance(state.get("entities"), dict) else {}
            live_targets = [
                eid for eid, row in entities.items() if isinstance(row, dict) and str(row.get("type") or "").lower() == "enemy" and float(row.get("hp", 0)) > 0
            ]
            target_id = live_targets[0] if live_targets else "enemy_1"

            # Early phase: stable behavior. Mid-fight: inject disruptive payloads.
            if step >= chaos_trigger_step:
                p = rng.random()
                if p < 0.20 and memory["last_action_id"]:
                    return {
                        "id": memory["last_action_id"],
                        "type": "attack",
                        "targetId": target_id,
                    }
                if p < 0.35:
                    payload = {"id": action_id, "type": "teleport"}
                    memory["last_action_id"] = action_id
                    return payload
                if p < 0.50:
                    payload = {"id": action_id, "type": "attack", "targetId": "enemy_UNKNOWN"}
                    memory["last_action_id"] = action_id
                    return payload
                if p < 0.65:
                    payload = {"id": action_id, "type": "attack"}
                    memory["last_action_id"] = action_id
                    return payload

            if rng.random() < 0.75:
                payload = {"id": action_id, "type": "attack", "targetId": target_id}
            elif rng.random() < 0.5:
                payload = {"id": action_id, "type": "move"}
            else:
                payload = {"id": action_id, "type": "dodge"}

            memory["last_action_id"] = action_id
            return payload

        return _provider

    def _summarize_chaos_result(self, result: dict) -> dict:
        timeline = result.get("timeline") if isinstance(result.get("timeline"), list) else []
        records = [
            step.get("stepRecord")
            for step in timeline
            if isinstance(step, dict) and isinstance(step.get("stepRecord"), dict)
        ]
        attack_records = [r for r in records if (r.get("action") or {}).get("type") == "ATTACK"]
        applied_attacks = [r for r in attack_records if r.get("result") == "applied"]
        hit_count = sum(1 for r in applied_attacks if bool(r.get("hit")))
        total_damage = sum(int(r.get("damage") or 0) for r in applied_attacks)
        deny_counts: dict[str, int] = {}
        for r in records:
            reason = str(r.get("denyReason") or "").strip()
            if not reason:
                continue
            deny_counts[reason] = deny_counts.get(reason, 0) + 1

        return {
            "seed": result.get("seed"),
            "steps": result.get("steps"),
            "stopReason": result.get("stopReason"),
            "combatFinished": bool(result.get("combatFinished")),
            "finalHash": str(result.get("finalHash") or "")[:16],
            "attackAttempts": len(attack_records),
            "attackApplied": len(applied_attacks),
            "hitCount": hit_count,
            "hitRate": round((hit_count / max(1, len(applied_attacks))), 3),
            "totalDamage": total_damage,
            "denyCounts": deny_counts,
        }

    def _run_chaos_simulation(self) -> None:
        if self._process is not None:
            messagebox.showinfo("Busy", "A unit-test run is currently in progress.")
            return

        try:
            seed = int(self.chaos_seed_var.get().strip() or "2026")
            max_steps = int(self.chaos_steps_var.get().strip() or "80")
            if max_steps < 1:
                raise ValueError("max steps must be >= 1")
        except Exception as exc:
            messagebox.showerror("Invalid Chaos Config", f"Bad seed/steps value: {exc}")
            return

        self.summary_var.set("Running chaos combat simulation...")
        self._set_chaos_running_ui(True)
        self._append_log("\n" + "=" * 72 + "\n")
        self._append_log("Chaos combat run started: " + time.strftime("%Y-%m-%d %H:%M:%S") + "\n")
        self._append_log(f"seed={seed} max_steps={max_steps}\n\n")

        worker = threading.Thread(target=self._run_chaos_worker, args=(seed, max_steps), daemon=True)
        worker.start()

    def _run_chaos_worker(self, seed: int, max_steps: int) -> None:
        try:
            initial_state = self._build_chaos_initial_state()
            provider = self._make_chaos_provider(max_steps)
            result = combat_harness.run_combat(
                initial_state,
                provider,
                seed=seed,
                max_steps=max_steps,
                validate_invariants=True,
            )

            log_dir = Path(self.chaos_log_dir_var.get().strip() or "data/combat_logs")
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            log_path = log_dir / f"chaos_combat_seed{seed}_{timestamp}.json"
            combat_harness.save_combat_log(log_path, result)
            summary = self._summarize_chaos_result(result)

            self.after(0, self._on_chaos_complete, summary, str(log_path))
        except Exception as exc:
            self.after(0, self._on_chaos_error, str(exc))

    def _on_chaos_complete(self, summary: dict, log_path: str) -> None:
        self._set_chaos_running_ui(False)
        self.status_var.set("Chaos Complete")
        self.summary_var.set(
            f"CHAOS OK - steps={summary.get('steps')} stop={summary.get('stopReason')} log={Path(log_path).name}"
        )
        self._append_log("Chaos summary:\n")
        self._append_log(json.dumps(summary, indent=2) + "\n")
        self._append_log(f"Saved log: {log_path}\n")

    def _on_chaos_error(self, message: str) -> None:
        self._set_chaos_running_ui(False)
        self.status_var.set("Chaos Error")
        self.summary_var.set("Chaos simulation failed")
        self._append_log("Chaos runner error:\n" + message + "\n")
        messagebox.showerror("Chaos Simulation Error", message)

    def _run_party_horde_simulation(self) -> None:
        if self._process is not None:
            messagebox.showinfo("Busy", "A unit-test run is currently in progress.")
            return

        try:
            seed = int(self.chaos_seed_var.get().strip() or "2026")
            max_steps = int(self.chaos_steps_var.get().strip() or "80")
            enemy_count = int(self.party_enemy_count_var.get().strip() or "24")
            if max_steps < 1 or enemy_count < 1:
                raise ValueError("max steps and enemies must be >= 1")
        except Exception as exc:
            messagebox.showerror("Invalid Party/Horde Config", f"Bad values: {exc}")
            return

        static_dir = Path(self.party_pdf_dir_var.get().strip() or "static")
        self.summary_var.set("Running party-vs-horde simulation...")
        self._set_chaos_running_ui(True)
        self._append_log("\n" + "=" * 72 + "\n")
        self._append_log("Party-vs-horde run started: " + time.strftime("%Y-%m-%d %H:%M:%S") + "\n")
        self._append_log(f"pdf_dir={static_dir} seed={seed} max_steps={max_steps} enemies={enemy_count}\n\n")

        worker = threading.Thread(
            target=self._run_party_horde_worker,
            args=(static_dir, seed, max_steps, enemy_count),
            daemon=True,
        )
        worker.start()

    def _run_party_horde_worker(self, static_dir: Path, seed: int, max_steps: int, enemy_count: int) -> None:
        try:
            log_dir = Path(self.chaos_log_dir_var.get().strip() or "data/combat_logs")
            summary, log_path = party_horde_simulation.run_party_horde(
                static_dir,
                enemy_count=enemy_count,
                seed=seed,
                max_steps=max_steps,
                log_dir=log_dir,
            )
            self.after(0, self._on_party_horde_complete, summary, str(log_path))
        except Exception as exc:
            self.after(0, self._on_party_horde_error, str(exc))

    def _on_party_horde_complete(self, summary: dict, log_path: str) -> None:
        self._set_chaos_running_ui(False)
        self.status_var.set("Party Horde Complete")
        self.summary_var.set(
            f"PARTY OK - party={summary.get('partySize')} enemies={summary.get('enemyCount')} stop={summary.get('stopReason')}"
        )
        self._append_log("Party-vs-horde summary:\n")
        self._append_log(json.dumps(summary, indent=2) + "\n")
        self._append_log(f"Saved log: {log_path}\n")

    def _on_party_horde_error(self, message: str) -> None:
        self._set_chaos_running_ui(False)
        self.status_var.set("Party Horde Error")
        self.summary_var.set("Party-vs-horde simulation failed")
        self._append_log("Party-vs-horde runner error:\n" + message + "\n")
        messagebox.showerror("Party-vs-Horde Error", message)


def main() -> None:
    app = SimulationTestGui()
    app.mainloop()


if __name__ == "__main__":
    main()
