"""Convert a character-sheet PDF into tidy JSON/CSV tables.

Usage:
  python scripts/pdf_to_tidy_data.py static/dndbeyondexample.pdf --out-dir data

The script writes:
  - character.json
  - ability_scores.csv
  - features.csv
  - inventory_items.csv
  - spells.csv
  - raw_pages.txt
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from pypdf import PdfReader

try:
    import fitz  # PyMuPDF
except Exception:
    fitz = None


PDF_PARSER_DEBUG = str(os.environ.get("PDF_PARSER_DEBUG", "")).strip().lower() in {"1", "true", "yes", "on"}


def extract_text_by_page_pypdf(pdf_path: Path) -> list[str]:
    reader = PdfReader(str(pdf_path))
    pages: list[str] = []
    for page in reader.pages:
        pages.append((page.extract_text() or "").strip())
    return pages


def extract_text_by_page_pymupdf(pdf_path: Path) -> list[str]:
    if fitz is None:
        return []
    doc = fitz.open(str(pdf_path))
    return [(page.get_text("text") or "").strip() for page in doc]


def extraction_quality_score(pages: list[str]) -> int:
    text = "\n".join(pages)
    score = 0
    # Reward markers that usually appear only when real values are extracted.
    score += 2 * len(re.findall(r"\b[A-Za-z]+\s+\d+\b", text))
    score += 3 * len(re.findall(r"\b[+-]\d+\b", text))
    score += 4 * len(re.findall(r"\b\d+d\d+\b", text))
    score += 5 * len(re.findall(r"\b(Walking|Darkvision|Dagger|Warlock)\b", text, flags=re.IGNORECASE))
    return score


def extract_text_by_page(pdf_path: Path) -> list[str]:
    pypdf_pages = extract_text_by_page_pypdf(pdf_path)
    pymupdf_pages = extract_text_by_page_pymupdf(pdf_path)

    if not pymupdf_pages:
        return pypdf_pages

    if extraction_quality_score(pymupdf_pages) >= extraction_quality_score(pypdf_pages):
        return pymupdf_pages
    return pypdf_pages


def _clean_pdf_value(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    # Common placeholders in empty form widgets.
    if text in {"--", "-", "N/A", "n/a"}:
        return None
    return text


def extract_pdf_form_values(pdf_path: Path) -> dict[str, str]:
    """Extract AcroForm/widget values from PDFs that don't expose rich text.

    Some character-sheet exports include data in form widgets while page text
    extraction returns mostly labels. This helper reads both `get_fields()` and
    per-page widget annotations.
    """
    out: dict[str, str] = {}
    reader = PdfReader(str(pdf_path))

    # Path 1: named fields exposed by pypdf.
    try:
        fields = reader.get_fields() or {}
    except Exception:
        fields = {}

    for key, field in fields.items():
        raw = getattr(field, "value", None)
        if raw is None and isinstance(field, dict):
            raw = field.get("/V")
        cleaned = _clean_pdf_value(raw)
        if cleaned is not None:
            out[str(key)] = cleaned

    # Path 2: widget annotations not listed in get_fields().
    for page in reader.pages:
        annots = page.get("/Annots") or []
        for annot_ref in annots:
            try:
                annot = annot_ref.get_object()
            except Exception:
                continue
            if str(annot.get("/Subtype") or "") != "/Widget":
                continue
            key = annot.get("/T")
            raw = annot.get("/V")
            cleaned = _clean_pdf_value(raw)
            if key and cleaned is not None:
                out[str(key)] = cleaned

    return out


def _get_form_value(form_values: dict[str, str], *key_fragments: str, debug: bool = False) -> str | None:
    """Find the first form value whose field name contains all fragments.
    
    Args:
        form_values: Dictionary of form field keys to values
        key_fragments: One or more fragments to search for in field names
        debug: If True, log all matching attempts
    
    Returns:
        The matched value or None
    """
    if not form_values:
        return None
    fragments = [re.sub(r"[^a-z0-9]+", "", frag.lower()) for frag in key_fragments if frag]
    normalized_items = [(key, re.sub(r"[^a-z0-9]+", "", key.lower()), value) for key, value in form_values.items()]
    
    if debug and fragments:
        print(f"    [FORM LOOKUP] searching for fragments: {fragments}")

    # Pass 1: exact normalized key match for single-fragment lookups.
    # This avoids false positives like "ac" -> "CharacterName".
    if len(fragments) == 1:
        target = fragments[0]
        for key, normalized_key, value in normalized_items:
            if normalized_key == target:
                if debug:
                    print(
                        f"    [FORM LOOKUP] ✓ EXACT MATCH: "
                        f"form_key='{key}' (normalized='{normalized_key}') value='{value}'"
                    )
                return value
    
    # Pass 2: fuzzy contains-all-fragments fallback.
    for key, normalized_key, value in normalized_items:
        if all(frag in normalized_key for frag in fragments):
            if debug:
                print(f"    [FORM LOOKUP] ✓ MATCH: form_key='{key}' (normalized='{normalized_key}') value='{value}'")
            return value
    
    if debug:
        print(f"    [FORM LOOKUP] ✗ NO MATCH for fragments {fragments}")
        # Show available keys that partially match (helpful for debugging)
        if fragments:
            partial_matches = []
            for key, normalized_key, _ in normalized_items:
                if any(frag in normalized_key for frag in fragments):
                    partial_matches.append((key, normalized_key))
            if partial_matches:
                print(f"    [FORM LOOKUP] Partial matches (1+ fragments): {[m[0] for m in partial_matches[:5]]}")
    
    return None


def _debug_form_values(form_values: dict[str, str], limit: int = 200) -> None:
    """Print a comprehensive view of available form keys for alias tuning."""
    if not form_values:
        print("[PDF FORM FIELDS] total=0")
        return
    keys = sorted(form_values.keys())
    print(f"[PDF FORM FIELDS] total={len(keys)}")
    print(f"[PDF FORM FIELDS] ALL KEYS:")
    for i, key in enumerate(keys[:limit], 1):
        value = form_values[key]
        # Truncate long values for readability
        val_display = value[:40] + ("..." if len(value) > 40 else "")
        normalized_key = re.sub(r"[^a-z0-9]+", "", key.lower())
        print(f"  {i:3d}. '{key}' (norm: '{normalized_key}') = '{val_display}'")
    if len(keys) > limit:
        print(f"  ... and {len(keys) - limit} more keys (not shown)")
    print(f"[PDF FORM FIELDS] END")


def _debug_ability_gaps(abilities: list[dict], form_values: dict[str, str]) -> None:
    """Log missing abilities and show which form fields might provide them."""
    expected = ("STR", "DEX", "CON", "INT", "WIS", "CHA")
    present = {str(row.get("ability") or "").upper() for row in abilities}
    missing = [ability for ability in expected if ability not in present]

    print(f"[ABILITY DIAGNOSTIC] parsed_count={len(abilities)} present={sorted(present)} missing={missing}")
    if not missing:
        return

    if not form_values:
        print("[ABILITY DIAGNOSTIC] form_values empty; cannot probe missing abilities")
        return

    for ability in missing:
        full = full_name(ability).lower()
        print(f"  [ABILITY DIAGNOSTIC] probing {ability} ({full})")
        score_probe = (
            _get_form_value(form_values, ability.lower(), "score", debug=True)
            or _get_form_value(form_values, full, "score", debug=True)
            or _get_form_value(form_values, ability.lower(), debug=True)
        )
        mod_probe = (
            _get_form_value(form_values, ability.lower(), "mod", debug=True)
            or _get_form_value(form_values, full, "mod", debug=True)
        )
        print(
            f"  [ABILITY DIAGNOSTIC] {ability} probes: "
            f"score_raw={score_probe!r} score_int={to_int(score_probe)} "
            f"mod_raw={mod_probe!r} mod_int={to_int(mod_probe)}"
        )


_TEMPLATE_LABEL_TOKENS = {
    "SPECIES",
    "CLASS",
    "CLASS & LEVEL",
    "PLAYER NAME",
    "CHARACTER NAME",
    "EXPERIENCE POINTS",
    "BACKGROUND",
    "HIT POINTS",
    "ARMOR CLASS",
    "SPEED",
    "PROFICIENCY BONUS",
    "ABILITY SAVE DC",
    "PASSIVE PERCEPTION",
    "PASSIVE INSIGHT",
    "PASSIVE INVESTIGATION",
    "SPELLCASTING",
    "SPELL SAVE DC",
    "SPELL ATTACK",
    "PAGE REF",
    "SOURCE",
    "PREP SPELL NAME",
    "NAME",
    "QTY",
    "WEIGHT",
    "ATTUNED MAGIC ITEMS",
    "HAIR",
    "SKIN",
    "ABILITY",
    "BONUS",
    "TOOLS",
    "LANGUAGES",
    "TRAITS",
    "IDEALS",
    "BONDS",
    "FLAWS",
}


_SECTION_NOISE_SUBSTRINGS = {
    "HAIRSKIN",
    "ABILITY BONUS",
    "SPELL SAVE",
    "SAVE/ATK",
    "COMP DURATION",
    "PERSONALITY TRAITS",
    "ALLIES & ORGANIZATIONS",
    "ADDITIONAL FEATURES",
    "TREASURE",
    "CHARACTER APPEARANCE",
}


def _looks_like_template_label(value: str | None) -> bool:
    if value is None:
        return True
    text = str(value).strip()
    if not text:
        return True

    upper = text.upper()
    if upper in _TEMPLATE_LABEL_TOKENS:
        return True

    # Composite label lines from template-only extraction, e.g.
    # "CLASS & LEVEL PLAYER NAME" or "CHARACTER NAME EXPERIENCE POINTSBACKGROUND".
    token_hits = sum(1 for token in _TEMPLATE_LABEL_TOKENS if token in upper)
    if token_hits >= 2:
        return True

    if re.fullmatch(r"[A-Z0-9\s&/'\-\.]+", text) and token_hits >= 1:
        return True

    return False


def apply_form_fallbacks(character: dict, abilities: list[dict], form_values: dict[str, str]) -> None:
    """Patch missing parsed values using PDF AcroForm/widget data when present."""
    if not form_values:
        return

    if _looks_like_template_label(character.get("name")):
        character["name"] = _get_form_value(form_values, "character", "name") or character.get("name")
    if _looks_like_template_label(character.get("player_name")):
        character["player_name"] = _get_form_value(form_values, "player", "name") or character.get("player_name")
    if _looks_like_template_label(character.get("class_level")):
        character["class_level"] = _get_form_value(form_values, "class") or character.get("class_level")
    if _looks_like_template_label(character.get("species")):
        character["species"] = _get_form_value(form_values, "species") or _get_form_value(form_values, "race") or character.get("species")
    if _looks_like_template_label(character.get("background")):
        character["background"] = _get_form_value(form_values, "background") or character.get("background")

    # Core stat fallbacks with detailed diagnostics
    if character.get("armor_class") is None:
        ac_value = (
            _get_form_value(form_values, "armor", "class", debug=PDF_PARSER_DEBUG)
            or _get_form_value(form_values, "ac", debug=PDF_PARSER_DEBUG)
        )
        character["armor_class"] = to_int(ac_value)
    
    if character.get("hit_points") is None:
        character["hit_points"] = to_int(_get_form_value(form_values, "hit", "point", "max") or _get_form_value(form_values, "max", "hp"))
    if character.get("current_hp") is None:
        character["current_hp"] = coerce_hp_value(
            _get_form_value(form_values, "hit", "point", "current") or _get_form_value(form_values, "current", "hp"),
            fallback=character.get("hit_points"),
        )
    if character.get("speed") is None:
        character["speed"] = to_int(_get_form_value(form_values, "speed"))
    
    if character.get("proficiency_bonus") is None:
        prof_value = (
            _get_form_value(form_values, "prof", "bonus", debug=PDF_PARSER_DEBUG)
            or _get_form_value(form_values, "proficiency", debug=PDF_PARSER_DEBUG)
        )
        character["proficiency_bonus"] = to_int(prof_value)
    
    if character.get("initiative_bonus") is None:
        init_value = _get_form_value(form_values, "init", debug=PDF_PARSER_DEBUG)
        character["initiative_bonus"] = to_int(init_value)

    if PDF_PARSER_DEBUG:
        _debug_ability_gaps(abilities, form_values)

    if abilities:
        return

    # Build ability scores from form fields only when text parsing found none.
    found: list[dict] = []
    for ability in ("STR", "DEX", "CON", "INT", "WIS", "CHA"):
        score_text = (
            _get_form_value(form_values, ability.lower(), "score")
            or _get_form_value(form_values, full_name(ability).lower(), "score")
            or _get_form_value(form_values, ability.lower())
        )
        mod_text = (
            _get_form_value(form_values, ability.lower(), "mod")
            or _get_form_value(form_values, full_name(ability).lower(), "mod")
        )

        score = to_int(score_text)
        if score is None:
            continue
        modifier = to_int(mod_text)
        if modifier is None:
            modifier = (score - 10) // 2
        found.append(
            {
                "character_id": character.get("character_id"),
                "ability": ability,
                "score": score,
                "modifier": modifier,
            }
        )

    if found:
        abilities.extend(found)


def normalize_lines(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)
    return lines


def find_first(patterns: Iterable[str], text: str) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.MULTILINE)
        if match:
            return match.group(1).strip()
    return None


def to_int(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"-?\d+", value)
    return int(match.group(0)) if match else None


def coerce_hp_value(raw_value: str | int | None, fallback: int | None = None) -> int | None:
    """Normalize HP-ish values from PDF text into integers.

    D&D Beyond exports sometimes contain placeholders like "--" for current HP.
    Downstream game logic expects numeric HP, so we coerce when possible and
    fall back to max HP (or caller-provided fallback) when missing.
    """
    if isinstance(raw_value, int):
        return raw_value
    parsed = to_int(str(raw_value) if raw_value is not None else None)
    if parsed is not None:
        return parsed
    return fallback


def parse_ability_scores(text: str, character_id: str) -> list[dict]:
    rows: list[dict] = []
    seen: set[str] = set()

    for ability in ("STR", "DEX", "CON", "INT", "WIS", "CHA"):
        # Common patterns like "STR 16 (+3)" or "Strength 16"
        pattern = rf"(?:{ability}|{full_name(ability)})\s*(\d{{1,2}})(?:\s*\(([+-]?\d+)\))?"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if not match:
            continue

        score = int(match.group(1))
        modifier = int(match.group(2)) if match.group(2) else (score - 10) // 2
        key = f"{ability}:{score}:{modifier}"
        if key in seen:
            continue
        seen.add(key)

        rows.append(
            {
                "character_id": character_id,
                "ability": ability,
                "score": score,
                "modifier": modifier,
            }
        )

    return rows


def full_name(abbrev: str) -> str:
    return {
        "STR": "Strength",
        "DEX": "Dexterity",
        "CON": "Constitution",
        "INT": "Intelligence",
        "WIS": "Wisdom",
        "CHA": "Charisma",
    }[abbrev]


def extract_section(lines: list[str], start_keywords: tuple[str, ...], stop_keywords: tuple[str, ...]) -> list[str]:
    start_idx = None
    for i, line in enumerate(lines):
        if any(k.lower() in line.lower() for k in start_keywords):
            start_idx = i + 1
            break
    if start_idx is None:
        return []

    out: list[str] = []
    for line in lines[start_idx:]:
        if any(k.lower() in line.lower() for k in stop_keywords):
            break
        if len(line) > 2:
            out.append(line)
    return out


def clean_section_lines(section_lines: list[str], identity: dict[str, str | None]) -> list[str]:
    noisy_exact = {
        "SPECIES",
        "CLASS & LEVEL",
        "PLAYER NAME",
        "CHARACTER NAME",
        "EXPERIENCE POINTS",
        "BACKGROUND",
        "CP",
        "SP",
        "EP",
        "GP",
        "PP",
        "NAME",
        "QTY",
        "WEIGHT",
        "ATTUNED MAGIC ITEMS",
        "WEIGHT CARRIED",
        "ENCUMBERED",
        "PUSH/DRAG/LIFT",
    }
    identity_values = {value for value in identity.values() if value}

    cleaned: list[str] = []
    for line in section_lines:
        upper = line.upper()
        if line in noisy_exact:
            continue
        if line in identity_values:
            continue
        if re.search(r"Wizards of the Coast", line, flags=re.IGNORECASE):
            continue
        if _looks_like_template_label(line):
            continue
        if any(token in upper for token in _SECTION_NOISE_SUBSTRINGS):
            continue
        if re.fullmatch(r"[A-Z\s/&\-]{4,}", line) and len(line.split()) <= 4:
            continue
        if re.fullmatch(r"\(Milestone\)", line):
            continue
        cleaned.append(line)
    return cleaned


def extract_feature_lines_from_markers(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if line.startswith("=== "):
            if any(skip in line for skip in ("ARMOR", "WEAPONS", "TOOLS", "LANGUAGES", "ACTIONS")):
                continue
            out.append(line)
            continue
        if line.startswith("* "):
            out.append(line)
    return out


def extract_inventory_triplets(lines: list[str]) -> list[str]:
    out: list[str] = []
    currency_labels = {"CP", "SP", "EP", "GP", "PP"}
    blocked_inventory_labels = {
        "WEIGHT CARRIED",
        "ENCUMBERED",
        "PUSH/DRAG/LIFT",
        "ATTUNED MAGIC ITEMS",
        "ATTUNED MAGIC ITEMS QTY WEIGHT",
        "NAME QTY WEIGHT NAME QTY WEIGHT",
        "NAME QTY WEIGHT",
    }
    for i in range(len(lines) - 2):
        name = lines[i]
        qty = lines[i + 1]
        weight = lines[i + 2]
        if not re.fullmatch(r"\d+", qty):
            continue
        if not re.fullmatch(r"(?:\d+\s*lb\.|--)", weight, flags=re.IGNORECASE):
            continue
        if name in {"NAME", "QTY", "WEIGHT", "ATTUNED MAGIC ITEMS"}:
            continue
        if name.upper() in currency_labels:
            continue
        if name.upper() in blocked_inventory_labels:
            continue
        if "QTY WEIGHT" in name.upper():
            continue
        if any(token in name.upper() for token in _SECTION_NOISE_SUBSTRINGS):
            continue
        if re.fullmatch(r"\d+(?:\.\d+)?", name):
            continue
        if "ft." in name:
            continue
        if re.search(r"Wizards of the Coast", name, flags=re.IGNORECASE):
            continue
        out.append(f"{name} | qty={qty} | weight={weight}")
    return out


def extract_inventory_triplets_from_form_values(form_values: dict[str, str]) -> list[str]:
    if not form_values:
        return []

    normalized: dict[str, str] = {}
    for key, value in form_values.items():
        norm = re.sub(r"[^a-z0-9]+", "", str(key).lower())
        if norm:
            normalized[norm] = str(value).strip()

    blocked_names = {
        "NAME",
        "QTY",
        "WEIGHT",
        "WEIGHT CARRIED",
        "ENCUMBERED",
        "PUSH/DRAG/LIFT",
        "ATTUNED MAGIC ITEMS",
        "NAME QTY WEIGHT",
        "NAME QTY WEIGHT NAME QTY WEIGHT",
        "ATTUNED MAGIC ITEMS QTY WEIGHT",
    }

    indexes: set[int] = set()
    for norm_key in normalized:
        m = re.fullmatch(r"eqname(\d+)", norm_key)
        if m:
            indexes.add(int(m.group(1)))

    out: list[str] = []
    for idx in sorted(indexes):
        name = normalized.get(f"eqname{idx}", "").strip()
        if not name:
            continue
        if name.upper() in blocked_names:
            continue

        qty_val = to_int(normalized.get(f"eqqty{idx}"))
        qty = qty_val if qty_val is not None else 1
        weight = normalized.get(f"eqweight{idx}", "--").strip() or "--"

        out.append(f"{name} | qty={qty} | weight={weight}")

    return out


def synthesize_inventory_triplets(pages: list[str], form_values: dict[str, str]) -> list[str]:
    full_text_lines = normalize_lines("\n\n".join(pages))
    inventory_scope_lines = select_inventory_lines_from_pages(pages)

    text_triplets = extract_inventory_triplets(inventory_scope_lines or full_text_lines)
    form_triplets = extract_inventory_triplets_from_form_values(form_values)

    # Prefer the denser source, then merge the other source to avoid dropping rows.
    primary = form_triplets if len(form_triplets) >= len(text_triplets) else text_triplets
    secondary = text_triplets if primary is form_triplets else form_triplets

    merged: list[str] = []
    seen: set[str] = set()
    for item in primary + secondary:
        key = re.sub(r"\s+", " ", item.strip().lower())
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)

    return merged


def extract_spells_from_pages(pages: list[str], character_id: str) -> list[dict]:
    spell_rows: list[dict] = []
    order = 1

    ignore_exact = {
        "SPELLS",
        "NOTES",
        "SPELLCASTING",
        "CLASS",
        "SPELLCASTING ABILITY",
        "SPELL SAVE DC",
        "SPELL ATTACK",
        "BONUS",
        "PAGE REF",
        "SOURCE",
        "SAVE/ATK TIME",
        "RANGE",
        "COMP DURATION",
        "PREP SPELL NAME",
        "WARLOCK",
        "CHA",
    }

    known_class_names = {
        "Artificer",
        "Barbarian",
        "Bard",
        "Cleric",
        "Druid",
        "Fighter",
        "Monk",
        "Paladin",
        "Ranger",
        "Rogue",
        "Sorcerer",
        "Warlock",
        "Wizard",
    }

    known_spell_metadata_labels = {
        "Fighting Style",
    }

    def normalize_spell_name(line: str) -> str | None:
        candidate = line.strip()
        if not candidate:
            return None

        prepared_match = re.match(r"^[OP]\s+(.+)$", candidate)
        if prepared_match:
            candidate = prepared_match.group(1).strip()

        if candidate in known_class_names:
            return None
        if candidate in known_spell_metadata_labels:
            return None
        if candidate.startswith("===") or candidate.endswith("==="):
            return None
        if re.fullmatch(r"\(.*\)", candidate):
            return None
        if re.fullmatch(r"\d+\s+Slots\s+.*", candidate, flags=re.IGNORECASE):
            return None
        if candidate == "--":
            return None
        if candidate.endswith(" --"):
            return None
        if re.fullmatch(r"\d+(?:BA|A|R|M|H)", candidate, flags=re.IGNORECASE):
            return None
        if candidate in {"Self", "Touch", "Instantaneous"}:
            return None
        if re.fullmatch(r"\d+\s*(?:ft\.|feet|foot)", candidate, flags=re.IGNORECASE):
            return None
        if re.fullmatch(r"(?:Concentration,\s*up to\s*)?\d+\s+(?:minute|minutes|hour|hours|day|days)", candidate, flags=re.IGNORECASE):
            return None
        if re.fullmatch(r"[VSM,\s]+", candidate, flags=re.IGNORECASE):
            return None
        if re.match(r"^[A-Z]{2,}-?\d{2,}", candidate):
            return None
        if not re.search(r"[A-Za-z]", candidate):
            return None

        return candidate

    for page_text in pages:
        page_lines = normalize_lines(page_text)
        if "PREP SPELL NAME" not in page_lines and "SPELLS" not in page_lines:
            continue

        # Prefer rows after the table header when available.
        start_idx = 0
        if "PREP SPELL NAME" in page_lines:
            start_idx = page_lines.index("PREP SPELL NAME") + 1
        elif "SPELLS" in page_lines:
            start_idx = page_lines.index("SPELLS") + 1

        for line in page_lines[start_idx:]:
            upper = line.upper()
            if upper in ignore_exact:
                continue
            if re.search(r"Wizards of the Coast", line, flags=re.IGNORECASE):
                continue
            if re.fullmatch(r"[+-]?\d+", line):
                continue
            if re.fullmatch(r"\d+d\d+", line, flags=re.IGNORECASE):
                continue
            if re.fullmatch(r"[A-Z]{1,3}", line):
                continue

            # Keep only lines that look like spell names or spell row text.
            normalized_name = normalize_spell_name(line)
            if normalized_name is None:
                continue

            spell_rows.append(
                {
                    "character_id": character_id,
                    "spell_order": order,
                    "spell_text": normalized_name,
                }
            )
            order += 1

    return spell_rows


def parse_proficiencies_and_actions(first_page_lines: list[str]) -> dict:
    armor: list[str] = []
    weapons: list[str] = []
    tools: list[str] = []
    languages: list[str] = []
    defenses: list[str] = []
    attacks: list[dict] = []
    standard_actions = None

    marker_map = {
        "=== ARMOR ===": armor,
        "=== WEAPONS ===": weapons,
        "=== TOOLS ===": tools,
        "=== LANGUAGES ===": languages,
    }

    for i, line in enumerate(first_page_lines):
        if line in marker_map and i + 1 < len(first_page_lines):
            marker_map[line].append(first_page_lines[i + 1])

    for i, line in enumerate(first_page_lines):
        if line.startswith("Immunities"):
            defenses.append(line)
            if i + 1 < len(first_page_lines):
                defenses.append(first_page_lines[i + 1])
            if i + 2 < len(first_page_lines):
                defenses.append(first_page_lines[i + 2])
            break

    if "=== ACTIONS ===" in first_page_lines:
        start = first_page_lines.index("=== ACTIONS ===") + 1
        action_lines: list[str] = []
        attack_names = {"Dagger", "Sickle", "Unarmed Strike"}
        i = start
        while i < len(first_page_lines):
            if first_page_lines[i] in attack_names:
                break
            action_lines.append(first_page_lines[i])
            i += 1
        if action_lines:
            standard_actions = " ".join(action_lines)

    i = 0
    attack_names = {"Dagger", "Sickle", "Unarmed Strike"}
    while i < len(first_page_lines):
        name = first_page_lines[i]
        if name not in attack_names:
            i += 1
            continue

        hit_bonus = None
        damage = None
        props = None

        if i + 1 < len(first_page_lines) and re.fullmatch(r"[+-]\d+", first_page_lines[i + 1]):
            hit_bonus = int(first_page_lines[i + 1])
        if i + 2 < len(first_page_lines):
            damage = first_page_lines[i + 2]
        if i + 3 < len(first_page_lines) and first_page_lines[i + 3] not in attack_names:
            props = first_page_lines[i + 3]

        attacks.append(
            {
                "name": name,
                "hit_bonus": hit_bonus,
                "damage": damage,
                "properties": props,
            }
        )
        i += 1

    return {
        "armor": armor,
        "weapons": weapons,
        "tools": tools,
        "languages": languages,
        "defenses": [d for d in defenses if d],
        "standard_actions": standard_actions,
        "attacks": attacks,
    }


def parse_saves_and_skills(first_page_lines: list[str], abilities: list[dict]) -> dict:
    ability_mod_by_key = {row["ability"]: row["modifier"] for row in abilities}
    save_abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]

    immunity_idx = None
    for i, line in enumerate(first_page_lines):
        if line.startswith("Immunities"):
            immunity_idx = i
            break

    signed_before = []
    if immunity_idx is not None:
        for line in first_page_lines[:immunity_idx]:
            if re.fullmatch(r"[+-]\d+", line):
                signed_before.append(int(line))

    save_bonuses = signed_before[-6:] if len(signed_before) >= 6 else []
    saving_throws = []
    for idx, ability in enumerate(save_abilities):
        bonus = save_bonuses[idx] if idx < len(save_bonuses) else None
        mod = ability_mod_by_key.get(ability)
        proficient = (bonus is not None and mod is not None and bonus > mod) if bonus is not None else None
        saving_throws.append({"ability": ability, "bonus": bonus, "proficient": proficient})

    skill_names = [
        ("Acrobatics", "DEX"),
        ("Animal Handling", "WIS"),
        ("Arcana", "INT"),
        ("Athletics", "STR"),
        ("Deception", "CHA"),
        ("History", "INT"),
        ("Insight", "WIS"),
        ("Intimidation", "CHA"),
        ("Investigation", "INT"),
        ("Medicine", "WIS"),
        ("Nature", "INT"),
        ("Perception", "WIS"),
        ("Performance", "CHA"),
        ("Persuasion", "CHA"),
        ("Religion", "INT"),
        ("Sleight of Hand", "DEX"),
        ("Stealth", "DEX"),
        ("Survival", "WIS"),
    ]

    signed_after = []
    if immunity_idx is not None:
        for line in first_page_lines[immunity_idx:]:
            if re.fullmatch(r"[+-]\d+", line):
                signed_after.append(int(line))

    skill_bonuses = signed_after[:18] if len(signed_after) >= 18 else []
    skills = []
    for idx, (name, ability) in enumerate(skill_names):
        bonus = skill_bonuses[idx] if idx < len(skill_bonuses) else None
        mod = ability_mod_by_key.get(ability)
        proficient = (bonus is not None and mod is not None and bonus > mod) if bonus is not None else None
        skills.append(
            {
                "name": name,
                "ability": ability,
                "bonus": bonus,
                "proficient": proficient,
                "expertise": False if proficient is not None else None,
            }
        )

    return {
        "saving_throws": saving_throws,
        "skills": skills,
    }


def apply_form_fallbacks_to_saves_and_skills(
    parsed: dict,
    form_values: dict[str, str],
    abilities: list[dict] | None = None,
) -> None:
    if not form_values:
        return

    save_name_by_ability = {
        "STR": "strength",
        "DEX": "dexterity",
        "CON": "constitution",
        "INT": "intelligence",
        "WIS": "wisdom",
        "CHA": "charisma",
    }

    skill_aliases = {
        "Animal Handling": [("animal",), ("animal", "handling")],
        "Sleight of Hand": [("sleightofhand",), ("sleight", "hand")],
    }

    ability_mod_by_key = {
        row.get("ability"): row.get("modifier")
        for row in (abilities or [])
        if row.get("ability")
    }

    def find_first_numeric_form_value(*fragment_sets: tuple[str, ...]) -> int | None:
        for fragments in fragment_sets:
            value = _get_form_value(form_values, *fragments)
            parsed_value = to_int(value)
            if parsed_value is not None:
                return parsed_value
        return None

    for row in parsed.get("saving_throws", []):
        if row.get("bonus") is not None:
            continue
        ability = str(row.get("ability") or "").upper()
        if not ability:
            continue
        full = save_name_by_ability.get(ability, "")
        parsed_bonus = find_first_numeric_form_value(
            (full, "saving", "throw"),
            (ability.lower(), "save"),
            (full, "save"),
            ("st", full),
            ("st", ability.lower()),
        )
        if parsed_bonus is not None:
            row["bonus"] = parsed_bonus

    for row in parsed.get("skills", []):
        if row.get("bonus") is not None:
            continue
        name = str(row.get("name") or "").lower()
        words = [w for w in re.split(r"\s+", name) if w and w not in {"of", "and"}]
        fragment_sets: list[tuple[str, ...]] = []
        if words:
            fragment_sets.append(tuple(words))
        fragment_sets.extend(skill_aliases.get(str(row.get("name") or ""), []))
        if words:
            fragment_sets.append((words[0], "skill"))

        parsed_bonus = find_first_numeric_form_value(*fragment_sets)
        if parsed_bonus is not None:
            row["bonus"] = parsed_bonus

    for row in parsed.get("saving_throws", []):
        bonus = row.get("bonus")
        ability = row.get("ability")
        mod = ability_mod_by_key.get(ability)
        if bonus is not None and mod is not None:
            row["proficient"] = bonus > mod

    for row in parsed.get("skills", []):
        bonus = row.get("bonus")
        ability = row.get("ability")
        mod = ability_mod_by_key.get(ability)
        if bonus is not None and mod is not None:
            row["proficient"] = bonus > mod
            if row.get("expertise") is None:
                row["expertise"] = False


def select_feature_lines_from_pages(pages: list[str]) -> list[str]:
    lines: list[str] = []
    for page_text in pages:
        page_lines = normalize_lines(page_text)
        page_upper = [ln.upper() for ln in page_lines]
        has_feature_markers = any(
            marker in page_upper
            for marker in ("FEATURES & TRAITS", "FEATURES AND TRAITS", "=== ACTIONS ===")
        )
        if not has_feature_markers:
            continue
        lines.extend(page_lines)
    return lines


def select_inventory_lines_from_pages(pages: list[str]) -> list[str]:
    lines: list[str] = []
    for page_text in pages:
        page_lines = normalize_lines(page_text)
        page_upper = [ln.upper() for ln in page_lines]
        has_inventory_markers = "EQUIPMENT" in page_upper or "WEIGHT CARRIED" in page_upper
        if not has_inventory_markers:
            continue
        lines.extend(page_lines)
    return lines

def parse_inventory_summary_and_roleplay(pages: list[str]) -> dict:
    currency = {"cp": None, "sp": None, "ep": None, "gp": None, "pp": None}
    capacity = {"weight_carried": None, "encumbered": None, "push_drag_lift": None}
    roleplay = {
        "alignment": None,
        "size": None,
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
    }

    for page_text in pages:
        lines = normalize_lines(page_text)
        if "EQUIPMENT" in lines and "WEIGHT CARRIED" in lines:
            # Preferred path: parse explicit currency labels if present.
            labeled_currency: dict[str, int] = {}
            for i, line in enumerate(lines):
                upper = line.upper()
                if upper in {"CP", "SP", "EP", "GP", "PP"} and i + 1 < len(lines):
                    next_value = to_int(lines[i + 1])
                    if next_value is not None:
                        labeled_currency[upper.lower()] = next_value
                    continue

                inline_match = re.fullmatch(r"(CP|SP|EP|GP|PP)\s*[:\-]?\s*(\d+)", upper)
                if inline_match:
                    labeled_currency[inline_match.group(1).lower()] = int(inline_match.group(2))

            if labeled_currency:
                for key in ("cp", "sp", "ep", "gp", "pp"):
                    if key in labeled_currency:
                        currency[key] = labeled_currency[key]

            ints = [int(line) for line in lines if re.fullmatch(r"\d+", line)]
            if len(ints) >= 5 and all(currency[key] is None for key in ("cp", "sp", "ep", "gp", "pp")):
                # CP, EP, PP, GP, SP in this export order.
                currency["cp"] = ints[0]
                currency["ep"] = ints[1]
                currency["pp"] = ints[2]
                currency["gp"] = ints[3]
                currency["sp"] = ints[4]

            weights = [line for line in lines if re.fullmatch(r"\d+\s*lb\.", line, flags=re.IGNORECASE)]
            if len(weights) >= 3:
                capacity["weight_carried"] = weights[0]
                capacity["encumbered"] = weights[1]
                capacity["push_drag_lift"] = weights[2]

        if "ALIGNMENT" in lines and "PERSONALITY TRAITS" in lines:
            if len(lines) >= 2:
                # In this export, populated values tend to appear at the end.
                for line in reversed(lines):
                    if line in {"Medium", "Small", "Large", "Tiny", "Huge", "Gargantuan"}:
                        roleplay["size"] = line
                        break
                alignments = {
                    "Lawful Good", "Neutral Good", "Chaotic Good",
                    "Lawful Neutral", "Neutral", "Chaotic Neutral",
                    "Lawful Evil", "Neutral Evil", "Chaotic Evil",
                }
                for line in reversed(lines):
                    if line in alignments:
                        roleplay["alignment"] = line
                        break

    return {
        "currency": currency,
        "capacity": capacity,
        "roleplay": roleplay,
    }


def parse_spellcasting_metadata(pages: list[str]) -> dict:
    out = {
        "class": None,
        "ability": None,
        "spell_save_dc": None,
        "spell_attack_bonus": None,
    }
    for page_text in pages:
        lines = normalize_lines(page_text)
        if "SPELLCASTING" not in lines or "SPELL ATTACK" not in lines:
            continue

        # Typical sequence in this export near the bottom: CHA, 9, +1, Warlock
        for i in range(len(lines) - 3):
            if re.fullmatch(r"[A-Z]{3}", lines[i]) and re.fullmatch(r"\d+", lines[i + 1]) and re.fullmatch(r"[+-]\d+", lines[i + 2]):
                out["ability"] = lines[i]
                out["spell_save_dc"] = int(lines[i + 1])
                out["spell_attack_bonus"] = int(lines[i + 2])
                if re.fullmatch(r"[A-Za-z][A-Za-z\s]+", lines[i + 3]):
                    out["class"] = lines[i + 3]
                return out
    return out


def parse_identity_block(first_page_lines: list[str]) -> dict[str, str | None]:
    for i, line in enumerate(first_page_lines):
        if line.endswith("'s Character") and i + 4 < len(first_page_lines):
            return {
                "name": line,
                "class_level": first_page_lines[i + 1],
                "player_name": first_page_lines[i + 2],
                "species": first_page_lines[i + 3],
                "background": first_page_lines[i + 4],
            }

    text = "\n".join(first_page_lines)
    return {
        "name": find_first((r"\bCharacter Name\s*[:\-]\s*([^\n]+)", r"\bName\s*[:\-]\s*([^\n]+)"), text),
        "class_level": find_first((r"\bClass\s*&\s*Level\s*[:\-]?\s*([^\n]+)",), text),
        "player_name": find_first((r"\bPlayer Name\s*[:\-]?\s*([^\n]+)",), text),
        "species": find_first((r"\bSpecies\s*[:\-]?\s*([^\n]+)",), text),
        "background": find_first((r"\bBackground\s*[:\-]?\s*([^\n]+)",), text),
    }


def parse_ability_scores_from_lines(first_page_lines: list[str], character_id: str) -> list[dict]:
    identity = parse_identity_block(first_page_lines)
    start_idx = 0

    if identity["background"] and identity["background"] in first_page_lines:
        start_idx = first_page_lines.index(identity["background"]) + 1

    # Skip experience marker lines like "(Milestone)".
    while start_idx < len(first_page_lines) and first_page_lines[start_idx].startswith("("):
        start_idx += 1

    pairs: list[tuple[int, int]] = []
    i = start_idx
    while i + 1 < len(first_page_lines) and len(pairs) < 6:
        score_line = first_page_lines[i]
        mod_line = first_page_lines[i + 1]
        if re.fullmatch(r"\d{1,2}", score_line) and re.fullmatch(r"[+-]\d+", mod_line):
            pairs.append((int(score_line), int(mod_line)))
            i += 2
            continue
        i += 1

    if len(pairs) == 6:
        abilities = ["STR", "DEX", "CON", "INT", "WIS", "CHA"]
        return [
            {
                "character_id": character_id,
                "ability": ability,
                "score": score,
                "modifier": mod,
            }
            for ability, (score, mod) in zip(abilities, pairs)
        ]

    return []


def parse_core_from_first_page_lines(first_page_lines: list[str]) -> dict[str, int | str | None]:
    speed = None
    proficiency_bonus = None
    armor_class = None
    max_hp = None
    current_hp = None
    temp_hp = None
    hit_dice = None
    initiative_bonus = None
    ability_save_dc = None
    passive_perception = None
    passive_insight = None
    passive_investigation = None
    senses: list[dict] = []

    for i, line in enumerate(first_page_lines):
        sense_match = re.search(r"([A-Za-z]+)\s+(\d+)\s*ft\.", line)
        if sense_match:
            senses.append({"name": sense_match.group(1), "range_ft": int(sense_match.group(2))})
            unsigned_before_sense = []
            for j in range(max(0, i - 8), i):
                if re.fullmatch(r"\d{1,2}", first_page_lines[j]):
                    unsigned_before_sense.append(int(first_page_lines[j]))
            if len(unsigned_before_sense) >= 3:
                passive_perception = unsigned_before_sense[-3]
                passive_insight = unsigned_before_sense[-2]
                passive_investigation = unsigned_before_sense[-1]

        speed_match = re.search(r"(\d+)\s*ft\.\s*\(Walking\)", line)
        if speed_match:
            speed = int(speed_match.group(1))

            # Typical sequence around this area: AC, proficiency, speed, max hp, current hp, hit dice.
            for back in range(1, 6):
                if i - back >= 0 and re.fullmatch(r"[+-]\d+", first_page_lines[i - back]):
                    proficiency_bonus = int(first_page_lines[i - back])
                    if i - back - 1 >= 0 and re.fullmatch(r"\d{1,3}", first_page_lines[i - back - 1]):
                        armor_class = int(first_page_lines[i - back - 1])
                    if i - back - 2 >= 0 and re.fullmatch(r"[+-]\d+", first_page_lines[i - back - 2]):
                        initiative_bonus = int(first_page_lines[i - back - 2])
                    break

            if i + 1 < len(first_page_lines) and re.fullmatch(r"\d{1,3}", first_page_lines[i + 1]):
                max_hp = int(first_page_lines[i + 1])

            if i + 2 < len(first_page_lines):
                current_hp = first_page_lines[i + 2]

            if i + 2 < len(first_page_lines) and first_page_lines[i + 2] not in {"--", "-"}:
                temp_hp = to_int(first_page_lines[i + 2])

            if i + 3 < len(first_page_lines) and re.fullmatch(r"\d+d\d+", first_page_lines[i + 3]):
                hit_dice = first_page_lines[i + 3]
            break

    return {
        "speed": speed,
        "proficiency_bonus": proficiency_bonus,
        "armor_class": armor_class,
        "max_hp": max_hp,
        "current_hp": current_hp,
        "temp_hp": temp_hp,
        "hit_dice": hit_dice,
        "initiative_bonus": initiative_bonus,
        "ability_save_dc": ability_save_dc,
        "passive_perception": passive_perception,
        "passive_insight": passive_insight,
        "passive_investigation": passive_investigation,
        "senses": senses,
    }


def parse_character_tables(pdf_path: Path) -> dict:
    pages = extract_text_by_page(pdf_path)
    form_values = extract_pdf_form_values(pdf_path)

    if PDF_PARSER_DEBUG:
        print("\n" + "=" * 80)
        print("PDF PARSING START")
        print("=" * 80)
        _debug_form_values(form_values)
        print("=" * 80 + "\n")
    
    full_text = "\n\n".join(pages)
    lines = normalize_lines(full_text)
    first_page_lines = normalize_lines(pages[0]) if pages else []

    character_id = uuid.uuid4().hex

    identity = parse_identity_block(first_page_lines)

    name = identity["name"]

    level = to_int(find_first((r"\b(\d{1,2})\b",), identity["class_level"] or ""))

    core = parse_core_from_first_page_lines(first_page_lines)
    prof_and_actions = parse_proficiencies_and_actions(first_page_lines)

    armor_class = core["armor_class"] or to_int(find_first((r"\bArmor\s+Class\s*[:\-]?\s*(\d+)",), full_text))
    hit_points = core["max_hp"] or to_int(find_first((r"\bHit\s+Points\s*[:\-]?\s*(\d+)",), full_text))
    speed = core["speed"] or to_int(find_first((r"\bSpeed\s*[:\-]?\s*(\d+)",), full_text))
    proficiency_bonus = core["proficiency_bonus"] or to_int(find_first((r"\bProficiency\s+Bonus\s*[:\-]?\s*([+-]?\d+)",), full_text))

    normalized_max_hp = to_int(str(hit_points) if hit_points is not None else None)
    normalized_current_hp = coerce_hp_value(core.get("current_hp"), fallback=normalized_max_hp)

    character = {
        "character_id": character_id,
        "source_file": pdf_path.name,
        "name": name,
        "class_level": identity["class_level"],
        "player_name": identity["player_name"],
        "species": identity["species"],
        "background": identity["background"],
        "level": level,
        "armor_class": armor_class,
        "hit_points": normalized_max_hp,
        "current_hp": normalized_current_hp,
        "hit_dice": core["hit_dice"],
        "speed": speed,
        "proficiency_bonus": proficiency_bonus,
        "initiative_bonus": core.get("initiative_bonus"),
        "ability_save_dc": core.get("ability_save_dc"),
        "temp_hp": core.get("temp_hp"),
        "passive_perception": core.get("passive_perception"),
        "passive_insight": core.get("passive_insight"),
        "passive_investigation": core.get("passive_investigation"),
        "senses": core.get("senses", []),
        "extracted_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    abilities = parse_ability_scores_from_lines(first_page_lines, character_id)
    if abilities and PDF_PARSER_DEBUG:
        print(f"[ABILITY PARSE] source=first_page_lines count={len(abilities)} abilities={[row.get('ability') for row in abilities]}")
    if not abilities:
        abilities = parse_ability_scores(full_text, character_id)
        if PDF_PARSER_DEBUG:
            print(f"[ABILITY PARSE] source=full_text count={len(abilities)} abilities={[row.get('ability') for row in abilities]}")

    apply_form_fallbacks(character, abilities, form_values)

    # Recompute level after fallbacks in case class_level was repaired from form fields.
    if character.get("level") is None:
        character["level"] = to_int(find_first((r"\b(\d{1,2})\b",), str(character.get("class_level") or "")))

    # Keep HP coherent when one side is present.
    if character.get("hit_points") is not None and character.get("current_hp") is None:
        character["current_hp"] = character.get("hit_points")

    saves_and_skills = parse_saves_and_skills(first_page_lines, abilities)
    apply_form_fallbacks_to_saves_and_skills(saves_and_skills, form_values, abilities)
    inventory_roleplay = parse_inventory_summary_and_roleplay(pages)
    spell_meta = parse_spellcasting_metadata(pages)

    feature_scope_lines = select_feature_lines_from_pages(pages)
    inventory_scope_lines = select_inventory_lines_from_pages(pages)

    feature_lines = extract_section(
        feature_scope_lines or lines,
        start_keywords=("Features & Traits", "Features and Traits"),
        stop_keywords=("Equipment", "Attacks", "Spells"),
    )
    marker_feature_lines = extract_feature_lines_from_markers(feature_scope_lines or lines)
    if marker_feature_lines:
        feature_lines = marker_feature_lines

    feature_lines_cleaned = clean_section_lines(feature_lines, identity)
    if feature_lines_cleaned:
        feature_lines = feature_lines_cleaned
    features = [
        {
            "character_id": character_id,
            "feature_order": i + 1,
            "feature_text": value,
        }
        for i, value in enumerate(feature_lines)
    ]

    inventory_triplets = synthesize_inventory_triplets(pages, form_values)
    inventory_lines = list(inventory_triplets)
    inventory = [
        {
            "character_id": character_id,
            "item_order": i + 1,
            "item_text": value,
        }
        for i, value in enumerate(inventory_lines)
    ]

    spells = extract_spells_from_pages(pages, character_id)

    return {
        "character": character,
        "ability_scores": abilities,
        "saving_throws": saves_and_skills["saving_throws"],
        "skills": saves_and_skills["skills"],
        "proficiencies": {
            "armor": prof_and_actions["armor"],
            "weapons": prof_and_actions["weapons"],
            "tools": prof_and_actions["tools"],
            "languages": prof_and_actions["languages"],
            "defenses": prof_and_actions["defenses"],
        },
        "actions": {
            "standard_actions": prof_and_actions["standard_actions"],
            "attacks": prof_and_actions["attacks"],
        },
        "spellcasting_meta": spell_meta,
        "inventory_summary": {
            "currency": inventory_roleplay["currency"],
            "capacity": inventory_roleplay["capacity"],
        },
        "roleplay": inventory_roleplay["roleplay"],
        "features": features,
        "inventory_items": inventory,
        "spells": spells,
        "raw_pages": pages,
    }


def write_csv(path: Path, rows: list[dict], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k) for k in fieldnames})


def slugify(value: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9]+", "_", value.strip().lower()).strip("_")
    return base or "item"


def parse_attack_damage_and_properties(damage: str | None, properties: str | None) -> tuple[list[dict], str | None]:
    if not damage:
        return [], properties

    text = damage.strip()
    # Example patterns:
    # "1d4+2 Piercing"
    # "1d4+2 Slashing Simple, Light, Nick"
    # "3 Bludgeoning"
    match = re.match(r"^([0-9dD+\-]+)\s+([A-Za-z]+)(?:\s+(.*))?$", text)
    if not match:
        return [{"roll": text, "type": None}], properties

    roll = match.group(1)
    damage_type = match.group(2).lower()
    trailing = match.group(3).strip() if match.group(3) else None
    merged_properties = properties
    if trailing:
        merged_properties = f"{trailing}; {properties}" if properties else trailing

    return [{"roll": roll, "type": damage_type}], merged_properties


def parse_attack_range(name: str, properties: str | None) -> dict:
    props = properties or ""
    if "Range (" in props:
        range_match = re.search(r"Range\s*\((\d+)\s*/\s*(\d+)\)", props, flags=re.IGNORECASE)
        if range_match:
            return {
                "type": "ranged",
                "reach_ft": None,
                "normal_ft": int(range_match.group(1)),
                "long_ft": int(range_match.group(2)),
            }
    if name.lower() == "unarmed strike":
        return {"type": "melee", "reach_ft": 5, "normal_ft": None, "long_ft": None}
    return {"type": "melee", "reach_ft": 5, "normal_ft": None, "long_ft": None}


def build_roll_formula(ability: str | None, include_proficiency: bool) -> str | None:
    if not ability:
        return None
    base = f"1d20 + {ability}"
    return f"{base} + proficiency" if include_proficiency else base


def derive_character_asset_key(class_level: str | None, species: str | None) -> str:
    class_part = slugify((class_level or "adventurer").split()[0])
    species_part = slugify(species or "unknown")
    return f"character.{species_part}.{class_part}"


def derive_item_asset_key(item_name: str | None) -> str:
    return f"item.{slugify(item_name or 'unknown')}"


def derive_spell_asset_key(spell_name: str | None) -> str:
    return f"spell.{slugify(spell_name or 'unknown')}"


def compute_encumbrance_state(capacity: dict) -> dict:
    def lbs_to_int(value: str | int | None) -> int | None:
        if value is None:
            return None
        if isinstance(value, int):
            return value
        m = re.search(r"\d+", value)
        return int(m.group(0)) if m else None

    carried = lbs_to_int(capacity.get("weight_carried"))
    encumbered = lbs_to_int(capacity.get("encumbered"))
    push_drag_lift = lbs_to_int(capacity.get("push_drag_lift"))

    if carried is None or encumbered is None or push_drag_lift is None:
        return {
            "level": None,
            "speed_penalty": None,
            "disadvantage_on": [],
        }

    if carried >= push_drag_lift:
        return {
            "level": "heavily_encumbered",
            "speed_penalty": 20,
            "disadvantage_on": ["ability_checks", "attack_rolls", "dexterity_saves"],
        }
    if carried >= encumbered:
        return {
            "level": "encumbered",
            "speed_penalty": 10,
            "disadvantage_on": ["ability_checks"],
        }
    return {
        "level": "none",
        "speed_penalty": 0,
        "disadvantage_on": [],
    }


def build_master_character_record(tables: dict) -> dict:
    character = tables["character"]
    ability_rows = tables.get("ability_scores", [])
    feature_rows = tables.get("features", [])
    inventory_rows = tables.get("inventory_items", [])
    spell_rows = tables.get("spells", [])
    saving_throws = tables.get("saving_throws", [])
    skills = tables.get("skills", [])
    proficiencies = tables.get("proficiencies", {})
    actions = tables.get("actions", {})
    spell_meta = tables.get("spellcasting_meta", {})
    inventory_summary = tables.get("inventory_summary", {})
    roleplay = tables.get("roleplay", {})

    abilities = {
        "STR": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
        "DEX": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
        "CON": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
        "INT": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
        "WIS": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
        "CHA": {"score": None, "modifier": None, "save_bonus": None, "save_proficient": None},
    }
    for row in ability_rows:
        ability = row.get("ability")
        if ability in abilities:
            abilities[ability]["score"] = row.get("score")
            abilities[ability]["modifier"] = row.get("modifier")

    for row in saving_throws:
        ability = row.get("ability")
        if ability in abilities:
            abilities[ability]["save_bonus"] = row.get("bonus")
            abilities[ability]["save_proficient"] = row.get("proficient")

    enriched_saving_throws = []
    for idx, row in enumerate(saving_throws, 1):
        enriched_saving_throws.append(
            {
                "id": f"save_{idx:03d}_{slugify(row.get('ability') or 'save')}",
                "ability": row.get("ability"),
                "bonus": row.get("bonus"),
                "proficient": row.get("proficient"),
                "roll": {
                    "formula": build_roll_formula(row.get("ability"), bool(row.get("proficient"))),
                    "advantage": None,
                    "disadvantage": None,
                },
            }
        )

    enriched_skills = []
    for idx, row in enumerate(skills, 1):
        enriched_skills.append(
            {
                "id": f"skl_{idx:03d}_{slugify(row.get('name') or 'skill')}",
                "name": row.get("name"),
                "ability": row.get("ability"),
                "bonus": row.get("bonus"),
                "proficient": row.get("proficient"),
                "expertise": row.get("expertise"),
                "roll": {
                    "formula": build_roll_formula(row.get("ability"), bool(row.get("proficient"))),
                    "advantage": None,
                    "disadvantage": None,
                },
            }
        )

    raw_attacks = actions.get("attacks", [])
    standard_actions = actions.get("standard_actions") or ""
    can_dash = "Dash" in standard_actions
    can_disengage = "Disengage" in standard_actions
    can_dodge = "Dodge" in standard_actions
    has_opportunity_attack = "Opportunity Attack" in standard_actions

    spell_slots = {
        str(level): {"max": None, "used": 0, "remaining": None}
        for level in range(1, 10)
    }

    feature_uses = []
    for page_text in tables.get("raw_pages", []):
        page_lines = normalize_lines(page_text)
        for i, line in enumerate(page_lines):
            use_match = re.search(r"(\d+)\s*/\s*(Long Rest|Short Rest)", line, flags=re.IGNORECASE)
            if not use_match:
                continue
            feature_name = None
            for j in range(i - 1, max(-1, i - 6), -1):
                if page_lines[j].startswith("* "):
                    feature_name = page_lines[j].lstrip("* ").strip()
                    break
            feature_uses.append(
                {
                    "id": f"fuse_{len(feature_uses) + 1:03d}_{slugify(feature_name or 'feature_use')}",
                    "feature_name": feature_name,
                    "max_uses": int(use_match.group(1)),
                    "uses_spent": 0,
                    "uses_remaining": int(use_match.group(1)),
                    "recharge": use_match.group(2).title(),
                }
            )

    attacks = []
    for idx, attack in enumerate(raw_attacks, 1):
        name = attack.get("name") or "Attack"
        parsed_damage, merged_properties = parse_attack_damage_and_properties(
            attack.get("damage"),
            attack.get("properties"),
        )
        attack_range = parse_attack_range(name, merged_properties)
        attacks.append(
            {
                "id": f"atk_{idx:03d}_{slugify(name)}",
                "name": name,
                "hit_bonus": attack.get("hit_bonus"),
                "damage": parsed_damage,
                "properties": merged_properties,
                "range": attack_range,
                "targeting": {
                    "mode": "single",
                    "target_side": "enemy",
                    "self_target": False,
                    "aoe": None,
                },
                "roll": {
                    "formula": "1d20 + attack_bonus",
                    "advantage": None,
                    "disadvantage": None,
                },
            }
        )

    attack_names = {a.get("name") for a in attacks if a.get("name")}
    armor_profs = set(proficiencies.get("armor", []))
    equipment_items = []
    for item in [row.get("item_text") for row in inventory_rows]:
        name = item
        qty = None
        weight = None
        parsed = re.match(r"^(.*?)\s*\|\s*qty=(\d+)\s*\|\s*weight=(.*)$", item or "")
        if parsed:
            name = parsed.group(1).strip()
            qty = int(parsed.group(2))
            weight = parsed.group(3).strip()
        is_equipped = name in attack_names or name in armor_profs
        equipment_items.append(
            {
                "id": f"itm_{len(equipment_items) + 1:03d}_{slugify(name or 'item')}",
                "name": name,
                "quantity": qty,
                "weight": weight,
                "equipped": is_equipped,
                "linked_attack": name if name in attack_names else None,
                "category": None,
                "asset_key": derive_item_asset_key(name),
            }
        )

    feature_items = [
        {
            "id": f"feat_{idx:03d}_{slugify((row.get('feature_text') or 'feature')[:40])}",
            "name": row.get("feature_text"),
        }
        for idx, row in enumerate(feature_rows, 1)
    ]

    spell_items = []
    for idx, row in enumerate(spell_rows, 1):
        spell_name = row.get("spell_text")
        spell_items.append(
            {
                "id": f"spl_{idx:03d}_{slugify(spell_name or 'spell')}",
                "name": spell_name,
                "level": None,
                "range": None,
                "duration": None,
                "concentration": None,
                "components": None,
                "casting_time": None,
                "prepared": None,
                "known": None,
                "asset_key": derive_spell_asset_key(spell_name),
                "targeting": {
                    "mode": None,
                    "target_side": None,
                    "self_target": None,
                    "aoe": None,
                },
                "roll": {
                    "formula": None,
                    "advantage": None,
                    "disadvantage": None,
                },
            }
        )

    damage_modifiers = {
        "resistances": [],
        "vulnerabilities": [],
        "immunities": [],
    }
    for defense in proficiencies.get("defenses", []):
        if "Immun" in defense:
            damage_modifiers["immunities"].append(defense)
        elif "Resist" in defense:
            damage_modifiers["resistances"].append(defense)
        elif "Vulnerab" in defense:
            damage_modifiers["vulnerabilities"].append(defense)

    encumbrance_state = compute_encumbrance_state(inventory_summary.get("capacity", {}))

    active_effects = [
        {
            "id": f"eff_{idx:03d}_{slugify(cond)}",
            "name": cond,
            "modifiers": [],
            "duration_rounds": None,
            "concentration": False,
            "source": None,
            "targeting": {
                "mode": "self",
                "target_side": "self",
                "self_target": True,
                "aoe": None,
            },
        }
        for idx, cond in enumerate([], 1)
    ]

    canonical_inventory_items = equipment_items

    entity_id = character.get("character_id")
    character_asset_key = derive_character_asset_key(character.get("class_level"), character.get("species"))

    asset_manifest_refs = {
        "entity_asset_key": character_asset_key,
        "inventory_asset_keys": [
            {"item_id": item.get("id"), "asset_key": item.get("asset_key")}
            for item in canonical_inventory_items
        ],
        "spell_asset_keys": [
            {"spell_id": spell.get("id"), "asset_key": spell.get("asset_key")}
            for spell in spell_items
        ],
    }

    spawn_markers = {
        "preferred_marker_id": "spawn_player",
        "fallback_position": {"x": 0.0, "y": 0.0, "z": 0.0},
        "fallback_rotation": {"x": 0.0, "y": 0.0, "z": 0.0},
    }

    render_registry_binding = {
        "entity_id": entity_id,
        "render_instance_id": None,
        "attachments": [
            {
                "item_id": item.get("id"),
                "socket_name": "hand_r" if item.get("equipped") else None,
                "render_instance_id": None,
            }
            for item in canonical_inventory_items
            if item.get("equipped")
        ],
        "last_sync_tick": 0,
    }

    return {
        "schema_version": "1.0.0",
        "source": {
            "file_name": character.get("source_file"),
            "character_id": character.get("character_id"),
            "extracted_at_utc": character.get("extracted_at_utc"),
        },
        "identity": {
            "character_name": character.get("name"),
            "player_name": character.get("player_name"),
            "class_level": character.get("class_level"),
            "class_name": None,
            "level": character.get("level"),
            "species": character.get("species"),
            "background": character.get("background"),
            "alignment": roleplay.get("alignment"),
            "experience": None,
            "milestone": None,
        },
        "core_stats": {
            "armor_class": character.get("armor_class"),
            "initiative_bonus": character.get("initiative_bonus"),
            "speed_ft": character.get("speed"),
            "proficiency_bonus": character.get("proficiency_bonus"),
            "ability_save_dc": character.get("ability_save_dc"),
            "heroic_inspiration": None,
            "passive_perception": character.get("passive_perception"),
            "passive_insight": character.get("passive_insight"),
            "passive_investigation": character.get("passive_investigation"),
            "senses": character.get("senses", []),
        },
        "hit_points": {
            "max_hp": character.get("hit_points"),
            "current_hp": character.get("current_hp"),
            "temp_hp": character.get("temp_hp"),
            "hit_dice": character.get("hit_dice"),
            "death_saves": {
                "successes": None,
                "failures": None,
            },
        },
        "abilities": abilities,
        "saving_throws": enriched_saving_throws,
        "skills": enriched_skills,
        "proficiencies": {
            "armor": proficiencies.get("armor", []),
            "weapons": proficiencies.get("weapons", []),
            "tools": proficiencies.get("tools", []),
            "languages": proficiencies.get("languages", []),
            "defenses": proficiencies.get("defenses", []),
        },
        "actions": {
            "standard_actions": actions.get("standard_actions"),
            "bonus_actions": [],
            "reactions": [],
            "movement": {
                "walk_ft": character.get("speed"),
                "fly_ft": None,
                "swim_ft": None,
                "climb_ft": None,
                "burrow_ft": None,
                "can_dash": can_dash,
                "can_disengage": can_disengage,
                "can_dodge": can_dodge,
                "has_opportunity_attack": has_opportunity_attack,
            },
            "multiattack": {
                "count": 1,
                "attack_names": [attacks[0]["name"]] if attacks else [],
            },
            "attacks": attacks,
        },
        "features": feature_items,
        "spellcasting": {
            "class": spell_meta.get("class"),
            "ability": spell_meta.get("ability"),
            "spell_save_dc": spell_meta.get("spell_save_dc"),
            "spell_attack_bonus": spell_meta.get("spell_attack_bonus"),
            "preparation_mode": None,
            "slots": spell_slots,
            "spells": spell_items,
            "notes": None,
        },
        "inventory": {
            "currency": inventory_summary.get("currency", {"cp": None, "sp": None, "ep": None, "gp": None, "pp": None}),
            "capacity": inventory_summary.get("capacity", {"weight_carried": None, "encumbered": None, "push_drag_lift": None}),
            "items": canonical_inventory_items,
            "attuned_magic_items": [],
        },
        "roleplay": {
            "gender": roleplay.get("gender"),
            "weight": roleplay.get("weight"),
            "size": roleplay.get("size"),
            "hair": roleplay.get("hair"),
            "skin": roleplay.get("skin"),
            "age": roleplay.get("age"),
            "height": roleplay.get("height"),
            "eyes": roleplay.get("eyes"),
            "faith": roleplay.get("faith"),
            "personality_traits": roleplay.get("personality_traits"),
            "ideals": roleplay.get("ideals"),
            "bonds": roleplay.get("bonds"),
            "flaws": roleplay.get("flaws"),
            "appearance": roleplay.get("appearance"),
            "allies_organizations": roleplay.get("allies_organizations"),
            "backstory": roleplay.get("backstory"),
            "additional_notes": roleplay.get("additional_notes"),
        },
        "conditions": {
            "active_conditions": [],
            "concentration": {
                "active": False,
                "spell": None,
                "dc": None,
            },
            "exhaustion_level": 0,
            "active_effects": active_effects,
        },
        "feature_uses": feature_uses,
        "equipment": {
            "equipped_item_ids": [item["id"] for item in canonical_inventory_items if item.get("equipped")],
            "equipped_armor": next((item["name"] for item in equipment_items if item["name"] in armor_profs), None),
            "equipped_weapons": [item["name"] for item in equipment_items if item["name"] in attack_names],
            "ac_sources": [],
        },
        "damage_modifiers": damage_modifiers,
        "advantage_state": {
            "attack": False,
            "ability_checks": [],
            "saving_throws": [],
            "vs_targets": [],
        },
        "rest_state": {
            "short_rests_taken": 0,
            "long_rest_available": True,
            "hit_dice_remaining": character.get("hit_dice"),
        },
        "encumbrance_state": encumbrance_state,
        "asset_manifest_refs": asset_manifest_refs,
        "spawn_markers": spawn_markers,
        "render_registry_binding": render_registry_binding,
        "combat_state": {
            "in_combat": False,
            "round": 0,
            "turn_index": None,
            "initiative_order": [],
            "active_combatant_id": None,
            "global_advantage": False,
            "global_disadvantage": False,
        },
    }


def split_static_runtime(master_record: dict) -> tuple[dict, dict]:
    static_record = {
        "schema_version": master_record.get("schema_version"),
        "source": master_record.get("source"),
        "identity": master_record.get("identity"),
        "core_stats": master_record.get("core_stats"),
        "abilities": master_record.get("abilities"),
        "saving_throws": master_record.get("saving_throws"),
        "skills": master_record.get("skills"),
        "proficiencies": master_record.get("proficiencies"),
        "actions": master_record.get("actions"),
        "features": master_record.get("features"),
        "spellcasting": master_record.get("spellcasting"),
        "inventory": master_record.get("inventory"),
        "roleplay": master_record.get("roleplay"),
        "damage_modifiers": master_record.get("damage_modifiers"),
        "encumbrance_state": master_record.get("encumbrance_state"),
        "asset_manifest_refs": master_record.get("asset_manifest_refs"),
        "spawn_markers": master_record.get("spawn_markers"),
    }

    runtime_record = {
        "character_id": master_record.get("source", {}).get("character_id"),
        "hit_points": master_record.get("hit_points"),
        "conditions": master_record.get("conditions"),
        "feature_uses": master_record.get("feature_uses"),
        "equipment": master_record.get("equipment"),
        "advantage_state": master_record.get("advantage_state"),
        "rest_state": master_record.get("rest_state"),
        "combat_state": master_record.get("combat_state"),
        "render_registry_binding": master_record.get("render_registry_binding"),
    }

    return static_record, runtime_record


def _parse_signed_int(value: str | int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    m = re.search(r"[+-]?\d+", str(value).strip())
    return int(m.group(0)) if m else None


def _parse_weight_lb(value: str | int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    m = re.search(r"\d+", str(value))
    return int(m.group(0)) if m else None


def _normalize_attack_damage_entry(entry: dict) -> dict:
    roll = str(entry.get("roll") or "").strip()
    damage_type = entry.get("type")

    if re.fullmatch(r"[+-]?\d+", roll):
        return {
            "flat": int(roll),
            "dice": None,
            "formula": roll,
            "type": damage_type,
        }

    return {
        "flat": None,
        "dice": roll or None,
        "formula": roll or None,
        "type": damage_type,
    }


def _to_number(value, default: int = 0) -> int:
    parsed = _parse_signed_int(value)
    return parsed if parsed is not None else default


def _infer_feature_rule_id(feature_name: str) -> str | None:
    name = feature_name.lower()
    if "divine smite" in name:
        return "divine_smite"
    if "lay on hands" in name:
        return "lay_on_hands"
    if "spellcasting" in name:
        return "spell_casting"
    if "channel divinity" in name:
        return "channel_divinity"
    return None


def _build_feature_uses_lookup(feature_uses: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for item in feature_uses:
        name = str(item.get("feature_name") or "").strip()
        if not name:
            continue
        max_uses = item.get("max_uses")
        recharge = str(item.get("recharge") or "").strip()
        if max_uses is None or not recharge:
            continue
        uses_value = f"{max_uses}/{('LR' if recharge.lower().startswith('long') else 'SR')}"
        out[slugify(name)] = uses_value
    return out


def _infer_inventory_slot(item_name: str) -> str | None:
    name = item_name.lower()
    if "shield" in name:
        return "off_hand"
    if any(token in name for token in ("sword", "axe", "mace", "hammer", "javelin", "dagger", "bow", "staff")):
        return "main_hand"
    if any(token in name for token in ("mail", "armor", "robe", "plate", "leather")):
        return "armor"
    return None


def _build_inventory_contract(master_record: dict) -> dict:
    inventory = master_record.get("inventory", {})
    equipment = master_record.get("equipment", {})

    capacity = inventory.get("capacity", {})
    carried_weight = _parse_weight_lb(capacity.get("weight_carried"))
    max_capacity = _parse_weight_lb(capacity.get("encumbered"))

    equipped_item_ids = set(equipment.get("equipped_item_ids") or [])
    items_out = []
    for idx, item in enumerate(inventory.get("items", []), 1):
        item_name = str(item.get("name") or "").strip() or "Unknown Item"
        item_id = slugify(item_name)
        quantity = _to_number(item.get("quantity"), default=1)

        is_equipped = bool(item.get("equipped")) or (item.get("id") in equipped_item_ids)
        slot = _infer_inventory_slot(item_name) if is_equipped else None

        row = {
            "instanceId": f"inv_{idx:03d}",
            "itemId": item_id,
            "qty": quantity,
            "equipped": is_equipped,
        }
        if slot:
            row["slot"] = slot

        items_out.append(row)

    # Ensure at least one weapon-like item is equipped so combat can resolve a default weapon.
    if not any(i.get("equipped") and i.get("slot") == "main_hand" for i in items_out):
        for row in items_out:
            if _infer_inventory_slot(row.get("itemId", "")) == "main_hand":
                row["equipped"] = True
                row["slot"] = "main_hand"
                break

    out = {"items": items_out}
    if max_capacity is not None:
        out["capacity"] = max_capacity
    if carried_weight is not None:
        out["weight"] = carried_weight
    return out


def _normalize_feature_row(feature: dict) -> dict:
    text = str(feature.get("name") or "").strip()
    if text.startswith("* "):
        text = text[2:].strip()

    is_section = text.startswith("===") and text.endswith("===")
    if is_section:
        clean_name = text.strip("=").strip()
        return {
            "id": feature.get("id"),
            "name": clean_name,
            "type": "section",
            "raw": str(feature.get("name") or ""),
        }

    clean_name = text.split(" • ", 1)[0].strip() if " • " in text else text
    return {
        "id": feature.get("id"),
        "name": clean_name,
        "type": "feature",
        "raw": str(feature.get("name") or ""),
    }


def build_engine_entity(master_record: dict) -> dict:
    source = master_record.get("source", {})
    identity = master_record.get("identity", {})
    core = master_record.get("core_stats", {})
    abilities = master_record.get("abilities", {})
    saving_throws = master_record.get("saving_throws", [])
    skills = master_record.get("skills", [])
    actions = master_record.get("actions", {})
    inventory = master_record.get("inventory", {})
    spellcasting = master_record.get("spellcasting", {})
    features = master_record.get("features", [])

    stats = {
        "str": _to_number((abilities.get("STR") or {}).get("score"), default=10),
        "dex": _to_number((abilities.get("DEX") or {}).get("score"), default=10),
        "con": _to_number((abilities.get("CON") or {}).get("score"), default=10),
        "int": _to_number((abilities.get("INT") or {}).get("score"), default=10),
        "wis": _to_number((abilities.get("WIS") or {}).get("score"), default=10),
        "cha": _to_number((abilities.get("CHA") or {}).get("score"), default=10),
    }

    skill_map = {
        slugify(str(row.get("name") or "skill")): {
            "value": _to_number(row.get("bonus"), default=0),
            "proficient": bool(row.get("proficient")),
        }
        for row in skills
    }

    attack_list = []
    for attack in actions.get("attacks", []):
        parsed_damage = [_normalize_attack_damage_entry(d) for d in attack.get("damage", [])]
        primary_damage = parsed_damage[0] if parsed_damage else {"dice": None, "flat": None, "type": None}
        attack_list.append(
            {
                "name": attack.get("name"),
                "attackBonus": _to_number(attack.get("hit_bonus"), default=0),
                "damage": {
                    "dice": primary_damage.get("dice"),
                    "flat": primary_damage.get("flat"),
                    "type": primary_damage.get("type"),
                },
            }
        )

    inventory_contract = _build_inventory_contract(master_record)

    seen_spells: set[str] = set()
    normalized_spells = []
    for spell in spellcasting.get("spells", []):
        dedupe_key = "|".join(
            [
                str(spell.get("name") or "").strip().lower(),
                str(spell.get("level") or ""),
                str(spell.get("casting_time") or ""),
                str(spell.get("range") or ""),
                str(spell.get("duration") or ""),
            ]
        )
        if dedupe_key in seen_spells:
            continue
        seen_spells.add(dedupe_key)

        normalized_spells.append(
            {
                "name": spell.get("name"),
                "range": spell.get("range"),
                "duration": spell.get("duration"),
                "castingTime": spell.get("casting_time"),
                "prepared": bool(spell.get("prepared")) if spell.get("prepared") is not None else False,
            }
        )

    normalized_features = [_normalize_feature_row(feature) for feature in features]
    feature_uses_lookup = _build_feature_uses_lookup(master_record.get("feature_uses", []))
    normalized_features_out = []
    for feature in normalized_features:
        feature_name = str(feature.get("name") or "").strip()
        if not feature_name:
            continue
        row = {
            "name": feature_name,
            "type": feature.get("type"),
        }
        uses_value = feature_uses_lookup.get(slugify(feature_name))
        if uses_value:
            row["uses"] = uses_value
        rule_id = _infer_feature_rule_id(feature_name)
        if rule_id:
            row["ruleId"] = rule_id
        normalized_features_out.append(row)

    hit_points = master_record.get("hit_points", {})
    current_hp = _parse_signed_int(hit_points.get("current_hp"))
    max_hp = _parse_signed_int(hit_points.get("max_hp"))
    hp_value = current_hp if current_hp is not None else (max_hp if max_hp is not None else 0)

    return {
        "id": str(source.get("character_id") or ""),
        "name": str(identity.get("character_name") or "Unknown"),
        "combat": {
            "hp": hp_value,
            "maxHp": max_hp if max_hp is not None else hp_value,
            "ac": _to_number(core.get("armor_class"), default=10),
            "initiative": _to_number(core.get("initiative_bonus"), default=0),
            "speed": _to_number(core.get("speed_ft"), default=30),
        },
        "stats": stats,
        "skills": skill_map,
        "inventory": inventory_contract,
        "weapons": attack_list,
        "spells": normalized_spells,
        "features": normalized_features_out,
    }


def validate_engine_entity_contract(entity: dict) -> None:
    errors: list[str] = []

    def is_number(value) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool)

    if not isinstance(entity, dict):
        raise ValueError("engine_entity contract must be an object")

    for key in ("id", "name", "combat", "stats", "inventory"):
        if key not in entity:
            errors.append(f"missing required field: {key}")

    if not isinstance(entity.get("id"), str):
        errors.append("id must be a string")
    if not isinstance(entity.get("name"), str):
        errors.append("name must be a string")

    combat = entity.get("combat")
    if not isinstance(combat, dict):
        errors.append("combat must be an object")
    else:
        for key in ("hp", "maxHp", "ac", "initiative", "speed"):
            if key not in combat:
                errors.append(f"combat.{key} is required")
            elif not is_number(combat[key]):
                errors.append(f"combat.{key} must be a number")

    stats = entity.get("stats")
    if not isinstance(stats, dict):
        errors.append("stats must be an object")
    else:
        for key in ("str", "dex", "con", "int", "wis", "cha"):
            if key not in stats:
                errors.append(f"stats.{key} is required")
            elif not is_number(stats[key]):
                errors.append(f"stats.{key} must be a number")

    skills = entity.get("skills")
    if skills is not None:
        if not isinstance(skills, dict):
            errors.append("skills must be an object")
        else:
            for key, row in skills.items():
                if not isinstance(row, dict):
                    errors.append(f"skills.{key} must be an object")
                    continue
                if not is_number(row.get("value")):
                    errors.append(f"skills.{key}.value must be a number")
                prof = row.get("proficient")
                if prof is not None and not isinstance(prof, bool):
                    errors.append(f"skills.{key}.proficient must be a boolean")

    inventory = entity.get("inventory")
    if inventory is not None:
        if not isinstance(inventory, dict):
            errors.append("inventory must be an object")
        else:
            if "capacity" in inventory and not is_number(inventory.get("capacity")):
                errors.append("inventory.capacity must be a number")
            if "weight" in inventory and not is_number(inventory.get("weight")):
                errors.append("inventory.weight must be a number")
            items = inventory.get("items")
            if not isinstance(items, list):
                errors.append("inventory.items must be an array")
            else:
                for i, row in enumerate(items):
                    if not isinstance(row, dict):
                        errors.append(f"inventory.items[{i}] must be an object")
                        continue
                    if not isinstance(row.get("instanceId"), str):
                        errors.append(f"inventory.items[{i}].instanceId must be a string")
                    if not isinstance(row.get("itemId"), str):
                        errors.append(f"inventory.items[{i}].itemId must be a string")
                    if not is_number(row.get("qty")):
                        errors.append(f"inventory.items[{i}].qty must be a number")
                    equipped = row.get("equipped")
                    if equipped is not None and not isinstance(equipped, bool):
                        errors.append(f"inventory.items[{i}].equipped must be a boolean")
                    slot = row.get("slot")
                    if slot is not None and not isinstance(slot, str):
                        errors.append(f"inventory.items[{i}].slot must be a string")

    weapons = entity.get("weapons")
    if weapons is not None:
        if not isinstance(weapons, list):
            errors.append("weapons must be an array")
        else:
            for i, row in enumerate(weapons):
                if not isinstance(row, dict):
                    errors.append(f"weapons[{i}] must be an object")
                    continue
                if not isinstance(row.get("name"), str):
                    errors.append(f"weapons[{i}].name must be a string")
                if not is_number(row.get("attackBonus")):
                    errors.append(f"weapons[{i}].attackBonus must be a number")

    spells = entity.get("spells")
    if spells is not None:
        if not isinstance(spells, list):
            errors.append("spells must be an array")
        else:
            for i, row in enumerate(spells):
                if not isinstance(row, dict):
                    errors.append(f"spells[{i}] must be an object")
                    continue
                if not isinstance(row.get("name"), str):
                    errors.append(f"spells[{i}].name must be a string")

    features = entity.get("features")
    if features is not None:
        if not isinstance(features, list):
            errors.append("features must be an array")
        else:
            for i, row in enumerate(features):
                if not isinstance(row, dict):
                    errors.append(f"features[{i}] must be an object")
                    continue
                if not isinstance(row.get("name"), str):
                    errors.append(f"features[{i}].name must be a string")

    if errors:
        raise ValueError("Invalid engine_entity contract: " + "; ".join(errors))


def write_outputs(out_dir: Path, tables: dict) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    (out_dir / "character.json").write_text(
        json.dumps(tables["character"], indent=2),
        encoding="utf-8",
    )

    write_csv(
        out_dir / "ability_scores.csv",
        tables["ability_scores"],
        ["character_id", "ability", "score", "modifier"],
    )
    write_csv(
        out_dir / "features.csv",
        tables["features"],
        ["character_id", "feature_order", "feature_text"],
    )
    write_csv(
        out_dir / "inventory_items.csv",
        tables["inventory_items"],
        ["character_id", "item_order", "item_text"],
    )
    write_csv(
        out_dir / "spells.csv",
        tables["spells"],
        ["character_id", "spell_order", "spell_text"],
    )

    master_record = build_master_character_record(tables)
    engine_entity = build_engine_entity(master_record)
    validate_engine_entity_contract(engine_entity)
    (out_dir / "character_master.json").write_text(
        json.dumps(master_record, indent=2),
        encoding="utf-8",
    )
    (out_dir / "engine_entity.json").write_text(
        json.dumps(engine_entity, indent=2),
        encoding="utf-8",
    )

    static_record, runtime_record = split_static_runtime(master_record)
    (out_dir / "character_template.json").write_text(
        json.dumps(static_record, indent=2),
        encoding="utf-8",
    )
    (out_dir / "combat_instance.json").write_text(
        json.dumps(runtime_record, indent=2),
        encoding="utf-8",
    )

    # Publish render contracts into static for immediate frontend fetch support.
    static_dir = Path("static")
    static_dir.mkdir(parents=True, exist_ok=True)
    (static_dir / "character_template.json").write_text(
        json.dumps(static_record, indent=2),
        encoding="utf-8",
    )
    (static_dir / "combat_instance.json").write_text(
        json.dumps(runtime_record, indent=2),
        encoding="utf-8",
    )
    (static_dir / "character_master.json").write_text(
        json.dumps(master_record, indent=2),
        encoding="utf-8",
    )
    (static_dir / "engine_entity.json").write_text(
        json.dumps(engine_entity, indent=2),
        encoding="utf-8",
    )

    (out_dir / "raw_pages.txt").write_text(
        "\n\n=== PAGE BREAK ===\n\n".join(tables["raw_pages"]),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Convert character PDF to tidy data tables")
    parser.add_argument("pdf_path", type=Path, help="Path to character-sheet PDF")
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("data") / "character_tidy",
        help="Directory where tidy outputs are written",
    )

    args = parser.parse_args()

    if not args.pdf_path.exists():
        raise SystemExit(f"PDF not found: {args.pdf_path}")

    tables = parse_character_tables(args.pdf_path)
    write_outputs(args.out_dir, tables)

    print(json.dumps({
        "ok": True,
        "out_dir": str(args.out_dir),
        "character_id": tables["character"]["character_id"],
        "name": tables["character"].get("name"),
    }, indent=2))


if __name__ == "__main__":
    main()
