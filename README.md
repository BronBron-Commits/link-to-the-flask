# Link to the Flask

A multiplayer 3D Dungeons & Dragons game engine running in the browser, built with Flask, Socket.IO, and Three.js.

Players explore a 3D world, import their D&D Beyond characters from PDF, and engage in turn-based combat — all in real time. One player takes the role of DM and controls the game world.

> **Active development branch:** `recovered-work`

---

## Preview

> Screenshots and gameplay GIFs coming soon. The engine features a first-person 3D world, Baldur's Gate-style movement cursor, real-time dice cinematic sequences, and a DM control panel.

---

## Features

- **3D world** rendered in Three.js with BVH collision, lighting, and a free-roam camera
- **Real-time multiplayer** via WebSocket (Flask-SocketIO + gevent)
- **Turn-based D&D 5e combat** with initiative, movement ranges, melee attacks, and enemy AI
- **Character import** from D&D Beyond PDF character sheets *(experimental — see caveats below)*
- **Custom 3D character models** — upload your own `.glb` avatar
- **DM controls** — spawn training dummies, start/end combat, control the scene
- **Procedural combat presentation** — dice cinematics, floating text, screen shake, hit stop
- **Ambient audio** — loading screen track, exploration ambient, combat music layers
- **Baldur's Gate-style movement cursor** with 30ft movement range indicator

---

## Tech Stack

| Layer | Technology |
|---|---|
| Server | Python 3.13, Flask 3, Flask-SocketIO, gevent |
| Transport | WebSocket (gevent-websocket) |
| Frontend | Three.js r183, vanilla JavaScript |
| PDF parsing | PyMuPDF, pypdf |
| 3D assets | GLTF/GLB via GLTFLoader |
| Collision | three-mesh-bvh |

---

## Architecture Overview

The server is the single source of truth for all game state. Clients send intent; the server validates, resolves, and broadcasts outcomes.

```
Client (Three.js / map3d.js)
  │
  │  emit: move, attack, end-turn, spawn, dm-command
  ▼
Flask-SocketIO (app.py)
  │
  ├─ action_handler.py   — validates every incoming client action
  ├─ game_state.py       — mutates authoritative world state
  ├─ turn_manager.py     — advances initiative order, runs enemy AI
  └─ state_sync.py       — broadcasts updated state to all clients
  │
  ▼
All clients re-render from the authoritative world payload
```

**Key design decisions:**
- All combat resolution (attack rolls, damage, hit/miss) is computed **server-side**. Clients receive outcomes, not seeds.
- Enemy positions, HP, and turn order are owned by the server and cannot be spoofed by a player client.
- The DM role has elevated socket permissions enforced server-side; player clients cannot call DM-only handlers.
- `game_state.py` is a single module — no database. State is in-memory and resets on server restart.

---

## Getting Started

### Requirements

- Python 3.11+
- pip

### Install & Run

```bash
# Clone the repo
git clone https://github.com/BronBron-Commits/link-to-the-flask.git
cd link-to-the-flask

# Create and activate a virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS / Linux

# Install dependencies
pip install -r requirements.txt

# Start the server
python app.py
```

The app will be available at `http://localhost:5000`.

Navigate to `/map3d` to enter the 3D world.

### Open World Asset Optimization

To rebuild the optimized open-world scene asset used by `/map3d` and social room routes:

```bash
npm run assets:optimize:world
```

This regenerates `static/everything_optimized_draco.glb` from `static/everything_.gltf` using Draco mesh compression and WebP textures (max 2048px).

### Parser tests

The PDF parser can be tested independently from the game runtime and rendering engine:

```bash
python -m unittest discover -s tests -p "test_*.py"
```

These tests use synthetic page text and mocked PDF extraction so you can verify things like currency totals, inventory rows, and skill parsing without booting Flask or the 3D client.

### Parser GUI (Windows)

For quick manual parser checks, run the local desktop GUI:

```bash
python scripts/pdf_parser_gui.py
```

The GUI lets you:
- pick a PDF file from disk
- choose an output folder
- run parsing without opening the full app
- see parser logs and a compact JSON summary
- auto-open the output folder after completion

Parser output now includes `engine_entity.json`, a runtime-first contract for direct game-engine ingestion.

The contract is validated during parser output generation (fail-fast on invalid shape) and has a strict JSON Schema at:
- `static/engine_entity.schema.json` (browser fetch path)
- `schemas/engine_entity_schema.json` (repo schema reference)

Runtime validation and ingestion helpers are in:
- `static/utils/engineEntityContract.js`

That module provides:
- `validateEntity(entity)`
- `loadEntity(data)`
- `loadEngineEntityFromUrls(urls)`
- feature rule binding via `FEATURE_RULES` + `bindFeatures()`

Inventory is now a first-class engine contract section:
- `inventory.capacity` + `inventory.weight`
- `inventory.items[]` item instances with `instanceId`, `itemId`, `qty`, `equipped`, `slot`

Runtime item definitions and hooks are provided in `static/utils/engineEntityContract.js` via:
- `ITEM_DB` (item registry)
- `equipItem(entity, instanceId)`
- `useItem(entity, instanceId)`

### Simulation Test GUI (Windows)

For fast offline simulation test runs, use the desktop test runner:

```bash
python scripts/simulation_test_gui.py
```

The GUI supports:
- simulation-focused scope (`test_multiplayer_system.py`)
- full suite scope (`test_*.py`)
- custom unittest pattern scope
- live output log streaming and pass/fail summary
- stop/cancel for long runs

---

## Roles

| Role | Access |
|---|---|
| **Player** | Move character, attack in combat, import character sheet |
| **DM** | Spawn enemies, start/end combat, override game state |

Switch role at runtime using the in-game console (`` ` `` key):

```
/mode dm
/mode player
```

---

## DM Console Commands

| Command | Description |
|---|---|
| `/spawn training-dummy` | Spawn an easy training dummy |
| `/spawn player-dummy` | Spawn a moderate-difficulty dummy |
| `/spawn elite-dummy` | Spawn a high-difficulty dummy |
| `/mode player` | Switch to player role |
| `/mode dm` | Switch to DM role |

---

## Combat System

- **Initiative** is rolled automatically when combat starts.
- On your turn: click an enemy to attack. If you are within 5ft (melee range) it fires immediately with a confirm prompt; outside range, movement is required first.
- Movement uses free positional targeting (not a grid). The server calculates distances in world units; 1 unit ≈ 1ft. Players have a 30ft movement budget per turn shown as a range disc.
- **All attack rolls and damage are resolved server-side.** Clients receive the result and play back the presentation.
- Combat ends automatically when all enemies reach 0 HP, or the DM ends it manually.

### Enemy AI

Each enemy turn: move up to 5ft toward the nearest player, then attack if within melee range. Attack/damage rolls are computed in `turn_manager.py`.

### Enemy Difficulty Tiers

| Tier | HP | AC | Attack Bonus | Damage |
|---|---|---|---|---|
| `training-dummy` | 30 | 8 | +1 | 1d3 |
| `player-dummy` | 40 | 12 | +2 | 1d6+1 |
| `elite-dummy` | 60 | 14 | +4 | 1d8+2 |

---

## Character Import *(Experimental)*

1. Export your character sheet from D&D Beyond as a PDF.
2. In-game, open the character panel and upload the PDF.
3. The server parses ability scores, AC, HP, speed, spell slots, inventory, and class features.

**Known limitations:**
- Parsing is layout-sensitive and may fail on older or non-standard PDF exports.
- Some spell data and multi-class features may not extract correctly.
- Imported stats are validated and clamped server-side to prevent bad data from breaking combat.
- If a field fails to parse, it falls back to a safe default and logs a warning.

---

## Production Deployment

See [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md) for full details.

### Run the server

```bash
# gevent worker is required for WebSocket support — do not use eventlet
gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 app:app -b 0.0.0.0:5000
```

The app listens on port `5000` by default. Only one worker is supported (in-memory state is not shared across workers).

### nginx

Proxy `/socket.io/` with WebSocket upgrade headers:

```nginx
location /socket.io/ {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 60s;
    proxy_send_timeout 60s;
}
```

### Cloudflare

- Enable **WebSockets** in Network settings.
- Disable **Rocket Loader** for this domain (it breaks Socket.IO handshakes).
- Use DNS-only (grey cloud) during initial debugging if handshakes fail.

### Verify the deployment

```bash
# Should return HTTP 200 with Socket.IO handshake payload
curl https://yourdomain.com/socket.io/?EIO=4&transport=polling
```

---

## Audio

| Track | File | Usage |
|---|---|---|
| Loading screen | `static/maintheme.wav` | Plays once during asset loading, does not loop |
| Exploration ambient | `static/docks.wav` | Fades in after loading, loops continuously |
| Battle music | `static/battlemusic.wav` | Plays during active combat, stops on exit |

---

## Project Structure

```
app.py                  # Server entry point, all socket event handlers
extensions.py           # Flask + SocketIO instances (imported everywhere)
game_state.py           # Single source of truth for all server state
turn_manager.py         # Turn cycle, initiative, enemy AI
action_handler.py       # Validates and applies every client action
connection_manager.py   # Connect / disconnect / role assignment
state_sync.py           # Broadcasts authoritative state to clients
routes.py               # HTTP routes (PDF import, model upload, etc.)

static/
  map3d.js              # ~20k line Three.js frontend (world, combat, UI)
  index.html            # Landing page
  map3d.html            # Game page

data/
  character_tidy/       # Character sheet data (CSV, JSON schemas)
  uploads/              # Uploaded player model files

assets/
  models/               # GLTF scene models
  textures/
  materials/
```

---

## Development Notes

- `map3d.js` is intentionally monolithic during this phase of development. Modularization is planned once the feature set stabilises.
- The server is authoritative for all game logic. The client is responsible only for rendering and user input.
- Rendering and simulation are decoupled — the client re-renders from server state payloads, not from local prediction.
- There is no database. Game state lives in memory and resets on server restart. Persistence is a future goal.
- The gevent monkey-patch in `app.py` must remain the first import to avoid async conflicts.

---

## Known Issues

- Combat HP sync can flicker when world-sync events arrive immediately after a local attack resolves.
- PDF import reliability varies across D&D Beyond export versions and character configurations.
- The DM UI can overlap game elements on smaller viewports.
- Multiple simultaneous combats are not supported — one combat instance per server session.

## Roadmap

- Server-authoritative combat timeline with structured event stream
- Visible turn state transitions (enemy turn indicator, attack telegraph)
- DM panel redesign with scene object manipulation
- PDF import hardening (fuzzy field matching, multi-class support)
- Persistent character storage
- Performance profiling for multi-player sessions
