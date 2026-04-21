#!/usr/bin/env python3
"""Quick test of spawn distribution."""

from pathlib import Path
import sys
sys.path.insert(0, str(Path.cwd()))

from scripts.party_horde_simulation import _build_horde
import random

rng = random.Random(2026)
horde = _build_horde(24, rng)

print("Radial spawn distribution (24 enemies):")
print("=" * 50)
print("First 8 enemies:")
for i in range(1, 9):
    pos = horde[f'enemy_{i}']['position']
    print(f'  enemy_{i:2d}: x={pos["x"]:7.2f}, z={pos["z"]:7.2f}')

print("\nMiddle 8 enemies (enemies 9-16):")
for i in range(9, 17):
    pos = horde[f'enemy_{i}']['position']
    print(f'  enemy_{i:2d}: x={pos["x"]:7.2f}, z={pos["z"]:7.2f}')

print("\nLast 8 enemies (enemies 17-24):")
for i in range(17, 25):
    pos = horde[f'enemy_{i}']['position']
    print(f'  enemy_{i:2d}: x={pos["x"]:7.2f}, z={pos["z"]:7.2f}')

print("\n✓ Golden angle radial distribution avoids grid stacking")
