import unittest
from pathlib import Path


MAP3D_JS = Path(__file__).resolve().parents[1] / 'static' / 'map3d.js'


class FrontendMultiplayerClientParityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.source = MAP3D_JS.read_text(encoding='utf-8')

    def test_clients_are_not_background_downgraded(self) -> None:
        self.assertIn('function isPrimaryClient() {\n    return true;\n}', self.source)
        self.assertNotIn('backgroundThrottled', self.source)
        self.assertNotIn('BACKGROUND_TAB_MAX_FPS', self.source)
        self.assertNotIn('BACKGROUND_TAB_MAX_RENDER_SCALE', self.source)

    def test_render_loop_does_not_skip_non_primary_clients(self) -> None:
        self.assertNotIn('if (!isPrimaryClient()) {\n        return;\n    }', self.source)

    def test_render_settings_do_not_gate_normal_clients(self) -> None:
        self.assertNotIn('&& isPrimaryClient()', self.source)
        self.assertNotIn('isPrimaryClient()\n        ? qualityCap', self.source)


if __name__ == '__main__':
    unittest.main()