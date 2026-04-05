import unittest
from pathlib import Path
from unittest.mock import patch

from scripts import pdf_to_tidy_data


def _page(*lines: str) -> str:
    return "\n".join(lines)


class ExtractInventoryTripletsTests(unittest.TestCase):
    def test_extract_inventory_triplets_skips_headers_and_noise(self) -> None:
        lines = [
            "NAME",
            "QTY",
            "WEIGHT",
            "Longsword",
            "1",
            "3 lb.",
            "Wizards of the Coast",
            "1",
            "--",
            "Rope, hempen (50 feet)",
            "2",
            "10 lb.",
            "PERSONALITY TRAITS",
            "1",
            "1 lb.",
        ]

        result = pdf_to_tidy_data.extract_inventory_triplets(lines)

        self.assertEqual(
            result,
            [
                "Longsword | qty=1 | weight=3 lb.",
                "Rope, hempen (50 feet) | qty=2 | weight=10 lb.",
            ],
        )


class ParseInventorySummaryAndRoleplayTests(unittest.TestCase):
    def test_parse_inventory_summary_maps_currency_and_capacity(self) -> None:
        pages = [
            _page(
                "EQUIPMENT",
                "WEIGHT CARRIED",
                "12",
                "3",
                "1",
                "45",
                "9",
                "18 lb.",
                "90 lb.",
                "180 lb.",
            )
        ]

        result = pdf_to_tidy_data.parse_inventory_summary_and_roleplay(pages)

        self.assertEqual(
            result["currency"],
            {"cp": 12, "sp": 9, "ep": 3, "gp": 45, "pp": 1},
        )
        self.assertEqual(
            result["capacity"],
            {
                "weight_carried": "18 lb.",
                "encumbered": "90 lb.",
                "push_drag_lift": "180 lb.",
            },
        )

    def test_parse_inventory_summary_reads_labeled_currency_tokens(self) -> None:
        pages = [
            _page(
                "EQUIPMENT",
                "WEIGHT CARRIED",
                "CP",
                "12",
                "SP",
                "9",
                "EP",
                "3",
                "GP",
                "45",
                "PP",
                "1",
                "18 lb.",
                "90 lb.",
                "180 lb.",
            )
        ]

        result = pdf_to_tidy_data.parse_inventory_summary_and_roleplay(pages)

        self.assertEqual(
            result["currency"],
            {"cp": 12, "sp": 9, "ep": 3, "gp": 45, "pp": 1},
        )


class ExtractInventoryTripletsNoiseTests(unittest.TestCase):
    def test_extract_inventory_triplets_ignores_section_noise_and_numbers(self) -> None:
        lines = [
            "NAME",
            "QTY",
            "WEIGHT",
            "Torch",
            "10",
            "1 lb.",
            "CP",
            "12",
            "3 lb.",
            "Steel Mirror",
            "1",
            "1 lb.",
            "ALLIES & ORGANIZATIONS",
            "2",
            "1 lb.",
        ]

        result = pdf_to_tidy_data.extract_inventory_triplets(lines)

        self.assertEqual(
            result,
            [
                "Torch | qty=10 | weight=1 lb.",
                "Steel Mirror | qty=1 | weight=1 lb.",
            ],
        )

    def test_extract_inventory_triplets_skips_capacity_and_composite_headers(self) -> None:
        lines = [
            "WEIGHT CARRIED",
            "1",
            "--",
            "ENCUMBERED",
            "1",
            "--",
            "PUSH/DRAG/LIFT",
            "1",
            "--",
            "NAME QTY WEIGHT NAME QTY WEIGHT",
            "1",
            "--",
            "ATTUNED MAGIC ITEMS QTY WEIGHT",
            "1",
            "--",
            "Longsword",
            "1",
            "3 lb.",
        ]

        result = pdf_to_tidy_data.extract_inventory_triplets(lines)

        self.assertEqual(result, ["Longsword | qty=1 | weight=3 lb."])


class ExtractInventoryTripletsFromFormValuesTests(unittest.TestCase):
    def test_extract_inventory_triplets_from_form_values_reads_eq_fields(self) -> None:
        form_values = {
            "Eq Name0": "Leather",
            "Eq Qty0": "1",
            "Eq Weight0": "10 lb.",
            "Eq Name1": "Dagger",
            "Eq Qty1": "2",
            "Eq Weight1": "1 lb.",
            "Eq Name2": "Backpack",
            "Eq Qty2": "1",
            "Eq Weight2": "5 lb.",
        }

        result = pdf_to_tidy_data.extract_inventory_triplets_from_form_values(form_values)

        self.assertEqual(
            result,
            [
                "Leather | qty=1 | weight=10 lb.",
                "Dagger | qty=2 | weight=1 lb.",
                "Backpack | qty=1 | weight=5 lb.",
            ],
        )

    def test_extract_inventory_triplets_from_form_values_skips_header_names(self) -> None:
        form_values = {
            "Eq Name0": "WEIGHT CARRIED",
            "Eq Qty0": "1",
            "Eq Weight0": "--",
            "Eq Name1": "Rope, hempen (50 feet)",
            "Eq Qty1": "1",
            "Eq Weight1": "10 lb.",
        }

        result = pdf_to_tidy_data.extract_inventory_triplets_from_form_values(form_values)

        self.assertEqual(result, ["Rope, hempen (50 feet) | qty=1 | weight=10 lb."])


class ParseSavesAndSkillsTests(unittest.TestCase):
    def test_parse_saves_and_skills_returns_all_rows_with_proficiency_flags(self) -> None:
        abilities = [
            {"ability": "STR", "modifier": -1},
            {"ability": "DEX", "modifier": 2},
            {"ability": "CON", "modifier": 1},
            {"ability": "INT", "modifier": 4},
            {"ability": "WIS", "modifier": 0},
            {"ability": "CHA", "modifier": 3},
        ]
        first_page_lines = [
            "Hero's Character",
            "Wizard 5",
            "Alice",
            "Elf",
            "Sage",
            "+0",
            "+5",
            "+1",
            "+7",
            "+3",
            "+6",
            "Immunities: none",
            "+2",
            "+0",
            "+6",
            "-1",
            "+5",
            "+6",
            "+0",
            "+3",
            "+6",
            "+0",
            "+4",
            "+5",
            "+3",
            "+7",
            "+6",
            "+2",
            "+2",
            "+4",
            "+0",
        ]

        result = pdf_to_tidy_data.parse_saves_and_skills(first_page_lines, abilities)

        self.assertEqual(len(result["saving_throws"]), 6)
        self.assertEqual(len(result["skills"]), 18)

        self.assertEqual(result["saving_throws"][0], {"ability": "STR", "bonus": 0, "proficient": True})
        self.assertEqual(result["saving_throws"][3], {"ability": "INT", "bonus": 7, "proficient": True})

        arcana = next(skill for skill in result["skills"] if skill["name"] == "Arcana")
        athletics = next(skill for skill in result["skills"] if skill["name"] == "Athletics")
        stealth = next(skill for skill in result["skills"] if skill["name"] == "Stealth")

        self.assertEqual(arcana["bonus"], 6)
        self.assertTrue(arcana["proficient"])
        self.assertEqual(athletics["bonus"], -1)
        self.assertFalse(athletics["proficient"])
        self.assertEqual(stealth["bonus"], 2)
        self.assertFalse(stealth["proficient"])

    def test_apply_form_fallbacks_to_saves_and_skills_supports_real_pdf_field_aliases(self) -> None:
        parsed = {
            "ability_scores": [
                {"ability": "STR", "modifier": 2},
                {"ability": "DEX", "modifier": 2},
                {"ability": "CON", "modifier": 3},
                {"ability": "INT", "modifier": 0},
                {"ability": "WIS", "modifier": 1},
                {"ability": "CHA", "modifier": -1},
            ],
            "saving_throws": [
                {"ability": "STR", "bonus": None, "proficient": None},
                {"ability": "DEX", "bonus": None, "proficient": None},
                {"ability": "CON", "bonus": None, "proficient": None},
                {"ability": "INT", "bonus": None, "proficient": None},
                {"ability": "WIS", "bonus": None, "proficient": None},
                {"ability": "CHA", "bonus": None, "proficient": None},
            ],
            "skills": [
                {"name": "Animal Handling", "ability": "WIS", "bonus": None, "proficient": None, "expertise": None},
                {"name": "Sleight of Hand", "ability": "DEX", "bonus": None, "proficient": None, "expertise": None},
                {"name": "Athletics", "ability": "STR", "bonus": None, "proficient": None, "expertise": None},
            ],
        }
        form_values = {
            "ST Strength": "+4",
            "ST Dexterity": "+2",
            "ST Constitution": "+5",
            "ST Intelligence": "+0",
            "ST Wisdom": "+1",
            "ST Charisma": "-1",
            "Animal": "+1",
            "SleightofHand": "+4",
            "Athletics": "+4",
        }

        pdf_to_tidy_data.apply_form_fallbacks_to_saves_and_skills(parsed, form_values, parsed["ability_scores"])

        self.assertEqual([row["bonus"] for row in parsed["saving_throws"]], [4, 2, 5, 0, 1, -1])
        self.assertEqual(
            [row["bonus"] for row in parsed["skills"]],
            [1, 4, 4],
        )
        self.assertTrue(parsed["saving_throws"][0]["proficient"])
        self.assertFalse(parsed["saving_throws"][1]["proficient"])
        self.assertFalse(parsed["skills"][0]["proficient"])
        self.assertTrue(parsed["skills"][1]["proficient"])
        self.assertTrue(parsed["skills"][2]["proficient"])


class ExtractSpellsFromPagesTests(unittest.TestCase):
    def test_extract_spells_from_pages_filters_metadata_rows(self) -> None:
        pages = [
            _page(
                "SPELLCASTING",
                "CLASS",
                "SPELLCASTING",
                "ABILITY",
                "SPELL SAVE DC",
                "SPELL ATTACK",
                "BONUS",
                "PAGE REF",
                "SOURCE",
                "SAVE/ATK TIME",
                "RANGE",
                "COMP DURATION",
                "PREP SPELL NAME",
                "SPELLS",
                "CHA",
                "9",
                "+1",
                "Paladin",
                "=== CANTRIPS ===",
                "(At Will)",
                "O Thaumaturgy",
                "Fighting Style",
                "--",
                "1A",
                "30 ft.",
                "V",
                "1 minute",
                "PHB-2024 333 D: 1m, V",
                "O Resistance",
                "Fighting Style",
                "--",
                "1A",
                "Touch",
                "V,S",
                "Concentration, up to 1 minute",
                "PHB-2024 312 D: 1m, V/S",
                "=== 1st LEVEL ===",
                "3 Slots OOO",
                "P Divine Smite",
                "Paladin's Smite (Always Prepared) --",
                "1BA",
                "Self",
                "V",
                "Instantaneous",
                "PHB-2024 265 1/LR, V",
            )
        ]

        result = pdf_to_tidy_data.extract_spells_from_pages(pages, "character-1")

        self.assertEqual(
            [row["spell_text"] for row in result],
            ["Thaumaturgy", "Resistance", "Divine Smite"],
        )


class ParseCharacterTablesTests(unittest.TestCase):
    @patch("scripts.pdf_to_tidy_data.extract_pdf_form_values", return_value={})
    @patch("scripts.pdf_to_tidy_data.extract_text_by_page")
    def test_parse_character_tables_from_mocked_pages(self, extract_text_by_page_mock, _extract_form_values_mock) -> None:
        extract_text_by_page_mock.return_value = [
            _page(
                "Hero's Character",
                "Wizard 5",
                "Alice",
                "Elf",
                "Sage",
                "8",
                "-1",
                "14",
                "+2",
                "12",
                "+1",
                "18",
                "+4",
                "10",
                "+0",
                "16",
                "+3",
                "+2",
                "15",
                "+3",
                "30 ft. (Walking)",
                "27",
                "24",
                "5d6",
                "+0",
                "+5",
                "+1",
                "+7",
                "+3",
                "+6",
                "Immunities: none",
                "+2",
                "+0",
                "+6",
                "-1",
                "+5",
                "+6",
                "+0",
                "+3",
                "+6",
                "+0",
                "+4",
                "+5",
                "+3",
                "+7",
                "+6",
                "+2",
                "+2",
                "+4",
                "+0",
            ),
            _page(
                "EQUIPMENT",
                "WEIGHT CARRIED",
                "12",
                "3",
                "1",
                "45",
                "9",
                "18 lb.",
                "90 lb.",
                "180 lb.",
                "NAME",
                "QTY",
                "WEIGHT",
                "Longsword",
                "1",
                "3 lb.",
                "Rope, hempen (50 feet)",
                "2",
                "10 lb.",
            ),
        ]

        tables = pdf_to_tidy_data.parse_character_tables(Path("character.pdf"))

        self.assertEqual(tables["character"]["name"], "Hero's Character")
        self.assertEqual(tables["character"]["level"], 5)
        self.assertEqual(tables["character"]["armor_class"], 15)
        self.assertEqual(tables["character"]["hit_points"], 27)
        self.assertEqual(tables["character"]["current_hp"], 24)
        self.assertEqual(tables["character"]["speed"], 30)

        self.assertEqual(tables["inventory_summary"]["currency"]["gp"], 45)
        self.assertEqual(tables["inventory_summary"]["currency"]["sp"], 9)
        self.assertEqual(
            [row["item_text"] for row in tables["inventory_items"]],
            [
                "Longsword | qty=1 | weight=3 lb.",
                "Rope, hempen (50 feet) | qty=2 | weight=10 lb.",
            ],
        )

        self.assertEqual(len(tables["skills"]), 18)
        arcana = next(skill for skill in tables["skills"] if skill["name"] == "Arcana")
        self.assertEqual(arcana["bonus"], 6)
        self.assertTrue(arcana["proficient"])


class BuildEngineEntityTests(unittest.TestCase):
    def test_build_engine_entity_normalizes_runtime_fields(self) -> None:
        tables = {
            "character": {
                "character_id": "char_1",
                "source_file": "sample.pdf",
                "name": "Wysacaryn",
                "class_level": "Paladin 3",
                "player_name": "BronBron",
                "species": "Wood Elf",
                "background": "Sage",
                "level": 3,
                "armor_class": 12,
                "hit_points": 25,
                "current_hp": 25,
                "speed": 35,
                "initiative_bonus": 2,
                "proficiency_bonus": 2,
                "ability_save_dc": None,
                "passive_perception": 13,
                "passive_insight": 11,
                "passive_investigation": 11,
                "senses": [{"name": "Darkvision", "range_ft": 60}],
                "temp_hp": None,
                "hit_dice": "3d10",
                "extracted_at_utc": "2026-01-01T00:00:00+00:00",
            },
            "ability_scores": [
                {"character_id": "char_1", "ability": "STR", "score": 14, "modifier": 2},
                {"character_id": "char_1", "ability": "DEX", "score": 14, "modifier": 2},
                {"character_id": "char_1", "ability": "CON", "score": 12, "modifier": 1},
                {"character_id": "char_1", "ability": "INT", "score": 12, "modifier": 1},
                {"character_id": "char_1", "ability": "WIS", "score": 12, "modifier": 1},
                {"character_id": "char_1", "ability": "CHA", "score": 9, "modifier": -1},
            ],
            "saving_throws": [
                {"ability": "STR", "bonus": 2, "proficient": False},
                {"ability": "WIS", "bonus": 3, "proficient": True},
            ],
            "skills": [
                {"name": "Perception", "ability": "WIS", "bonus": 3, "proficient": True, "expertise": False},
                {"name": "Athletics", "ability": "STR", "bonus": 2, "proficient": False, "expertise": False},
            ],
            "proficiencies": {
                "armor": ["Chain Mail"],
                "weapons": ["Longsword"],
                "tools": [],
                "languages": ["Common"],
                "defenses": [],
            },
            "actions": {
                "standard_actions": "Attack Dash",
                "attacks": [
                    {"name": "Unarmed Strike", "hit_bonus": 4, "damage": "3 Bludgeoning", "properties": None}
                ],
            },
            "spellcasting_meta": {
                "class": "Paladin",
                "ability": "CHA",
                "spell_save_dc": 9,
                "spell_attack_bonus": 1,
            },
            "inventory_summary": {
                "currency": {"cp": 0, "sp": 0, "ep": 0, "gp": 9, "pp": 0},
                "capacity": {"weight_carried": "105 lb.", "encumbered": "210 lb.", "push_drag_lift": "420 lb."},
            },
            "roleplay": {
                "alignment": None,
                "size": "Medium",
                "gender": None,
                "weight": None,
                "hair": None,
                "skin": None,
                "age": None,
                "height": None,
                "eyes": None,
                "faith": None,
                "personality_traits": None,
                "ideals": None,
                "bonds": None,
                "flaws": None,
                "appearance": None,
                "allies_organizations": None,
                "backstory": None,
                "additional_notes": None,
            },
            "features": [
                {"character_id": "char_1", "feature_order": 1, "feature_text": "=== PALADIN FEATURES ==="},
                {"character_id": "char_1", "feature_order": 2, "feature_text": "* Divine Smite • PHB-2024 110"},
            ],
            "inventory_items": [
                {"character_id": "char_1", "item_order": 1, "item_text": "Shield | qty=1 | weight=6 lb."},
            ],
            "spells": [
                {"character_id": "char_1", "spell_order": 1, "spell_text": "Divine Smite"},
                {"character_id": "char_1", "spell_order": 2, "spell_text": "Divine Smite"},
            ],
            "raw_pages": ["placeholder"],
        }

        master = pdf_to_tidy_data.build_master_character_record(tables)
        engine_entity = pdf_to_tidy_data.build_engine_entity(master)

        pdf_to_tidy_data.validate_engine_entity_contract(engine_entity)

        self.assertEqual(engine_entity["id"], "char_1")
        self.assertEqual(engine_entity["combat"]["speed"], 35)
        self.assertEqual(engine_entity["combat"]["initiative"], 2)
        self.assertEqual(engine_entity["stats"]["str"], 14)
        self.assertEqual(engine_entity["inventory"]["capacity"], 210)
        self.assertEqual(engine_entity["inventory"]["weight"], 105)
        self.assertEqual(engine_entity["inventory"]["items"][0]["itemId"], "shield")
        self.assertEqual(engine_entity["inventory"]["items"][0]["qty"], 1)
        self.assertTrue(isinstance(engine_entity["inventory"]["items"][0]["instanceId"], str))
        self.assertEqual(engine_entity["weapons"][0]["damage"]["flat"], 3)
        self.assertEqual(engine_entity["weapons"][0]["damage"]["type"], "bludgeoning")
        self.assertEqual(len(engine_entity["spells"]), 1)
        self.assertEqual(engine_entity["features"][0]["type"], "section")
        self.assertEqual(engine_entity["features"][1]["name"], "Divine Smite")
        self.assertEqual(engine_entity["features"][1]["ruleId"], "divine_smite")


class SynthesizedFullInventoryPdfTests(unittest.TestCase):
    def test_synthesized_inventory_matches_parsed_inventory_for_all_static_pdfs(self) -> None:
        pdf_paths = sorted(Path("static").glob("*.pdf"))
        if not pdf_paths:
            self.skipTest("No PDFs found under static/")

        for pdf_path in pdf_paths:
            with self.subTest(pdf=pdf_path.name):
                form_values = pdf_to_tidy_data.extract_pdf_form_values(pdf_path)
                pages = pdf_to_tidy_data.extract_text_by_page(pdf_path)
                synthesized = pdf_to_tidy_data.synthesize_inventory_triplets(pages, form_values)

                tables = pdf_to_tidy_data.parse_character_tables(pdf_path)
                parsed_inventory = [row["item_text"] for row in tables["inventory_items"]]

                self.assertEqual(parsed_inventory, synthesized)

    def test_synthesized_inventory_rows_are_de_noised_for_all_static_pdfs(self) -> None:
        blocked_fragments = (
            "WEIGHT CARRIED",
            "ENCUMBERED",
            "PUSH/DRAG/LIFT",
            "NAME QTY WEIGHT",
            "ATTUNED MAGIC ITEMS",
        )

        pdf_paths = sorted(Path("static").glob("*.pdf"))
        if not pdf_paths:
            self.skipTest("No PDFs found under static/")

        for pdf_path in pdf_paths:
            with self.subTest(pdf=pdf_path.name):
                form_values = pdf_to_tidy_data.extract_pdf_form_values(pdf_path)
                pages = pdf_to_tidy_data.extract_text_by_page(pdf_path)
                synthesized = pdf_to_tidy_data.synthesize_inventory_triplets(pages, form_values)

                for row in synthesized:
                    upper = row.upper()
                    for blocked in blocked_fragments:
                        self.assertNotIn(blocked, upper)
                    self.assertRegex(row, r"\| qty=\d+ \| weight=(?:\d+\s*lb\.|--)")


if __name__ == "__main__":
    unittest.main()