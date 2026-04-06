"""Event log persistence and deterministic replay helpers."""

import json
from pathlib import Path
from typing import Callable


EventRunner = Callable[[int, list[dict]], dict]


def build_event_log(seed: int, actions: list[dict]) -> dict:
    return {
        "seed": int(seed),
        "actions": actions if isinstance(actions, list) else [],
    }


def write_event_log(path: str | Path, seed: int, actions: list[dict]) -> Path:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    payload = build_event_log(seed, actions)
    output.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
    return output


def read_event_log(path: str | Path) -> dict:
    src = Path(path)
    parsed = json.loads(src.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("Event log must be an object")
    seed = int(parsed.get("seed", 0))
    actions = parsed.get("actions") if isinstance(parsed.get("actions"), list) else []
    return {"seed": seed, "actions": actions}


def replay_event_log(path: str | Path, runner: EventRunner) -> dict:
    payload = read_event_log(path)
    return runner(payload["seed"], payload["actions"])
