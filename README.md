# Link to the Flask

A multiplayer 3D Dungeons & Dragons game engine running in the browser, built with Flask, Socket.IO, and Three.js.

Players explore a 3D world, import their D&D Beyond characters from PDF, and engage in turn-based combat — all in real time. One player takes the role of DM and controls the game world.

---

## Features

- **3D world** rendered in Three.js with BVH collision, lighting, and a free-roam camera
- **Real-time multiplayer** via WebSocket (Flask-SocketIO + gevent)
- **Turn-based D&D 5e combat** with initiative, movement ranges, melee attacks, and enemy AI
- **Character import** from D&D Beyond PDF character sheets
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

---

## Roles

| Role | Access |
|---|---|
| **Player** | Move character, attack in combat, import character sheet |
| **DM** | Spawn enemies, start/end combat, override game state |

Switch role at runtime using the in-game console:
```
/mode dm
/mode player
```

---

## DM Console Commands

Open the in-game console (`` ` `` key) while in DM mode:

| Command | Description |
|---|---|
| `/spawn training-dummy` | Spawn a training dummy at your location |
| `/spawn player-dummy` | Spawn a moderate-difficulty dummy |
| `/spawn elite-dummy` | Spawn a high-difficulty dummy |
| `/mode player` | Switch to player role |
| `/mode dm` | Switch to DM role |

---

## Character Import

1. Export your character sheet from D&D Beyond as a PDF.
2. In-game, open the character panel and upload the PDF.
3. The server parses ability scores, AC, HP, spell slots, inventory, and features.

---

## Combat System

- **Initiative** is rolled automatically when combat starts.
- On your turn: click an enemy to attack (melee auto-fires if in range, prompts confirm otherwise).
- Movement is shown as a Baldur's Gate-style disc — click the ground to move.
- The **enemy AI** advances toward the nearest player each turn and attacks if within 5ft.
- Combat ends automatically when all enemies are defeated or via DM command.

### Enemy Difficulty Tiers

| Tier | HP | AC | Attack Bonus | Damage |
|---|---|---|---|---|
| `training-dummy` | 30 | 8 | +1 | 1d3 |
| `player-dummy` | 40 | 12 | +2 | 1d6+1 |
| `elite-dummy` | 60 | 14 | +4 | 1d8+2 |

---

## Production Deployment

See [DEPLOYMENT_VPS.md](DEPLOYMENT_VPS.md) for full instructions. Summary:

```bash
# Run with gevent worker (required for WebSocket support)
gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker -w 1 app:app -b 0.0.0.0:5000
```

**nginx** — proxy `/socket.io/` with WebSocket upgrade headers.  
**Cloudflare** — enable WebSockets, disable Rocket Loader.

---

## Audio

| Track | File | Usage |
|---|---|---|
| Loading screen | `static/maintheme.wav` | Plays once during asset loading |
| Exploration ambient | `static/docks.wav` | Loops after loading completes |
| Battle music | `static/battlemusic.wav` | Plays during combat turns |

---

## Branch

Active development is on the `recovered-work` branch.
