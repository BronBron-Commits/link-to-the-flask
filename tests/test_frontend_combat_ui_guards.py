import re
import unittest
from pathlib import Path


class FrontendCombatUiGuardsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.map3d_path = Path(__file__).resolve().parents[1] / "static" / "map3d.js"
        cls.source = cls.map3d_path.read_text(encoding="utf-8")

    def test_player_head_bars_are_cleared_during_combat(self) -> None:
        pattern = re.compile(
            r"function\s+updateAllPlayerHeadHealthBars\s*\(\)\s*\{"
            r"[\s\S]*?if\s*\(\s*currentGameMode\s*===\s*GAME_MODE\.COMBAT\s*\)\s*\{"
            r"[\s\S]*?for\s*\(\s*const\s+key\s+of\s+Array\.from\(playerHeadHealthBars\.keys\(\)\)\s*\)\s*\{"
            r"[\s\S]*?removePlayerHeadHealthBar\(key\);"
            r"[\s\S]*?\}\s*"
            r"[\s\S]*?return;"
            r"[\s\S]*?\}",
            re.MULTILINE,
        )
        self.assertRegex(
            self.source,
            pattern,
            msg="updateAllPlayerHeadHealthBars must clear lingering player head bars during combat",
        )

    def test_combat_clear_guard_runs_before_local_bar_creation(self) -> None:
        guard_idx = self.source.find("if (currentGameMode === GAME_MODE.COMBAT)")
        local_bar_idx = self.source.find("createPlayerHeadHealthBar(localKey, 'Player')")

        self.assertGreaterEqual(guard_idx, 0, "Combat clear guard not found")
        self.assertGreaterEqual(local_bar_idx, 0, "Local player head bar creation not found")
        self.assertLess(
            guard_idx,
            local_bar_idx,
            "Combat clear guard must run before creating head bars",
        )


if __name__ == "__main__":
    unittest.main()
