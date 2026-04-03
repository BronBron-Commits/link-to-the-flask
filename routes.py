"""
ROUTES — HTTP endpoints.

All REST API and static-file routes live here.
SocketIO event handlers belong in app.py instead.
"""
import json
import os
from pathlib import Path
from uuid import uuid4

from flask import request, jsonify, render_template, send_file, send_from_directory, Response
from werkzeug.utils import secure_filename

from extensions import app
import game_state as gs
from state_sync import broadcast_world
from scripts.pdf_to_tidy_data import parse_character_tables, write_outputs, build_master_character_record


def _resolve_contract(filename: str) -> Path | None:
    for candidate in (gs.CONTRACTS_DIR / filename, gs.STATIC_DIR / filename):
        if candidate.exists():
            return candidate
    return None


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/favicon.ico")
def favicon():
    p = gs.STATIC_DIR / "favicon.ico"
    return send_file(p, mimetype="image/x-icon") if p.exists() else Response(status=204)


@app.route("/map3d")
def map3d_page():
    return send_from_directory(gs.STATIC_DIR, "map3d.html")


# ---------------------------------------------------------------------------
# Legacy compatibility
# ---------------------------------------------------------------------------

@app.route("/move", methods=["POST"])
def move():
    # Kept for client compatibility; server-authoritative position is via WebSocket.
    return jsonify(ok=True)


@app.route("/state")
def state():
    return jsonify({"players": gs.players})


# ---------------------------------------------------------------------------
# Scene state
# ---------------------------------------------------------------------------

@app.route("/scene_state", methods=["GET"])
def scene_state_get():
    return jsonify(gs.build_world_payload(include_scene=True))


@app.route("/scene_state", methods=["POST"])
def scene_state_post():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, error="invalid payload"), 400
    incoming = data.get("scene") if isinstance(data.get("scene"), dict) else data
    if not isinstance(incoming, dict):
        return jsonify(ok=False, error="invalid scene state"), 400
    gs.latest_scene_state = {
        "objects": incoming.get("objects", {}),
        "lights": incoming.get("lights", {}),
    }
    gs.world_state["scene"] = gs.latest_scene_state
    if isinstance(data.get("entities"), dict):
        gs.world_state["entities"] = data["entities"]
        if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
            gs.sync_enemies_into_order()
    if isinstance(data.get("combat"), dict):
        gs.world_state["combat"] = data["combat"]
    broadcast_world(include_scene=True)
    return jsonify(ok=True, state=gs.latest_scene_state)


# ---------------------------------------------------------------------------
# Character data contracts
# ---------------------------------------------------------------------------

@app.route("/character_template.json")
def character_template_contract():
    p = _resolve_contract("character_template.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/combat_instance.json")
def combat_instance_contract():
    p = _resolve_contract("combat_instance.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/character_master.json")
def character_master_contract():
    p = _resolve_contract("character_master.json")
    return send_file(p, mimetype="application/json") if p else (jsonify(ok=False, error="not found"), 404)


@app.route("/data/character_tidy/<path:filename>")
def character_tidy_data_files(filename: str):
    if not gs.CONTRACTS_DIR.exists():
        return jsonify(ok=False, error="data/character_tidy not found"), 404
    return send_from_directory(gs.CONTRACTS_DIR, filename)


# ---------------------------------------------------------------------------
# PDF import
# ---------------------------------------------------------------------------

@app.route("/api/import-pdf", methods=["POST"])
def import_pdf_api():
    pdf_file = request.files.get("pdf")
    if not pdf_file or not pdf_file.filename:
        return jsonify(ok=False, error="missing pdf file"), 400
    if not pdf_file.filename.lower().endswith(".pdf"):
        return jsonify(ok=False, error="file must be a .pdf"), 400
    gs.UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    filename = secure_filename(pdf_file.filename)
    source_path = gs.UPLOADS_DIR / filename
    pdf_file.save(source_path)
    gs.CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    tables = parse_character_tables(source_path)
    write_outputs(gs.CONTRACTS_DIR, tables)
    master = build_master_character_record(tables)
    return jsonify(ok=True, source_file=filename, character=tables.get("character", {}), master=master)


@app.route("/api/player-info")
def player_info_api():
    p = _resolve_contract("character_master.json")
    if not p:
        return jsonify(ok=False, error="character_master.json not found"), 404
    master = json.loads(p.read_text(encoding="utf-8"))
    identity = master.get("identity", {})
    core = master.get("core_stats", {})
    hp = master.get("hit_points", {})
    max_hp = hp.get("max_hp")
    try:
        current_hp = int(hp.get("current_hp"))
    except (TypeError, ValueError):
        current_hp = max_hp
    return jsonify(
        ok=True,
        summary={
            "name": identity.get("character_name"),
            "class_level": identity.get("class_level"),
            "species": identity.get("species"),
            "background": identity.get("background"),
            "armor_class": core.get("armor_class"),
            "max_hp": max_hp,
            "current_hp": current_hp,
            "speed_ft": core.get("speed_ft"),
            "proficiency_bonus": core.get("proficiency_bonus"),
            "initiative_bonus": core.get("initiative_bonus"),
        },
        master=master,
    )


# ---------------------------------------------------------------------------
# Model upload
# ---------------------------------------------------------------------------

@app.route("/api/upload-character-model", methods=["POST"])
def upload_character_model_api():
    files = [f for f in request.files.getlist("model_files") if f and f.filename]
    single = request.files.get("model")
    if not files and single and single.filename:
        files = [single]
    if not files:
        return jsonify(ok=False, error="missing model file(s)"), 400
    gs.CHARACTER_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    bundle_id = uuid4().hex
    bundle_dir = gs.CHARACTER_MODELS_DIR / bundle_id
    bundle_dir.mkdir(parents=True, exist_ok=True)
    saved: list[str] = []
    for uploaded in files:
        safe = secure_filename(uploaded.filename)
        if not safe:
            continue
        (bundle_dir / safe).parent.mkdir(parents=True, exist_ok=True)
        uploaded.save(bundle_dir / safe)
        saved.append(safe)
    if not saved:
        return jsonify(ok=False, error="no valid files uploaded"), 400
    entry_name = secure_filename(request.form.get("model_entry", ""))
    if not entry_name or entry_name not in saved:
        glbs = [n for n in saved if n.lower().endswith(".glb")]
        gltfs = [n for n in saved if n.lower().endswith(".gltf")]
        entry_name = (glbs or gltfs or [""])[0]
    if not entry_name or not entry_name.lower().endswith((".glb", ".gltf")):
        return jsonify(ok=False, error="primary model must be .glb or .gltf"), 400
    return jsonify(
        ok=True,
        model_url=f"/static/user_models/{bundle_id}/{entry_name}",
        file_name=entry_name,
        uploaded_files=saved,
    )


# ---------------------------------------------------------------------------
# Debug / info endpoints
# ---------------------------------------------------------------------------

@app.route("/lobby_state", methods=["GET"])
def lobby_state_api():
    return jsonify(ok=True, lobby=gs.build_lobby_state())


@app.route("/debug/combat", methods=["GET"])
def debug_combat_api():
    return jsonify(ok=True, combat=gs.world_state.get("combat", {}))


@app.route("/server-build", methods=["GET"])
def server_build_api():
    return jsonify(
        ok=True,
        build=gs.SERVER_BUILD_TAG,
        pid=os.getpid(),
        async_mode="gevent",
    )
