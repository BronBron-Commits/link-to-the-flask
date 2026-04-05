import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from extensions import app
import game_state as gs
import routes  # noqa: F401


class SceneAndMaterialsStateRoutesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.scene_state_file = self.base_path / "scene_state.json"
        self.materials_state_file = self.base_path / "materials_state.json"

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_scene_state_post_persists_to_disk_and_get_loads_it(self) -> None:
        payload = {
            "objects": {
                "table_top": {
                    "objectId": "table_top",
                    "name": "TableTop",
                    "position": {"x": 1.0, "y": 2.0, "z": 3.0},
                    "rotation": {"x": 0.1, "y": 0.2, "z": 0.3},
                    "scale": {"x": 1.0, "y": 1.0, "z": 1.0},
                    "materials": [],
                }
            },
            "lights": {},
        }

        with patch.object(gs, "SCENE_STATE_FILE", self.scene_state_file):
            res = self.client.post("/scene_state", json=payload)
            self.assertEqual(res.status_code, 200)
            self.assertTrue(self.scene_state_file.exists())

            saved = self.scene_state_file.read_text(encoding="utf-8")
            self.assertIn("table_top", saved)

            # Simulate fresh memory state and ensure GET rehydrates from file.
            gs.latest_scene_state = {"objects": {}, "lights": {}}
            gs.world_state["scene"] = {"objects": {}, "lights": {}}

            get_res = self.client.get("/scene_state")
            self.assertEqual(get_res.status_code, 200)
            body = get_res.get_json()
            self.assertIn("scene", body)
            self.assertIn("objects", body["scene"])
            self.assertIn("table_top", body["scene"]["objects"])

    def test_materials_state_roundtrip(self) -> None:
        initial = self.client.get("/materials_state")
        self.assertEqual(initial.status_code, 200)
        initial_body = initial.get_json()
        self.assertEqual(initial_body.get("schemaVersion"), "materials.v1")
        self.assertIsInstance(initial_body.get("materials"), dict)

        payload = {
            "schemaVersion": "materials.v1",
            "worldId": "map3d",
            "updatedBy": "dev",
            "materials": {
                "table_top": {
                    "name": "TableTop",
                    "materials": [
                        {
                            "materialIndex": 0,
                            "materialState": {
                                "type": "MeshStandardMaterial",
                                "color": 0,
                                "roughness": 0.7,
                                "metalness": 0.1,
                            },
                        }
                    ],
                }
            },
        }

        with patch.object(gs, "MATERIALS_STATE_FILE", self.materials_state_file):
            post_res = self.client.post("/materials_state", json=payload)
            self.assertEqual(post_res.status_code, 200)
            self.assertTrue(self.materials_state_file.exists())

            get_res = self.client.get("/materials_state")
            self.assertEqual(get_res.status_code, 200)
            body = get_res.get_json()
            self.assertIn("table_top", body["materials"])
            row = body["materials"]["table_top"]["materials"][0]["materialState"]
            self.assertEqual(row["color"], 0)
            self.assertEqual(row["type"], "MeshStandardMaterial")

    def test_materials_state_post_requires_materials_object(self) -> None:
        with patch.object(gs, "MATERIALS_STATE_FILE", self.materials_state_file):
            res = self.client.post("/materials_state", json={"schemaVersion": "materials.v1"})
        self.assertEqual(res.status_code, 400)
        body = res.get_json()
        self.assertFalse(body["ok"])


if __name__ == "__main__":
    unittest.main()
