# Link to the Flask

**A server-authoritative multiplayer 3D Dungeons & Dragons engine in the browser.**

Play in a shared 3D world, import real D&D characters, and engage in turn-based combat with a live DM controlling the session.

---

## 🎮 Live Demo

👉 https://bronbron.org/map3d

> Best experienced on desktop.  
> Open two tabs to simulate multiplayer.

---

## 📸 Preview

![Gameplay Screenshot](docs/screenshot1.png)
![Combat Screenshot](docs/screenshot2.png)

> Add real screenshots here ASAP — this is critical.

---

## ⚡ What Works Right Now

- Join a shared 3D world
- Move freely with real distance-based movement
- Start combat (DM or auto-start)
- Turn-based initiative system
- Melee attacks with server-side resolution
- Enemy AI (movement + attack)
- Combat feedback (dice, hit/miss, effects)
- Multiplayer sync (multiple clients)

---

## 🧠 What Makes This Different

This is not just a frontend demo.

```text
✔ Server-authoritative combat engine
✔ Real multiplayer state synchronization
✔ DM-controlled world logic
✔ Deterministic turn system
Architecture (Core Idea)
Client → sends intent (move, attack)
Server → validates + resolves
Server → broadcasts result
Clients → render outcome
Clients cannot fake damage or state
All combat logic runs on the server
Multiplayer stays consistent across players
🧱 Tech Stack
Layer	Tech
Backend	Flask + Flask-SocketIO (gevent)
Realtime	WebSockets
Frontend	Three.js
Physics	BVH collision
Assets	GLTF / GLB
Parsing	D&D Beyond PDF → engine JSON
🕹️ Gameplay Loop
1. Join world
2. Move character (30ft range)
3. Trigger combat
4. Take turns (initiative order)
5. Attack enemies
6. Combat resolves server-side
🧙 DM Features
Spawn enemies
Start / end combat
Override game state
Observe all players
📦 Character Import (Experimental)

Import a D&D Beyond PDF:

PDF → Parsed → Engine Entity → In-Game Character

Supports:

HP / AC / stats
Inventory
Movement
Basic features
⚠️ Current Limitations
No persistent database (resets on restart)
UI can be crowded in some views
PDF parsing is not 100% reliable
Single combat instance per session
Large frontend file (map3d.js)
🚀 Getting Started
git clone https://github.com/BronBron-Commits/link-to-the-flask.git
cd link-to-the-flask

python -m venv venv
venv\Scripts\activate

pip install -r requirements.txt

python app.py

Open:

http://localhost:5000/map3d
🧪 Testing
python -m unittest discover -s tests

Includes:

deterministic combat simulation
parser validation
🧭 Project Direction

This project is evolving toward:

Persistent world state
Improved DM tools
Structured combat timeline
Better UI layering
Modular frontend architecture
🧠 Why I Built This

To explore:

Real-time multiplayer architecture
Server-authoritative game logic
Browser-based 3D engines
Deterministic simulation systems
📁 Project Structure (Simplified)
app.py                # Server entry
game_state.py         # Source of truth
turn_manager.py       # Combat + AI
action_handler.py     # Input validation
state_sync.py         # Broadcast system

static/map3d.js      # Main frontend engine
📌 Summary
A real-time multiplayer RPG engine in the browser
with server-authoritative combat and DM control.
