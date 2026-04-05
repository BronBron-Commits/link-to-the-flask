import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from extensions import app
import routes  # noqa: F401


class CharacterSheetRoutesTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = app.test_client()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.base_path = Path(self.temp_dir.name)
        self.static_dir = self.base_path / "static"
        self.uploads_dir = self.base_path / "uploads"
        self.contracts_dir = self.base_path / "contracts"
        self.static_dir.mkdir(parents=True, exist_ok=True)
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.contracts_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_character_sheets_api_lists_static_and_uploaded_pdfs(self) -> None:
        (self.static_dir / "alpha.pdf").write_bytes(b"%PDF-1.4\n")
        (self.static_dir / "nested").mkdir(parents=True, exist_ok=True)
        (self.static_dir / "nested" / "beta.pdf").write_bytes(b"%PDF-1.4\n")
        (self.uploads_dir / "gamma.pdf").write_bytes(b"%PDF-1.4\n")
        (self.static_dir / "ignore.txt").write_text("not a pdf", encoding="utf-8")

        with (
            patch.object(routes.gs, "STATIC_DIR", self.static_dir),
            patch.object(routes.gs, "UPLOADS_DIR", self.uploads_dir),
        ):
            res = self.client.get("/api/character-sheets")

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(
            [row["sheetId"] for row in data["sheets"]],
            [
                "static/alpha.pdf",
                "static/nested/beta.pdf",
                "uploads/gamma.pdf",
            ],
        )

    def test_import_character_sheet_api_imports_selected_static_pdf(self) -> None:
        selected_pdf = self.static_dir / "party" / "alpha.pdf"
        selected_pdf.parent.mkdir(parents=True, exist_ok=True)
        selected_pdf.write_bytes(b"%PDF-1.4\n")

        fake_tables = {"character": {"armor_class": 15, "hit_points": 22, "initiative_bonus": 2, "speed": 30}}
        fake_master = {"identity": {"character_name": "Alpha"}}
        fake_engine_entity = {"inventory": {"items": [{"itemId": "longsword", "qty": 1}]}}

        with (
            patch.object(routes.gs, "STATIC_DIR", self.static_dir),
            patch.object(routes.gs, "UPLOADS_DIR", self.uploads_dir),
            patch.object(routes.gs, "CONTRACTS_DIR", self.contracts_dir),
            patch("routes.parse_character_tables", return_value=fake_tables) as parse_mock,
            patch("routes.build_master_character_record", return_value=fake_master) as master_mock,
            patch("routes.build_engine_entity", return_value=fake_engine_entity) as entity_mock,
            patch("routes.write_outputs") as write_mock,
        ):
            res = self.client.post("/api/import-character-sheet", json={"sheetId": "static/party/alpha.pdf"})

        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["source_file"], "alpha.pdf")
        self.assertEqual(data["master"], fake_master)
        self.assertEqual(data["engine_entity"], fake_engine_entity)
        parse_mock.assert_called_once_with(selected_pdf)
        master_mock.assert_called_once_with(fake_tables)
        entity_mock.assert_called_once_with(fake_master)
        write_mock.assert_called_once_with(self.contracts_dir, fake_tables)

    def test_import_character_sheet_api_rejects_unknown_sheet(self) -> None:
        with (
            patch.object(routes.gs, "STATIC_DIR", self.static_dir),
            patch.object(routes.gs, "UPLOADS_DIR", self.uploads_dir),
        ):
            res = self.client.post("/api/import-character-sheet", json={"sheetId": "static/missing.pdf"})

        self.assertEqual(res.status_code, 404)
        data = res.get_json()
        self.assertFalse(data["ok"])


if __name__ == "__main__":
    unittest.main()