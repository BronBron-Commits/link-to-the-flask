# Parser PDF Results

Recorded on 2026-04-05 against the standalone parser in `scripts/pdf_to_tidy_data.py`.

## Unit suite

Command run:

```bash
python -m unittest discover -s tests -p "test_*.py"
```

Result: 6 tests passed.

## Real PDF batch run

PDFs parsed from `static/`:

- `BronBron_the_Brutal_163335622.pdf`
- `dndbeyondexample.pdf`
- `PizzapieSarah_163335996 (2).pdf`

### BronBron_the_Brutal_163335622.pdf

- Character: Wysacaryn
- Class/Level: Paladin 3
- Currency: cp=0, sp=0, ep=0, gp=9, pp=0
- Inventory items parsed: 12
- Saving throws parsed: 6 of 6
- Skills with missing bonuses: none
- Spell count: 4
- Spell preview:
  - Thaumaturgy
  - Resistance
  - Divine Smite
  - Divine Smite
- Notes:
  - Inventory and currency still look structurally plausible.
  - Spell extraction is much cleaner now; table metadata rows are no longer being included.
  - Duplicate `Divine Smite` remains and may reflect either repeated extraction or repeated source content.

### dndbeyondexample.pdf

- Character: BronBron_the_Brutal's Character
- Class/Level: Warlock 3
- Currency: cp=0, sp=0, ep=0, gp=15, pp=0
- Inventory items parsed: 14
- Saving throws parsed: 6 of 6
- Skills with missing bonuses: none
- Spell count: 0
- Notes:
  - Currency, inventory count, and skills extracted cleanly.
  - No spell rows were detected for this PDF.

### PizzapieSarah_163335996 (2).pdf

- Character: Belfira Sunbeam
- Class/Level: Barbarian 1
- Currency: cp=0, sp=0, ep=0, gp=0, pp=0
- Inventory items parsed: 13
- Saving throws parsed: 6 of 6
- Skills with missing bonuses: none
- Saving throw proficiency flags:
  - STR: +4, proficient
  - DEX: +2, not proficient
  - CON: +5, proficient
  - INT: +0, not proficient
  - WIS: +1, not proficient
  - CHA: -1, not proficient
- Notes:
  - Core stats and inventory still parse successfully.
  - The save and skill gaps from the earlier run are fixed by the improved form-field fallback logic.

## Current parser findings

- The standalone unit suite passes with 6 tests.
- Inventory and currency parsing looks usable on all three PDFs.
- Save and skill extraction is now stable on the three sampled PDFs.
- Spell extraction is cleaner, but duplicate spell rows may still need a later dedupe pass.

## Recommended next fixes

- Add regression assertions for the three PDFs above once expected values are fully confirmed.
- Investigate whether duplicate `Divine Smite` rows should be collapsed or preserved.
- Expand spell parsing coverage so more spell-bearing PDFs can be validated the same way.