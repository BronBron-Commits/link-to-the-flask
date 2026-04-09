"""
ROUTES — HTTP endpoints.

All REST API and static-file routes live here.
SocketIO event handlers belong in app.py instead.
"""
import json
import os
import re
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib import error as urllib_error
from urllib import request as urllib_request
from uuid import uuid4

from flask import request, jsonify, render_template, send_file, send_from_directory, Response, session
from werkzeug.utils import secure_filename

from extensions import app
import game_state as gs
from state_sync import broadcast_world

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False
from scripts.pdf_to_tidy_data import (
    parse_character_tables,
    write_outputs,
    build_master_character_record,
    build_engine_entity,
)


ARTIFACTS_DIR = Path("artifacts")


def _asset_version_token(relative_path: str) -> str:
    safe_relative = str(relative_path or "").replace("\\", "/").lstrip("/")
    if not safe_relative:
        return gs.SERVER_BUILD_TAG
    candidate = (gs.STATIC_DIR / safe_relative).resolve()
    try:
        candidate.relative_to(gs.STATIC_DIR.resolve())
    except ValueError:
        return gs.SERVER_BUILD_TAG
    try:
        mtime = int(candidate.stat().st_mtime)
    except OSError:
        mtime = 0
    return f"{gs.SERVER_BUILD_TAG}-{mtime}"


def asset_url(relative_path: str) -> str:
    raw_path = str(relative_path or "").strip()
    if not raw_path:
        return "/static/"
    normalized = raw_path.replace("\\", "/").lstrip("/")
    parts = urlsplit(f"/static/{normalized}")
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["v"] = _asset_version_token(parts.path.removeprefix("/static/"))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


@app.context_processor
def inject_asset_helpers():
    return {"asset_url": asset_url}


def _supabase_public_config() -> dict:
    return {
        "url": str(os.environ.get("SUPABASE_URL") or "").strip(),
        "anon_key": str(os.environ.get("SUPABASE_ANON_KEY") or "").strip(),
    }


def _supabase_is_configured() -> bool:
    cfg = _supabase_public_config()
    return bool(cfg["url"] and cfg["anon_key"])


def _fetch_supabase_user(access_token: str) -> tuple[dict | None, str | None]:
    token = str(access_token or "").strip()
    config = _supabase_public_config()
    if not token or not config["url"] or not config["anon_key"]:
        print(f"[SUPABASE FETCH] missing token or config", flush=True)
        return None, "missing-config-or-token"
    base_url = config["url"].rstrip("/")
    url = f"{base_url}/auth/v1/user"
    headers = {
        "apikey": config["anon_key"],
        "Authorization": f"Bearer {token}",
    }
    
    print(f"[SUPABASE FETCH] attempting user fetch from {url}", flush=True)
    
    # Try httpx if available (gevent-friendly)
    if HAS_HTTPX:
        try:
            print(f"[SUPABASE FETCH] using httpx client with 10s timeout", flush=True)
            with httpx.Client(verify=True, timeout=10.0) as client:
                response = client.get(url, headers=headers)
                print(f"[SUPABASE FETCH] got httpx response: status={response.status_code}", flush=True)
                if response.status_code != 200:
                    return None, f"supabase-http-{response.status_code}"
                payload = response.json()
                print(f"[SUPABASE FETCH] success, user_id={payload.get('id', 'unknown')}", flush=True)
                return payload, None
        except httpx.TimeoutException:
            print(f"[SUPABASE FETCH] httpx timeout", flush=True)
            return None, "supabase-timeout"
        except Exception as exc:
            print(f"[SUPABASE FETCH] httpx error: {type(exc).__name__}: {exc}", flush=True)
            return None, "supabase-network-error"
    
    # Fallback to urllib
    print(f"[SUPABASE FETCH] httpx not available, using urllib (may hang under gevent)", flush=True)
    req = urllib_request.Request(url, headers=headers, method="GET")
    try:
        print(f"[SUPABASE FETCH] urllib sending request...", flush=True)
        with urllib_request.urlopen(req, timeout=10) as response:
            print(f"[SUPABASE FETCH] urllib got response, reading...", flush=True)
            payload = json.loads(response.read().decode("utf-8"))
    except urllib_error.HTTPError as exc:
        print(f"[SUPABASE FETCH] urllib HTTP error {exc.code}: {exc}", flush=True)
        return None, f"supabase-http-{int(getattr(exc, 'code', 0) or 0)}"
    except urllib_error.URLError as exc:
        print(f"[SUPABASE FETCH] urllib URL error (network/DNS): {exc}", flush=True)
        return None, "supabase-network-error"
    except TimeoutError as exc:
        print(f"[SUPABASE FETCH] urllib timeout waiting for Supabase: {exc}", flush=True)
        return None, "supabase-timeout"
    except json.JSONDecodeError as exc:
        print(f"[SUPABASE FETCH] urllib invalid JSON from Supabase: {exc}", flush=True)
        return None, "supabase-invalid-json"
    except OSError as exc:
        print(f"[SUPABASE FETCH] urllib OS error: {exc}", flush=True)
        return None, "supabase-os-error"

    if not isinstance(payload, dict):
        print(f"[SUPABASE FETCH] payload is not dict, got {type(payload)}", flush=True)
        return None, "supabase-invalid-payload"
    print(f"[SUPABASE FETCH] urllib success, user_id={payload.get('id', 'unknown')}", flush=True)
    return payload, None


def _current_auth_user() -> dict | None:
    auth_user = session.get("auth_user")
    return auth_user if isinstance(auth_user, dict) else None


def _normalize_auth_user(user: dict) -> dict:
    metadata = user.get("user_metadata") if isinstance(user.get("user_metadata"), dict) else {}
    app_metadata = user.get("app_metadata") if isinstance(user.get("app_metadata"), dict) else {}
    display_name = str(
        metadata.get("display_name")
        or metadata.get("full_name")
        or metadata.get("name")
        or ""
    ).strip()
    role = str(
        app_metadata.get("role")
        or user.get("role")
        or "authenticated"
    ).strip() or "authenticated"
    return {
        "id": str(user.get("id") or "").strip(),
        "email": str(user.get("email") or "").strip(),
        "displayName": display_name,
        "role": role,
        "emailConfirmed": bool(user.get("email_confirmed_at") or user.get("confirmed_at")),
    }


def _resolve_contract(filename: str) -> Path | None:
    for candidate in (gs.CONTRACTS_DIR / filename, gs.STATIC_DIR / filename):
        if candidate.exists():
            return candidate
    return None


def _read_json_file(path: Path) -> dict | None:
    if not path.exists():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    return payload if isinstance(payload, dict) else None


def _write_json_file(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _sheet_label_for_path(path: Path) -> str:
    base = re.sub(r"[_\s]+", " ", path.stem).strip()
    return base or path.name


def _discover_selectable_character_sheets() -> list[dict]:
    sheets: list[dict] = []
    roots = (
        ("static", gs.STATIC_DIR),
        ("uploads", gs.UPLOADS_DIR),
    )
    for source, root in roots:
        if not root.exists():
            continue
        for path in sorted(root.rglob("*.pdf")):
            if not path.is_file():
                continue
            rel_path = path.relative_to(root).as_posix()
            sheets.append(
                {
                    "sheetId": f"{source}/{rel_path}",
                    "source": source,
                    "filename": path.name,
                    "relativePath": rel_path,
                    "label": _sheet_label_for_path(path),
                }
            )
    sheets.sort(key=lambda row: (str(row.get("label") or "").lower(), str(row.get("relativePath") or "").lower()))
    return sheets


def _discover_available_glb_models() -> list[dict]:
    rows: list[dict] = []

    if gs.STATIC_DIR.exists():
        for path in sorted(gs.STATIC_DIR.glob("*.glb")):
            if not path.is_file():
                continue
            rows.append(
                {
                    "label": path.name,
                    "url": f"/static/{path.name}",
                    "source": "static",
                }
            )

    user_models_root = gs.CHARACTER_MODELS_DIR
    if user_models_root.exists():
        for path in sorted(user_models_root.rglob("*.glb")):
            if not path.is_file():
                continue
            rel = path.relative_to(gs.STATIC_DIR).as_posix()
            rows.append(
                {
                    "label": path.name,
                    "url": f"/static/{rel}",
                    "source": "user_models",
                }
            )

    rows.sort(key=lambda row: (str(row.get("label") or "").lower(), str(row.get("url") or "").lower()))
    return rows


def _resolve_selectable_pdf(sheet_id: str) -> Path | None:
    raw = str(sheet_id or "").strip()
    if not raw:
        return None
    source, sep, rel_path = raw.partition("/")
    if not sep or not rel_path:
        return None
    root = {
        "static": gs.STATIC_DIR,
        "uploads": gs.UPLOADS_DIR,
    }.get(source)
    if root is None:
        return None
    relative = Path(rel_path)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root.resolve())
    except ValueError:
        return None
    if not candidate.exists() or not candidate.is_file() or candidate.suffix.lower() != ".pdf":
        return None
    return candidate


def _import_pdf_to_contracts(source_path: Path) -> dict:
    gs.CONTRACTS_DIR.mkdir(parents=True, exist_ok=True)
    tables = parse_character_tables(source_path)
    print("[PDF PARSE OUTPUT]", tables, flush=True)

    master = build_master_character_record(tables)
    print("[MASTER RECORD]", master, flush=True)

    engine_entity = build_engine_entity(master)
    write_outputs(gs.CONTRACTS_DIR, tables)
    return {
        "ok": True,
        "source_file": source_path.name,
        "character": tables.get("character", {}),
        "master": master,
        "engine_entity": engine_entity,
    }


# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    cfg = _supabase_public_config()
    return render_template(
        "index.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/hub")
def hub():
    cfg = _supabase_public_config()
    return render_template(
        "hub.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/model-select")
def model_select():
    cfg = _supabase_public_config()
    return render_template(
        "model_select.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/world-select")
def world_select():
    cfg = _supabase_public_config()
    return render_template(
        "world_select.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/paraval-library")
def paraval_library():
    cfg = _supabase_public_config()
    return render_template(
        "paraval_library.html",
        supabase_url=cfg["url"],
        supabase_anon_key=cfg["anon_key"],
    )


@app.route("/game")
def game():
    return render_template("game.html")


@app.route("/favicon.ico")
def favicon():
    p = gs.STATIC_DIR / "favicon.ico"
    return send_file(p, mimetype="image/x-icon") if p.exists() else Response(status=204)


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user = _current_auth_user()
    return jsonify(
        ok=True,
        configured=_supabase_is_configured(),
        authenticated=bool(user),
        user=user,
    )


@app.route("/api/auth/session", methods=["POST"])
def auth_session_create():
    print(f"[AUTH SESSION] request received", flush=True)
    try:
        if not _supabase_is_configured():
            print(f"[AUTH SESSION] Supabase not configured", flush=True)
            return jsonify(ok=False, error="supabase-not-configured"), 503
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            print(f"[AUTH SESSION] invalid payload type", flush=True)
            return jsonify(ok=False, error="invalid-payload"), 400
        access_token = str(payload.get("accessToken") or "").strip()
        if not access_token:
            print(f"[AUTH SESSION] missing accessToken in payload", flush=True)
            return jsonify(ok=False, error="missing-access-token"), 400
        print(f"[AUTH SESSION] fetching user from Supabase...", flush=True)
        user, validation_error = _fetch_supabase_user(access_token)
        print(f"[AUTH SESSION] _fetch_supabase_user returned: user={bool(user)}, error={validation_error}", flush=True)
        if not user:
            if validation_error == "supabase-http-401":
                print(f"[AUTH SESSION] invalid token (401)", flush=True)
                return jsonify(ok=False, error="invalid-supabase-session", detail=validation_error), 401
            if validation_error == "supabase-http-403":
                print(f"[AUTH SESSION] Supabase key rejected (403)", flush=True)
                return jsonify(ok=False, error="supabase-key-rejected", detail=validation_error), 502
            if validation_error and validation_error.startswith("supabase-http-"):
                print(f"[AUTH SESSION] Supabase HTTP error: {validation_error}", flush=True)
                return jsonify(ok=False, error="supabase-user-fetch-failed", detail=validation_error), 502
            if validation_error in ("supabase-network-error", "supabase-timeout", "supabase-os-error"):
                print(f"[AUTH SESSION] Supabase unreachable: {validation_error}", flush=True)
                return jsonify(ok=False, error="supabase-unreachable", detail=validation_error), 502
            print(f"[AUTH SESSION] Supabase validation error: {validation_error}", flush=True)
            return jsonify(ok=False, error="invalid-supabase-session", detail=validation_error or "unknown"), 401
        print(f"[AUTH SESSION] user authenticated, storing in session...", flush=True)
        session["auth_user"] = _normalize_auth_user(user)
        # Flask default sessions are cookie-backed; avoid storing large JWTs in cookies.
        session.pop("supabase_access_token", None)
        print(f"[AUTH SESSION] session stored successfully", flush=True)
        response_data = jsonify(ok=True, authenticated=True, user=session["auth_user"])
        print(f"[AUTH SESSION] response created, returning now", flush=True)
        return response_data
    except Exception as exc:
        print(f"[AUTH SESSION ERROR] {type(exc).__name__}: {exc}", flush=True)
        return jsonify(ok=False, error="auth-session-internal-error", detail=type(exc).__name__), 500


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    session.pop("auth_user", None)
    session.pop("supabase_access_token", None)
    return jsonify(ok=True, authenticated=False)


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
    persisted = _read_json_file(gs.SCENE_STATE_FILE)
    if isinstance(persisted, dict):
        gs.latest_scene_state = {
            "objects": persisted.get("objects", {}),
            "lights": persisted.get("lights", {}),
        }
        gs.world_state["scene"] = gs.latest_scene_state
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
    _write_json_file(gs.SCENE_STATE_FILE, gs.latest_scene_state)
    if isinstance(data.get("entities"), dict):
        gs.world_state["entities"] = data["entities"]
        if gs.world_state.get("combat", {}).get("state", {}).get("inCombat"):
            gs.sync_enemies_into_order()
    if isinstance(data.get("combat"), dict):
        gs.world_state["combat"] = data["combat"]
    broadcast_world(include_scene=True)
    return jsonify(ok=True, state=gs.latest_scene_state)


@app.route("/materials_state", methods=["GET"])
def materials_state_get():
    payload = _read_json_file(gs.MATERIALS_STATE_FILE)
    if not isinstance(payload, dict):
        payload = {
            "schemaVersion": "materials.v1",
            "materials": {},
        }
    if not isinstance(payload.get("materials"), dict):
        payload["materials"] = {}
    return jsonify(payload)


@app.route("/materials_state", methods=["POST"])
def materials_state_post():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify(ok=False, error="invalid payload"), 400
    materials = payload.get("materials")
    if not isinstance(materials, dict):
        return jsonify(ok=False, error="materials must be an object"), 400
    out = {
        "schemaVersion": str(payload.get("schemaVersion") or "materials.v1"),
        "updatedAt": payload.get("updatedAt"),
        "updatedBy": payload.get("updatedBy"),
        "worldId": payload.get("worldId"),
        "materials": materials,
    }
    _write_json_file(gs.MATERIALS_STATE_FILE, out)
    return jsonify(ok=True, state=out)


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


@app.route("/artifacts/<path:filename>")
def artifact_files(filename: str):
    artifacts_root = ARTIFACTS_DIR.resolve()
    candidate = (artifacts_root / Path(filename)).resolve()
    try:
        candidate.relative_to(artifacts_root)
    except ValueError:
        return jsonify(ok=False, error="invalid artifact path"), 400

    if not candidate.exists() or not candidate.is_file():
        return jsonify(ok=False, error="artifact not found"), 404

    return send_from_directory(artifacts_root, filename)


# ---------------------------------------------------------------------------
# PDF import
# ---------------------------------------------------------------------------

@app.route("/api/character-sheets", methods=["GET"])
def character_sheets_api():
    return jsonify(ok=True, sheets=_discover_selectable_character_sheets())

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
    return jsonify(_import_pdf_to_contracts(source_path))


@app.route("/api/import-character-sheet", methods=["POST"])
def import_character_sheet_api():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        payload = request.form.to_dict(flat=True)
    sheet_id = str(payload.get("sheetId") or payload.get("sheet") or "").strip()
    if not sheet_id:
        return jsonify(ok=False, error="missing sheetId"), 400
    source_path = _resolve_selectable_pdf(sheet_id)
    if source_path is None:
        return jsonify(ok=False, error="character sheet not found"), 404
    return jsonify(_import_pdf_to_contracts(source_path))


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
    in_combat = bool(gs.world_state.get("combat", {}).get("state", {}).get("inCombat"))
    try:
        parsed_current_hp = int(hp.get("current_hp"))
    except (TypeError, ValueError):
        parsed_current_hp = max_hp
    # New/initial character loads should start at full health unless combat is active.
    current_hp = parsed_current_hp if in_combat else max_hp
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


@app.route("/api/character-models", methods=["GET"])
def character_models_api():
    return jsonify(ok=True, models=_discover_available_glb_models())


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
